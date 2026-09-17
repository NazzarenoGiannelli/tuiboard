# Changelog

All notable changes to **tuiboard** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Agents list stays in order when sessions move** (#52). A new session
  appearing on top could show twice, leave blank rows, or draw rows in the
  wrong order past the panel border; the lists now keep one stable row per
  position. The cursor also stays on the session you selected while the list
  reorders, instead of silently landing on another one (so Enter, `H` and `c`
  act on the session you picked).
- **`--view=agents` / `--view=timeline` / `--view=board` start on their own
  zone** (#54), so the cursor and keys work right away instead of acting on
  the hidden planner.

## [0.13.0] - 2026-09-17

tuiboard and [herdr](https://herdr.dev) now work as one: the Agents zone shows
herdr's live state for every session open there, speaks herdr's status
symbols, and `H` jumps to a session in herdr or resumes it in the right
workspace. Plus fixes found using it all day on Windows.

### Added
- **Live agent state from herdr** (#37). When herdr is running, tuiboard polls
  `herdr api snapshot` and links every pane running Claude Code, Codex,
  OpenCode or Pi to its session — by the session id/file herdr reports (with
  herdr's agent integrations installed), else by agent and directory. Those
  sessions take herdr's state, including two new ones: **waiting for you** and
  **done**; idle Codex/OpenCode/Pi sessions become visible, and long Claude
  turns no longer show as stale (#22). Zoomed cards and the `o` detail show the
  herdr workspace and tab.
- **herdr's status symbols** — `×` waiting, `◐` working, `✓` done, `○` idle,
  `·` closed (tuiboard's own `△` for stale) — are the default for everyone, so
  both tools read the same; `status_indicators: dots` keeps colored dots.
- **`H` opens sessions in herdr** (#38): focuses the pane a session is open
  in, or resumes it in herdr — a new tab named after the session, in the
  workspace that already holds that directory (else one named like the
  folder, else the focused one). **Enter** on a session already open in herdr
  focuses it instead of starting a second copy.
- **Omarchy bar widget in the repo** (#27): `omarchy-plugin/` — an
  overdue/today badge and a Today/Tomorrow panel (done, undone, defer, open
  tuiboard) built on `tuiboard summary` / `tuiboard task`, installed with
  `omarchy-plugin/install.sh`. Repo only, not part of the npm package.

### Changed
- **Agent sessions are sorted by most recent activity** (#43), newest first,
  instead of by status first — a session used 40 seconds ago no longer sits
  below ones idle in herdr for hours. Status only breaks ties; archived
  sessions stay at the bottom.
- Launch steps for Enter and `H` run asynchronously: a slow start (cold
  PowerShell, an agent booting in herdr) no longer freezes the UI.

### Fixed
- **Quitting gives the terminal back** (#47). `q`, Ctrl+C and termination
  signals exited without tearing down the renderer, leaving mouse tracking
  and the alternate screen on — moving the mouse at the shell then printed
  `51;7;45M…`. tuiboard now restores the terminal before exiting, and the
  `tuiboard` launcher resets mouse/paste/focus reporting and the cursor after
  the app ends, whatever way it ended.
- **`H` on Windows with Codex, OpenCode and Pi** (#41). npm-installed CLIs on
  Windows are an extensionless sh shim next to `.cmd`/`.ps1`, which herdr
  can't launch directly ("not a valid Win32 application"); on Windows the
  resume command is typed into the new pane's shell instead.
- **Responsive layout follows the renderer's terminal size** (#45), the size
  the frame is drawn at, instead of `process.stdout.columns`.

### Known issues
- On Windows, herdr may not detect Pi sessions as agents (#49): they open
  fine, but without herdr's live state.

## [0.12.0] - 2026-09-17

The Agents zone stops being Claude-Code-only: it now lists **Codex, OpenCode
and Pi** sessions next to Claude Code, tells them apart at a glance, and
reopens any of them in whatever terminal and shell you use (#12).

### Added
- **Codex sessions** (#20). Read-only from Codex's rollout files under
  `$CODEX_HOME` (default `~/.codex`), including archived and zstd-compressed
  ones, with names from `session_index.jsonl` / the state DB; resume with
  `codex resume <id>`. Subagent threads are hidden.
- **OpenCode sessions** (#17). Read-only from OpenCode's SQLite store
  (`$XDG_DATA_HOME/opencode/opencode.db`); resume with
  `opencode --session <id>`.
- **Pi sessions** (#33). Read-only from Pi's JSONL sessions
  (`~/.pi/agent/sessions/`, honoring `PI_CODING_AGENT_DIR`,
  `PI_CODING_AGENT_SESSION_DIR` and `sessionDir`); names from `/name`; resume
  with `pi --session <id>`.
- Codex, OpenCode and Pi keep no record of running processes, so their
  sessions are busy while a turn is open and turn stale once it stops updating
  for 30 minutes; an open-but-idle TUI of theirs isn't detected.
- **Harness badge, model and harness filter** (#23). Each session shows a
  colored `cc` / `cx` / `oc` / `pi` badge and its model (`opus-5`,
  `gpt-5.5-codex`, …), also in the `o` detail. `f` in the Agents zone cycles
  all → cc → cx → oc → pi; the active filter shows in the panel title.
- **Two-line session cards** in the zoomed / fullscreen Agents view: title and
  age on top, model · branch · directory underneath. The dashboard strip stays
  one line per session and fits its fields to the real row width, dropping
  model, then branch, then directory before shortening the title.
- **Enter opens sessions in any common terminal, not only WezTerm** (#25).
  tuiboard detects where it runs — tmux, herdr, WezTerm, Windows Terminal (new
  tab), Ghostty (new window) — and otherwise uses the OS default:
  `xdg-terminal-exec` on Linux, a new console window on Windows, Terminal.app
  on macOS. If launching fails, the resume command is copied to the clipboard
  and the banner says so. New `resume_terminal` option forces one;
  `resume_command` still wins.
- **Resumed sessions run in your shell** (#31). `auto` follows the shell you
  started tuiboard from — on Windows Git Bash (Git's `bin\bash.exe`, never
  WSL's), Nushell or PowerShell; `$SHELL` elsewhere — and the shell stays open
  after the agent exits. New `resume_shell` option (`bash | zsh | fish | nu |
  pwsh | powershell | cmd`) forces one.
- **Enter diagnostics.** The `o` detail shows the full result of a session's
  last Enter, and `bun run agents:open <session-id-prefix> [--dry-run]` (in a
  checkout) prints the detected terminal, shell and exact launch command.

### Changed
- **Agent CLIs plug in through a common adapter interface** (#16). Claude Code
  sessions behave as before. The `stale-pid` status is now `stale` (same glyph
  and color), since not every agent writes PID records.
- **New `{resume}` token** for `resume_command` and `copy_resume_command`: the
  selected agent's own resume command. The `copy_resume_command` default is now
  `cd "{cwd}" && {resume}`; custom templates using `claude --resume
  {sessionId}` keep working unchanged.
- **The Agents zone refreshes per agent.** A change under one agent's session
  store re-scans only that agent, and a session writing non-stop still
  refreshes at least once a second. Session stores that don't exist yet when
  tuiboard starts (agent installed later, first session) are picked up within
  a few seconds instead of needing a restart.

### Fixed
- **Enter in Windows Terminal** (#29). `wt.exe` (and a Store-installed `pwsh`)
  are App Execution Aliases that Bun's spawn can't find; Windows launches now
  go through PowerShell's `Start-Process`, which resolves them. Session
  directories stored with `/` (OpenCode) are passed as `\`.
- **Agent directories keep `/` on macOS/Linux** — the shortened path was always
  joined with `\`.

## [0.11.0] - 2026-09-16

### Fixed
- **Zoomed column titles no longer truncate short of the available width.**
  The zoomed `<TaskRow>` read a hardcoded `availableWidth` of `100` regardless
  of the terminal's real size, and a separate 60-character cap on the title
  never lifted for zoomed columns — together they clipped titles well before
  the column's actual right edge, sometimes with a garbled double-truncation
  (`walk t...gh backgro…`). The real measured viewport width now drives the
  budget, the cap lifts when zoomed, and the width is re-measured on
  zoom-toggle and terminal resize. Thanks @ArjunAnil2000.
- **A board's configured display `name` no longer reverts to the filename on
  an external edit.** `loadAll()` applied `config.boards[].name` on startup,
  but the file-watcher's reload path re-parsed the board from disk without
  reapplying it, so any edit made outside tuiboard (another editor, a sync
  tool, a script) silently renamed the board back to its filename-derived
  default. The reload path now reapplies the configured name, matched by
  filepath, the same way the initial load already did. Thanks @ArjunAnil2000.

### Changed
- **Keyboard reference (`?`) restyle + scroll.** The help modal now groups
  shortcuts under emoji section headers, color-codes the key (accent) vs. its
  description (dim) with a dotted leader between them, and wraps long
  descriptions into their own aligned column (no more continuation text running
  under the keys). The whole reference now lives in a scrollbox so it never
  clips on short terminals — `j`/`k` (or arrows) scroll it. Shortcut text is
  unchanged, except that two entries missing from the rewrite (`+` New board,
  `c` copy resume command in the Agents zone — both real, both still bound)
  were restored during review. Thanks @k0-ba.

## [0.10.0] - 2026-09-09

### Added
- **A task's note is readable inside tuiboard.** When a task's title is a link —
  `[[Nome nota|Titolo]]` or `[Titolo](Tasks/Nome.md)` — the detail view (`o`)
  shows that note's text, scrollable, instead of pointing at Obsidian. Both link
  forms work, so the convention stands on its own: a board written in plain
  markdown gets the feature too. Links *inside* a sentence stay mentions and are
  listed as before — a task that mentions a person is not documented by that
  person's page. A missing note says which name it looked for; two notes sharing
  a name resolve to the nearest and the shadowed one is named.

### Fixed
- **Markdown links no longer show as raw syntax in task titles.** `displayTitle`
  stripped wikilinks but not `[text](path.md)`, so a board written without
  Obsidian showed the whole link as its title — in the board, the planner and
  the bar widget.

## [0.9.2] - 2026-09-08

### Fixed
- **A narrow terminal now opens on Today/Tomorrow**, like a wide one, instead of
  on the first column of the first board. The default was conditioned on the
  planner *fitting* rather than being enabled — the last place still reading
  "does not fit" as "does not exist" — so single-pane skipped it.

## [0.9.1] - 2026-09-08

### Fixed
- **Modals were unreadable in single-pane.** With one zone filling the screen a
  dialog floated over it as an absolute overlay — and had nothing to paint over,
  because the theme leaves panel backgrounds transparent so the terminal shows
  through. The keyboard reference interleaved with the pane character by
  character; the new-task and edit dialogs were effectively invisible. A modal
  now takes the pane's place, exactly as the four-zone layout drops it into the
  Agenda's slot: with one zone on screen, that zone *is* the slot.
- **A dialog standing in for a pane now fills it**, in both axes, like the zone
  it replaces — instead of keeping a slot-sized box while the rest of the strip
  sits empty, which read as a window that had failed to open. In the four-zone
  layout it still matches the Agenda's slot to the cell, or the whole dashboard
  would shift when a modal opens; verified by the frame borders landing on
  identical columns with and without a modal.

## [0.9.0] - 2026-09-08

### Added
- **Single-pane mode for narrow terminals.** Below 100 columns tuiboard used to
  drop every zone but the kanban — the least readable thing at that width, and
  the only one that cannot be hidden — leaving the planner and agenda
  unreachable. Now the zones queue instead of disappearing: one on screen at a
  time, `h`/`l` walking a ring (planner → each board column → agenda → agents,
  wrapping), `Shift-Tab` jumping whole zones, and the top bar showing where you
  are (`⤢ Today / Tomorrow ‹ 1/8 ›`). `z` still enters and leaves it by hand at
  any width. Resizing no longer moves your focus.
- **`tuiboard --view=planner`** — open on Today/Tomorrow alone, for a vertical
  strip beside other work.
- **Boards can be created from inside tuiboard.** A `+` chip at the end of the
  board tabs — clickable, or the `+` key — opens a wizard that either creates a
  new markdown board or scans a folder and adopts the boards already in it.
- **First run onboards instead of failing.** Launching with no config used to
  print `No boards found` and exit, sending the user to write a file they had
  never seen. The same wizard now opens, writes the config, and opens the board.
- **`tuiboard board add|scan|list`** — the same operations headless, for scripts
  and widgets. Adding a board edits the config **by insertion**: comments,
  calendars, `resume_command` and formatting survive because they are never
  rewritten.
- New boards are proposed next to the boards you already have, so they inherit
  that folder's sync and versioning; the fallback is `~/.local/share/tuiboard/boards/`.

### Fixed
- **A fresh install could crash on the `~/*` path alias**
  (`Cannot find module '~/ui/splash-boot'`) — `tsconfig.json` wasn't in the
  published `files` list yet. Fixed as a side effect of the packaging cleanup
  below, but never called out on its own at the time; three users hit it on
  0.8.3/0.8.4 and filed independent issues before this line existed. Noted
  retroactively on 2026-09-16.
- **The key hints no longer truncate mid-word on a narrow terminal.** The
  bottom bar is a 130-character line that truncates rather than wraps, so at 60
  columns it read `⏎ don…schedule`. In single-pane it keeps only the keys that
  matter with one pane on screen; the full sheet is one `?` away.
- **A board without a `%% kanban:settings %%` trailer grew a blank line on every
  save.** The final newline of the file was parsed as a blank line and written
  back as one, plus a new terminator. Boards with the trailer were unaffected,
  which is why it went unseen — but the demo boards in `examples/` were failing
  the round-trip check, and any board tuiboard creates itself would have too.

### Changed
- **Slimmer published package.** The `files` field shipped `src/` whole, so the
  tarball carried the test suite and the dev check scripts to every install.
  53 files → 42, 453 kB → 406 kB unpacked. Nothing that runs was removed:
  verified by installing the tarball into a clean project and running both
  headless commands from it.

## [0.8.5] - 2026-08-31

### Added
- **`tuiboard summary` — JSON snapshot for status bars and scripts.** Totals, a
  per-board breakdown, and `planner`: the same Today / Tomorrow / Overdue
  aggregation the planner zone renders, built from `buildPlannerItems()` so a
  bar widget and the dashboard can never disagree about what is due. `--pretty`
  to read it, `--next N` to size (or drop) the per-board upcoming list.
- **`tuiboard task` — headless mutations.** `done`, `undone`, `defer` and `add`
  against a board file, matched **by title rather than index** so a task that
  moved is a miss instead of the wrong task. `--dry-run` reports without
  writing; an ambiguous title is refused rather than guessed at; exit 3 means
  the board changed on disk since it was read.
- **`undone` reopens a completed task**, dropping its `✅` date with the tick —
  the exact inverse of `done`, and the same semantics as the TUI's Enter.
- **`defer` moves the date the planner actually reads** (`scheduled`, else
  `due`, else adds a `scheduled`), so the row really moves. Defaults to
  tomorrow; `--days N` or `--to YYYY-MM-DD` for anything else, `--days 0` to
  pull a task back to today.
- **Planner entries in `summary` now report `done` and `doneDate`.** Today and
  Tomorrow keep completed tasks — a day's plan is a record of the day — so
  without this a consumer had no way to tell a ticked task from an open one.

### Fixed
- **Node's warnings no longer scribble on the dashboard.** OpenTUI registers one
  `selection` listener per `<scrollbox>`, and a full dashboard keeps more than
  ten alive (one per board column, plus planner, timeline and agents), tripping
  Node's default `MaxListeners` cap of 10 — usually when `Tab` mounted a new
  board's columns. The warning went to stderr, which is the alternate screen the
  renderer believes it owns: two lines scrolled the buffer and every repaint
  after that landed rows off, so the layout appeared to break on a keypress. The
  cap is now sized for the real number of zones, and any remaining warning is
  filed in `~/.cache/tuiboard/warnings.log` instead of on the screen.

## [0.8.4] - 2026-07-31

### Added
- **Copy a session's resume command (`c` in the Agents zone).** Select a Claude
  Code session and press `c` to copy a one-paste command that `cd`s into its
  directory and resumes it — `cd "<cwd>" && claude --resume <id>` by default — so
  you can drop it into any tab or pane, on any machine layout, without depending
  on WezTerm (which `Enter` requires). The format is configurable via
  `copy_resume_command` (tokens `{cwd}` / `{sessionId}`); Nushell users can swap
  `&&` for `;`. The session detail view (`o`) now shows this exact command.

### Fixed
- **Modals now appear in zoom mode.** Opening a modal (new task, schedule, time
  block, assign, edit, delete, search, new event…) while a zone was zoomed (`z`)
  set the modal state but rendered nothing — the zoomed layout had no Agenda slot
  to host it, so the dialog was invisible and you typed blind. The modal now
  floats as a centered overlay on top of the zoomed view; closing it returns you
  to the zoomed view exactly as you left it.

## [0.8.3] - 2026-06-04

### Added
- **Boot splash.** Launching tuiboard now paints a `tuiboard` wordmark (FIGlet
  "Rectangles", in the tool's light-yellow accent) the instant the process
  starts, so the ~1s cold start (runtime + store build + first calendar/agents
  read) isn't a blank terminal. The launcher animates the booting dots while the
  dashboard process loads in parallel, then hands the screen over cleanly — no
  startup time added. Set `TUIBOARD_NO_SPLASH=1` to disable; it also no-ops when
  output isn't a TTY or the terminal is tiny.

## [0.8.2] - 2026-06-04

### Changed
- **Consistent date shortcuts everywhere.** `m` now means "tomorrow" in every
  date input (the schedule modal, the new-event/edit modals, and quick-add),
  matching the board's `m` = tomorrow key — so `t`/`m` = today/tomorrow whether
  you press them on a card or type them into a field. `tm`/`tom`/`tomorrow`/
  `domani` still work as aliases. Hints and the help screen updated to lead with
  `m`. (Audit of all shortcut surfaces found this was the only divergence; the
  rest — `t`, `-`/empty to clear, weekdays, ±N — were already aligned.)

## [0.8.1] - 2026-06-04

### Added
- **Set an event's date from the Agenda modal.** When creating or editing a
  Google Calendar event you can now append a date token to the title — `t` /
  `tm` / `+3` / `lun` / `2026-06-10`, the same shortcuts as task scheduling — so
  you're no longer limited to the day the Agenda is showing. Natural order is
  `Title [date] HH:MM-HH:MM` (e.g. `Lunch tomorrow 12-13`); without a date token
  it still defaults to the viewed day. On edit, a date token moves the event to
  another day.
- **All-day events now show in the Agenda.** Previously skipped, all-day events
  (Google and Microsoft) render as a chip strip at the top of the Agenda — like
  Google Calendar's all-day band — instead of being dropped.
- **Create all-day events from the Agenda.** Add `allday` (or `all-day`) anywhere
  in the new-event title — e.g. `Holiday 2026-12-25 allday` — to create a
  date-only Google event instead of a timed one. It appears in the top chip
  strip. (Editing all-day events isn't supported; create only.)

## [0.8.0] - 2026-06-03

### Added
- **Create, edit & delete Google Calendar events from the Agenda** (opt-in
  write). Re-authorize with `tuiboard calendar-setup google --write`, then:
  - **Create** — press `n` (or click an empty Agenda slot) to open a new-event
    modal: type a title (append `HH:MM-HH:MM` to set the time), pick the target
    calendar, Enter to create. A `default_calendar` config sets the default
    target (override per-event in the modal).
  - **Edit / delete** — click an existing event on a writable calendar to select
    it, then `e` (or Enter) to edit its title/time, `d` to delete (with confirm),
    `Esc` to deselect. Edits stay on the same calendar. Read-only events can't be
    selected.

  Every change appears in the Agenda and on Google Calendar immediately.
  Read-only setups are unaffected — the write UI only appears when the token
  carries the write scope, and only Google events on owner/writer calendars are
  selectable. Microsoft event write is not supported yet.
- Expanded the README with a step-by-step Google Cloud OAuth client setup (the
  bring-your-own-credentials flow), so first-time users have a clear path.

## [0.7.3] - 2026-06-02

### Fixed
- Opening a modal no longer shifts the whole dashboard up by a row. The Agenda's
  tall scrollbox was inflating the main row one line past the terminal (flex
  basis `auto` takes the content height); a modal in its place removed that
  overflow, which read as a jump. The main row now grows purely from the
  available space (`flex-basis: 0`), so the layout is steady whatever's on
  screen. Modals also render in the Agenda's exact slot, so there's no
  horizontal reflow either.

### Changed
- Reclaimed a row: the board and agenda are one row taller, and the keyboard
  cheat-sheet sits flush on the bottom line.

## [0.7.2] - 2026-06-02

### Changed
- Documentation: the intro and npm description now lead with the modular pitch
  (a kanban with three optional panels you switch on or off) instead of a
  bundled four-zone dashboard.

## [0.7.1] - 2026-06-02

### Changed
- Modals (new task, schedule, time block, assign, delete, detail, search, help)
  now open in the Agenda's slot — an opaque panel of the same width — instead of
  a side panel that pushed the dashboard left. Opening a modal no longer reflows
  the board/planner; the Agenda returns when the modal closes.
- Modal titles now ride in the panel's top border (`┤ … ├`), matching the board
  columns and the zones, instead of sitting as a body text line.
- A clipped board column keeps its task rows until it's scrolled down to less
  than half visible (previously: blanked as soon as it was clipped at all), so a
  column that's mostly on-screen stays useful.

## [0.7.0] - 2026-06-01

### Added
- **Configurable zones.** A `zones:` config block turns the planner, agenda, or
  agents view off (`off`), starts it collapsed (`hidden`), or leaves it on
  (`on`, the default; `true`/`false` alias `on`/`off`). The board is always on.
  tuiboard can now be a pure kanban, kanban + calendar, kanban + agents, or any
  mix. A disabled zone is never rendered, is skipped by `Shift-Tab`, has an
  inert F-key, and **its background work never starts** — no calendar fetch and
  no `~/.claude` reads when the agents zone is off.
- Documented zones in the README, the AI setup prompt, and `config.example.yaml`.

### Changed
- Renamed the internal "virtual" zone to **"planner"** throughout (code,
  identifiers, comments, and the `VirtualPanel`/`virtual-panel` files) for
  clarity. The visible "Today/Tomorrow" panel is unchanged.
- Reworked the responsive layout to combine three inputs — `enabled ∧ desired ∧
  fits-width`. Auto-hide now only reports what fits; it never force-shows a
  disabled or intentionally-hidden zone, and `F1`/`F2`/`F3` toggles persist
  across terminal resizes.

## [0.6.2] - 2026-05-30

### Changed
- Updated the hero screenshot to show the live calendar overlay (Google +
  Microsoft 365 events side by side) and the aligned agent rows.
- Refreshed the README intro to mention the calendar overlay.

## [0.6.1] - 2026-05-30

### Added
- **Manual full-refresh key (`r`).** Reloads boards from disk, rescans agents,
  and force-refetches the agenda calendar (bypassing the 30-minute cache) so
  externally-edited events show without a restart.

### Changed
- Day-navigation keys (`[` / `]` / `\`) now work from any zone, not just when
  the agenda is focused; pressing one also moves focus to the agenda.
- Added arrow keys and `r refresh` to the bottom cheat-sheet; the day-navigation
  hint is now always visible in the agenda's resting state.
- Agent rows right-align the activity age in a fixed-width field so the end of
  each working directory lines up across rows.

## [0.6.0] - 2026-05-30

First public release on npm. This entry captures the full feature set at launch.

### Added
- **Kanban board** over plain CommonMark files using the Obsidian Tasks-plugin
  emoji vocabulary — no lock-in, the files stay yours. Multiple boards as tabs;
  `##` headings become columns; `Done` and `Archive` columns are treated
  specially. Quick-add syntax (`@assignee`, `#tag`, scheduling, time blocks,
  priority), multi-select (`Space`), undo (`Ctrl-Z`), filters, search (`/`),
  zoom (`z`), and atomic file round-trips with an external-edit watcher.
- **Planner** — a Today/Tomorrow panel aggregating everything scheduled across
  all boards.
- **Agenda** — a 24-hour timeline with click-to-arm time-blocking, plus a
  read-only **calendar overlay** for Google Calendar and Microsoft 365
  (dependency-light, bring-your-own-credentials, all-day events skipped, each
  calendar in its own color). Day-navigation with `[` / `]` / `\` pages tasks
  and events across days.
- **`tuiboard calendar-setup`** — one-time OAuth for new users (Google browser
  flow, Microsoft device-code flow); prints the exact `calendars:` block to add.
- **Live agents view** — reads local Claude Code sessions from `~/.claude` with
  zero setup, showing status, branch, and last activity. `Enter` opens a session
  in a terminal; the launch command is overridable via `resume_command`.
- **Keyboard-first with full mouse support**, a responsive multi-zone layout
  that adapts to terminal width, standalone `--view=` modes, and the `tb` alias.
- Config resolution via `$TUIBOARD_CONFIG`, a project-local `.tuiboard/`, the
  global `~/.config/tuiboard/`, or a cwd fallback scan.

Built with [OpenTUI](https://opentui.com) + SolidJS on Bun.

[0.13.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.13.0
[0.12.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.12.0
[0.11.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.11.0
[0.10.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.10.0
[0.9.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.9.2
[0.9.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.9.1
[0.9.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.9.0
[0.8.5]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.5
[0.8.4]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.4
[0.8.3]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.3
[0.8.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.2
[0.8.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.1
[0.8.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.8.0
[0.7.3]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.7.3
[0.7.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.7.2
[0.7.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.7.1
[0.7.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.7.0
[0.6.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.2
[0.6.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.1
[0.6.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.0
