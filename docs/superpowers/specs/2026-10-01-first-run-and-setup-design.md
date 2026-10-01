# A first run that teaches, and a Setup view

Status: design approved in conversation on 2026-10-01; this is the written spec for review.
Branch: `feat/first-run-setup` (built on `feat/update-notice`, which ships in the same release).

## Why

tuiboard grew up around task files its author already had in Obsidian, so nobody has looked at it
as a brand-new user does. A spike on a clean machine (empty HOME, empty working folder) showed
the path today:

1. Install Bun, `bun install -g tuiboard`, run `tuiboard`.
2. A "Welcome to tuiboard" dialog offers "Create a new board" or "Use files I already have",
   over a dashboard that is already drawn and says "Nothing scheduled." and "No active sessions."
3. Creating a board asks for a name and columns, then writes `~/.config/tuiboard/config.yaml`
   and `~/.local/share/tuiboard/boards/<Name>.md` (a hidden folder).
4. The dashboard opens with an empty "Todo 0" column, a banner "Added Work" for three seconds,
   and nothing that says what to do next or what the other zones are.

What goes wrong:

- **Empty states are mute.** Nothing tells a new user to press `n`, how a task reaches the
  planner, or that the Agents zone reads Claude Code, Codex, OpenCode and Pi by itself.
- **The calendar cannot be found from the app.** It is only in the README (`tuiboard
  calendar-setup`).
- **The board file is in a hidden folder**, hard to find on Windows and macOS.
- **There is no content**, so the planner and the agenda stay empty and the value is never seen.
- **During the welcome dialog the bottom bar shows the dashboard's keys**, not the dialog's.

## Goal and success

A person who has just installed tuiboard reaches a living dashboard in about two minutes without
reading the README, can say what each zone is for, and knows where to look to see what is connected
(boards, agents, calendar, updates).

Success is checked by running the same clean-machine first run before and after, and by the tests
below.

## Out of scope (deliberately)

- **Simplifying the calendar connection** (OAuth in the Google Cloud Console, an Azure
  registration). That is its own spike: a read-only calendar from an iCal URL, with no OAuth.
- Installing Bun for the user, or a one-line installer.
- Actions inside the Setup view (it is read-only: state and commands to copy).
- Any telemetry. The one network call tuiboard makes by itself stays the daily update check.
- Changing anything for people who already have boards.

## Design

### A. The welcome

The "Welcome to tuiboard" dialog (`BoardNewModal`, `src/ui/Modal.tsx`, `mandatory` mode) gains a short
paragraph under its title, in the dim colour:

> tuiboard is a kanban board on plain markdown, plus a Today/Tomorrow planner, a day agenda and a
> live list of your coding agents. Only the board is required: the rest is there when you want it.

While any modal is open the bottom bar shows the modal's own keys, not the dashboard's. `hintsFor`
(`src/ui/hints.ts`) takes a `modal` field; for the welcome it returns "j/k choose · Enter confirm",
for the other steps "Enter confirm" (plus "· Esc cancel" when it is not mandatory).

After the first board is created the banner is longer and lives longer (`flashBanner` already takes
a lifetime): `Added Work · n new task · ? keys · S setup`, 8 seconds.

### B. Where a new board lives

`defaultBoardsDir()` (`src/boards/suggest.ts`) becomes:

1. If `XDG_DATA_HOME` is set: `<XDG_DATA_HOME>/tuiboard/boards` (as today; someone who set it asked
   for it).
2. Else, if `~/Documents` exists: `~/Documents/tuiboard`.
3. Else `~/tuiboard`.

`suggestBoardsDir` is unchanged: with existing boards in one folder, new boards go next to them. So
nobody who already uses tuiboard sees a change. The path is still shown and editable before anything
is written.

### C. Example tasks

A new step after "Columns" in the create path: `Start with a few example tasks? (Y/n)`, default yes.
Not offered in "Use files I already have". The step type `BoardNew["step"]` gains `"examples"`;
`commitCreate` takes `{ examples: boolean }`.

`exampleTasks(now: Date): string[]` in `src/boards/create.ts` returns markdown task lines for the
first column, all dated today (`⏳ YYYY-MM-DD`):

- `- [ ] Press n to add a task of your own ⏳ <today>`
- `- [ ] Press Enter on a task to tick it off ⏳ <today>`
- `- [ ] Press b to give a task an hour, then look at the Agenda ⌚ <hh:mm>-<hh:mm> ⏳ <date>`
- `- [ ] Press ? for every key, and d to delete these examples`

The time block starts at the next half hour at least 10 minutes away and lasts 30 minutes. If that
would be after 22:30, it is 09:00 to 09:30 tomorrow and that task is dated tomorrow. A board with
only one column puts them there; with several, in the first.

`tuiboard board add --examples` does the same from the command line (the wizard and the CLI share
`src/boards/`).

