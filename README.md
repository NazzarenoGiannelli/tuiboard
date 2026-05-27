# tuiboard

A terminal dashboard that unifies **kanban**, a **Today/Tomorrow virtual
panel**, a **24-hour timeline**, and a **live agent view** for Claude Code
sessions — all on top of plain markdown task files.

Built with [OpenTUI](https://opentui.com) + SolidJS on Bun. Cross-platform
(Linux, macOS, Windows). No vendor lock-in: boards are CommonMark with
the Obsidian Tasks-plugin emoji vocabulary, so they open and edit fine in
any markdown editor.

```
┌─tuiboard──[1 Work · 2 Personal]──────────open · done · cols───────────────┐
│ ┌Today/Tom──┐ ┌Board──────────────────────────┐ ┌─Timeline──┐             │
│ │● Today    │ │ Inbox 3   In Progress 5  Done │ │ 07 ──────  │            │
│ │ ⏰ Agenda │ │ ▶ Task 1                       │ │ 08 ──────  │            │
│ │  ⌚09:00…│ │   Task 2                       │ │ 09 ⌚ deep │            │
│ │ 🔺 Prio   │ │   Task 3                       │ │ 10 ──────  │            │
│ └───────────┘ └────────────────────────────────┘ │ 11 ──────  │            │
│ ┌Agents (live)──────────────────────────────────┐│ 12 ──────  │            │
│ │● tuiboard      Shadow  💬 attivo  📂 ...      ││ 13 ⌚ call │            │
│ │ pulse          Laptop  💤 3m fa   📂 ...      ││ ...        │            │
│ └────────────────────────────────────────────────┘└────────────┘            │
│ hjkl move · Tab board · S-Tab zone · F1/F2/F3 toggle · z zoom · ? help     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Install

```bash
git clone <this repo>
cd tuiboard
bun install
bun run dev
```

Requires [Bun](https://bun.sh) ≥ 1.3. OpenTUI ships its own native renderer
binaries — `bun install` picks the right one for your platform automatically.

For a global install (so you can run `tuiboard` from any vault directory):

```bash
bun link
```

## Configure

Copy `.tuiboard/config.example.yaml` to `.tuiboard/config.yaml` somewhere
along the path tuiboard will discover (the cwd or any parent), then edit
the `boards:` list to point at your markdown files.

`tuiboard` walks up from the current working directory looking for
`.tuiboard/config.yaml`, so the most common pattern is to drop a
`.tuiboard/` folder at your vault root. Without a config it falls back to
scanning the cwd for any `.md` file containing `- [ ]` tasks.

```yaml
boards:
  - path: ./Work.md
    name: Work
  - path: ./Personal.md
    name: Personal

assignees: [Alice, Bob]
done_column: Done
archive_column: Archive
```

## Markdown board format

`tuiboard` reads and writes **plain CommonMark** with the Obsidian
Tasks-plugin emoji vocabulary. Any markdown editor renders these files
sensibly; the Obsidian Kanban plugin renders them as a kanban; we render
them as a TUI.

### Minimal example

```markdown
---
kanban-plugin: board
---

## Today

- [ ] Fix auth flow @nazza ⏳ 2026-05-27 ⌚ 09:00-10:30 #pr-followup
- [x] Review PR #412 ✅ 2026-05-26

## In Progress

- [ ] Migrate timeline to OpenTUI @nazza

## Done
```

### Metadata vocabulary

| Symbol | Meaning | Notes |
|---|---|---|
| `## Heading` | Column name | One column per H2 heading |
| `- [ ]` / `- [x]` | Task (open / done) | Standard markdown task list |
| `@name` | Assignee | Configurable list in config.yaml |
| `#tag` | Tag | Any hashtag; passed through verbatim |
| `⏳ YYYY-MM-DD` | Scheduled date | Tasks-plugin convention |
| `📅 YYYY-MM-DD` | Due date | Tasks-plugin convention |
| `🛫 YYYY-MM-DD` | Start date | Tasks-plugin convention |
| `✅ YYYY-MM-DD` | Done date | Tasks-plugin convention |
| `⌚ HH:MM-HH:MM` | Time block | tuiboard-specific (Tasks plugin has no time-of-day) |
| `🔺 ⏫ 🔼 🔽 ⏬` | Priority | Tasks-plugin convention |

Anything else stays in the task text untouched on write-back. Roundtrip is
byte-for-byte preserving when a task hasn't been edited; structured fields
are rebuilt only after an in-app mutation.

## Layouts

Launch `tuiboard` with no flag for the default 4-zone dashboard.

| Flag | View | Use case |
|---|---|---|
| (none) | **Dashboard** — all 4 zones | Default; everything in one terminal |
| `--view=board` | Kanban + virtual panel only | Focus mode, or a single WezTerm pane |
| `--view=timeline` | Timeline fullscreen | Wall-mounted "what's now" |
| `--view=agents` | Agent view fullscreen | Cross-machine session monitor |

The dashboard auto-collapses optional zones on narrow terminals:

| Terminal width | Default zones visible |
|---|---|
| ≥ 150 cols | virtual + board + timeline + agents |
| 120–149 | virtual + board + agents |
| 100–119 | virtual + board |
| < 100 | board only |

`F1` / `F2` / `F3` toggles override the auto-collapse for the current
session (until the next terminal resize).

## Keyboard

### Navigation

| Key | Action |
|---|---|
| `h j k l` / arrows | Move cursor inside the active zone |
| `Tab` | Cycle to next board |
| `1`..`9` | Jump to board N |
| `v` | Toggle Today/Tomorrow virtual panel focus |
| `Shift-Tab` | Cycle active zone (virtual → board → timeline → agents) |
| `F1` / `F2` / `F3` | Toggle visibility of Virtual / Timeline / Agents zones |
| `z` | Zoom active zone to full screen |

### Task actions (work in board, virtual, AND timeline zones)

| Key | Action |
|---|---|
| `Enter` | Toggle done |
| `o` | Open detail view |
| `e` | Edit task text |
| `s` | Schedule date modal |
| `t` | Set scheduled = today |
| `m` | Set scheduled = tomorrow |
| `.` | Schedule **now** — time block at the next 15-min slot |
| `b` | Set time block modal |
| `p` | Cycle priority (none → 🔺 → ⏫ → 🔼 → 🔽 → ⏬ → none) |
| `a` | Set assignee |
| `d` | Delete task (with confirm) |
| `Shift-X` | Archive task → moves to Archive column |

### Multi-select

| Key | Action |
|---|---|
| `Space` | Mark / unmark task — task actions then apply to ALL marked |
| `Esc` | Clear marks (when no modal is open) |

### Board-only / bulk / global

| Key | Action |
|---|---|
| `n` | New task in current column (quick-add syntax) |
| `Shift-T` | Reset ALL overdue tasks (any board) to today |
| `Ctrl-Z` | Undo last mutation |
| `?` | Help modal with the full reference |
| `q` · `Ctrl-C` | Quit |

## Status

- **v0.5** — daily-driver ready. Kanban + virtual + timeline + agents
  all functional, multi-select, undo, atomic file roundtrip, mouse click,
  responsive layout. Tested on Windows with WezTerm; Linux/macOS should
  work via the same OpenTUI binaries (untested).

## License

MIT (pending).