### D. Empty states that teach

All dim text, shown only when the zone is empty; none of it appears once there is content.

| Where | Today | After |
|---|---|---|
| Board, when the whole board has no open task | an empty column | `Press n to add your first task` in the first visible column |
| Planner (`PlannerPanel.tsx`) | `Nothing scheduled.` | `Nothing scheduled yet.` / `Give a task a date with s, or press t to bring one to today.` |
| Agents (`AgentsBar.tsx`) | `No active sessions.` | `No sessions yet.` / `tuiboard reads Claude Code, Codex, OpenCode and Pi from disk: start one and it shows up here.` |
| Agenda (`TimelineView.tsx`) | an empty ruler | one line in the header area, only while no calendar is configured **and** the viewed day has no task and no event: `Optional: connect a calendar, S for setup`. It goes away as soon as the day has anything on it, so nobody who does not want a calendar sees it for long |

The width is the zone's; lines wrap or truncate with the existing text helpers, never overflow.

### E. Setup: `S` and `tuiboard doctor`

One function collects the state; two thin views show it.

`collectSetupStatus(deps): SetupStatus` in `src/setup/status.ts`, pure with injected dependencies
(file checks, the adapters, the config, the update cache), returns:

```ts
interface SetupStatus {
  version: string;
  paths: { config: string | undefined; boardsDir: string };
  boards: { name: string; path: string; exists: boolean }[];
  agents: { provider: AgentProvider; label: string; found: boolean; sessions: number; lastActivityMs?: number }[];
  herdr: { installed: boolean; running: boolean };
  calendars: { provider: "google" | "microsoft"; connected: boolean; hint: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  updates: { enabled: boolean; latest?: string; checkedAt?: number };
}
```

An agent source is `found` when one of its adapter's `watchPaths()` exists; `sessions` counts what
the adapter discovers. A calendar is `connected` when its configured token file exists, and its `hint`
is the command that connects it (`tuiboard calendar-setup google`).

- **In the app:** `S` opens a modal (`kind: "setup"`) listing each area with `✓` (ready), `○` (not
  set up, optional) and a one-line remedy. `Esc` closes it. The key is `Shift+S` and must be tested
  before the plain `s` (schedule) in `handleKey`, the way `T` is handled before `t`. The help
  (`?`) gets a line for it.
- **From the shell:** `tuiboard doctor` prints the same list as plain text and exits 0. `--json`
  prints the `SetupStatus` object, for scripts and for pasting into a bug report. It is routed in
  `bin/tuiboard.ts` like `summary` and `board` (no TUI, no preload).

Read-only: nothing here changes a file or opens a browser.

### F. Data flow

- First run: `app.tsx` already opens the wizard when there are no boards. The wizard's steps are
  `mode → (name → columns → examples) | (dir → pick)`. All disk writes stay in `src/boards/`.
- Setup: the modal reads `collectSetupStatus` with the live store's adapters and config; the CLI
  builds the same dependencies headlessly.
- Nothing new is persisted except the example tasks in the new board file.

## Testing

- **Pure:** `defaultBoardsDir` for each branch (XDG set, Documents present, neither);
  `exampleTasks` for a morning, an evening before 22:30 and a time after it; `collectSetupStatus`
  with fake file checks and adapters (everything missing, everything present, mixed);
  `hintsFor` with a modal.
- **Rendering** (`testRender`): the welcome text, each empty state (and that it disappears with a
  task), the Setup modal in the ready and not-set-up cases, the examples step.
- **Keyboard:** `S` opens Setup and does not schedule; `s` still schedules.
- **CLI:** `tuiboard doctor` and `--json` on a fresh sandbox; `board add --examples` writes the lines.
- **End to end:** the clean-machine first run once more, with before and after screens in the PR.

## Risks

- **A different default folder** could surprise a test or a path with backslashes on Windows: covered
  by the pure tests and by the sandbox run on this Windows machine. macOS and Linux are untested here.
- **`~/Documents` may be synced by OneDrive or iCloud.** For a notes file that is a feature, but it
  means a board can appear on other devices; the path is shown before anything is written.
- **Example tasks must stay easy to remove.** They are plain tasks, and the last one says how to
  delete them.
- **`S` must not clash.** The grep of `handleKey` shows `Shift+S` unused, but `s` is the schedule key
  and sits later in the same function; the order of the checks is the thing to get right.

## Decision log (agreed 2026-10-01)

1. Default folder: `~/Documents/tuiboard`, falling back to `~/tuiboard`, `XDG_DATA_HOME` respected.
2. Example tasks: offered in the create flow, on by default.
3. `S` for Setup in the app, `tuiboard doctor` on the command line.
4. The update notice ships in the same release (0.16.0, a minor, as these are new features).
5. The iCal calendar spike follows this work.
