# Changelog

All notable changes to **tuiboard** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **An update notice.** When a newer tuiboard is on npm, a toast on the bottom bar says so, once per
  version, with the command that fits how you installed it (`bun add -g tuiboard@latest
  --no-cache` for a bun global install, `bunx tuiboard@latest`, or `git pull && bun install` for a
  checkout). It asks the npm registry at most once a day, in the background, a second after start;
  the answer is cached in `~/.cache/tuiboard/update.json`. It stays quiet on a first run, in the
  headless commands, in CI and without a terminal. `update_check: off` in the config or
  `TUIBOARD_NO_UPDATE_CHECK=1` turns it off.
- **A first run that teaches.** The first screen now says what tuiboard is (a kanban board on
  plain markdown, plus a Today/Tomorrow planner, a day agenda and a live list of your coding
  agents, of which only the board is required). Creating a board offers four example tasks that
  name the keys to try, one with an hour so the Agenda has something on it; from a shell it is
  `tuiboard board add --examples`. An empty planner, board, Agents list or Agenda says what to do
  next instead of staying blank.
- **Setup.** `S` in the app opens a dialog on what is set up (boards, the coding agents tuiboard
  can read, herdr, calendars, zones, the update notice, and where new boards go), with a `✓` or a `○`
  for each, one row per item so it fits a 24-row terminal (five boards at most, then `+N more`).
  `tuiboard doctor [--json]` prints the same from a shell, read-only. It exits `0` on a report, `1`
  when the config cannot be read and `2` on a usage error. Both say the update notice is off under
  `update_check: off`, `TUIBOARD_NO_UPDATE_CHECK=1` or in CI, and `--json` always has the same
  keys (`null` where nothing is known).

### Changed
- **New boards go in a visible folder.** With no boards to learn from, a new board is created in
  `~/Documents/tuiboard` (when you have a Documents folder), then `~/tuiboard`, instead of
  `~/.local/share/tuiboard/boards`. Boards
  already in your config stay where they are, and `XDG_DATA_HOME`, when set, still decides. The
  name field also takes a path (`~/notes/Work`), and when the proposed folder cannot be written to
  the wizard switches to `~/tuiboard` and says so.
- **The bottom bar shows the open dialog's own keys.** `Enter confirm · Esc cancel` in an ordinary
  dialog, `Esc close` in Setup, and `Enter confirm` alone on the first-run welcome, which cannot be
  dismissed.

## [0.15.1] - 2026-09-30

### Fixed
- **No more "..." in the middle of every grid line.** The Agenda's hour rules, dotted rows and
  the "now" line were drawn 120 cells wide and left to be cut off, and the terminal cut them in
  the middle with an ellipsis: a white blob in each row of the grid. They are now drawn exactly as
  wide as the lane.

### Changed
- **The README leads with the app in motion**: the whole dashboard, a short tour of clips (drag and
  resize, the tray, the agents list, multi-select, the zones) and v0.14 and v0.15 in Status. The
  pictures are tuiboard's own renderer on an invented demo board.
- **`homepage` is the website**, <https://tuiboard.nazzareno.xyz>, which now shows the real app
  instead of mockups.

### Added
- **A demo environment** (`demo/`, not published): three invented boards for a made-up team,
  always dated today, covering overdue, today with and without an hour, blocks that nest,
  overlap and touch, tomorrow, coming days, due dates, done and an undated backlog. `bun run
  demo` seeds and opens tuiboard on it. `demo/shots/` renders the app headless on those boards
  into images and video.
- **Release content tooling** (`demo/`, not published): `bun run demo:shots` renders pictures and
  clips of every zone (the terminal in an acrylic window on the brand gradient, or bare for a web
  page with `--site`); the Agents pane is fed invented sessions from the four harnesses, never the
  real ones. `bun run demo:film` builds a 36 second launch film (`demo/promo/`): a virtual camera on the real
  app, from extreme close-ups with a shallow depth of field to the whole window, then narrowed to
  a single pane; paced by content against a cue sheet, with
  `edit_audio.py` fitting the music, `beatgrid.py` to measure a track and a synthesised placeholder.

## [0.15.0] - 2026-09-30

### Added
- **Drag to move and resize.** While a block is armed, dragging its body moves it
  and dragging its bottom edge changes its length; the edge shows a handle
  (`━ ↕`) so it can be found. Positions follow the rows you move across, in
  15-minute steps, and the length never goes below 15 minutes. The Agenda is now
  tested against OpenTUI's mock mouse on the real view: clicks, double clicks and
  drags.
- **A "To place" tray in the Agenda.** The day's tasks that have no hour yet sit
  at the top of the Agenda, and it is one cursor with the blocks below: `j`/`k`
  walk both, and every task key (`Enter`, `m`, `t`, `s`, `b`, `.`, `c`…) works on
  a tray row. In single-pane, where the board is not on screen to pick from, the
  Agenda is now enough to look after the day's tasks. (An earlier version had a
  tray; it went to keep the Agenda a plain time scan. Single-pane brought the
  need back.)
- **Placing a task from the keyboard.** `c` arms the task under the cursor and the
  first `j`/`k`/`+`/`-` puts it in the first free half hour (from now today, from
  09:00 on other days, clear of blocks and calendar events); from there the keys
  nudge it like any armed block. `Enter` keeps it, `Esc` puts it back in the tray,
  and the cursor follows the task either way. Choosing the slot no longer needs
  the mouse.
- **The bottom bar follows what you are doing.** In the Agenda it lists the
  Agenda's keys; with a block armed it says how to move, resize, keep or undo it;
  arm mode waiting for a task says what to click.

### Changed
- **Arming only arms.** Arming a task from the tray (a double click, or `c`) put it
  in the first free half hour straight away, somewhere you had not looked and out of
  the tray before you had decided anything. Now the task waits, marked in the
  tray, and you say where it goes: a click on a slot puts it there (30 minutes), or
  the first `j`/`k`/`+`/`-` puts it in the first free half hour, from where the keys
  nudge it like any armed block. The bottom bar says which. A task that already has
  an hour is armed where it is.
- **Agenda mouse: one click selects, two arm; once armed, click anywhere to place
  and click twice to let go.** Any click on a block used to arm it, so merely
  pointing at a task made it the armed one: `Enter` then meant "keep the
  placement" instead of "done", and the only tasks you could tick were the ones
  you had not touched. Now a click moves the cursor to the block (Enter ticks
  it, `m`/`t`/`s`/`b` work on it) and a double click arms it. Armed, every click
  is about that block: one click puts it at the row clicked and two keep it
  there and let go, like `Enter` (the first click of the pair already moved it,
  so it stays exactly where you pointed). A click on another block still places
  the armed task at its start; arm mode, turned on with `c`, still arms on every
  click.
- **One line says what is armed** in the Agenda, instead of two; the keys that
  apply are on the bottom bar.
- **A click on an empty slot no longer opens the new-event dialog.** With nothing
  armed it was how a stray click became a calendar event, and without Google write
  connected it did nothing at all. It now says what to press: `n` adds an event,
  `c` places a task. Clicking an event still selects it, and clicking with a task
  armed still places it.
- **The keyboard is tested in every layout.** A new suite drives the real key
  handler in wide, mid-width, narrow (single-pane) and zoomed layouts built the
  way the app builds them: day navigation, Shift-Tab, `h`/`l`, `z`, `v`, F1-F3,
  task actions from board, planner and Agenda, arm mode, multi-select, dialogs
  and boards. It needs OpenTUI's Solid preload, so the repo now has a
  `bunfig.toml` that registers it for `bun test`.

### Fixed
- **A block's fill is its box.** The fill painted the whole lane, hour gutter included, from the
  top of the row that carries the top edge to the bottom of its last body row, and left the row
  that carries the bottom edge bare, so it read as shifted up against the outline. The box's own
  cells now carry the fill: the top edge, the body and the bottom edge, and only the box's
  columns, so the hour gutter beside it stays clear and the outline sits evenly inside the fill.
- **Overlapping blocks keep one width from their top edge to their bottom edge.** The
  grid drew a row as two lanes only where a second block was present, so a block was a
  full lane wide on the rows where it was alone and half that where a neighbour joined:
  a box inside another, or two that overlapped in part, changed width down their height
  and could not close. A group of overlapping blocks is now two lanes wide from its first
  row to its last closing rule, each block keeps its lane, the lanes have exact widths
  (the right one lost its closing corner to a rounding difference), and the hour rule
  continues across an empty lane. A third block overlapping two others is still hidden
  behind the "hidden by 3-way overlap" warning.
- **Carrying a block no longer scrolls the grid under the pointer.** The scroll-to-the-
  cursor effect also listened to every change of a block, so each step of a drag could
  scroll the grid while the pointer moved. It now looks only at the cursor, and never
  while a block is being carried. The drag also listens to the "pointer over" events,
  which go to whatever is under the pointer now, as a second way to hear it move.
- **Dragging a block no longer selects text.** Pressing and dragging across another
  block's text started the terminal's own text selection, painting what you passed
  over as selected. The Agenda's text is not selectable now, and a drag carries the
  block to the pointer's last position, including the one that arrives with the
  release.
- **The grid follows the selected block, all of it.** A click parked the cursor on the
  first row for an instant and the grid scrolled to the first block of the day before
  settling on the clicked one, which then sat at the bottom edge with only its first
  quarter of an hour showing. The scroll now reads the cursor when it fires and shows
  the whole block with a row of context; a block already in view does not move the
  grid.
- **The Agenda grid reads like a ruler, and blocks are boxes on it.** Rows are
  instants, not cells: the hour line `10 ───` is 10:00, and a block started on its
  row but stopped one row short of its end, so every block looked a quarter of an
  hour too short at the bottom, a 15-minute block looked like 30, and the hour labels
  vanished under any block that covered them. A block is now a rounded box whose top
  edge is on the row of its start, with the time set into the edge
  (`╭─┤ 09:00-09:30 ├──╮`), and whose bottom edge is on the row of its end, so its
  physical edges line up with the grid's lines. A quarter of an hour is one row with
  the title beside the time; back-to-back blocks share the line between them
  (`├─┤ … ├──┤`); the hour stays written in the gutter on every row that starts one,
  blocks or not. The armed block's bottom edge is its handle (`╰━ ↕ ━━╯`). The boxes
  are sized to the lane, so the corners land on its edge, in single-pane and beside
  the board alike.
- **You can click a row covered by the block itself.** Clicking inside the armed
  block's own body did nothing, so a quarter-hour nudge by mouse was impossible
  whenever the time you wanted was under the task. It now puts the start on the
  row you clicked.
- **The tray's rows can be clicked.** They ignored the mouse, so a task in the
  "To place" tray could only be reached with the keyboard. A click selects it
  and a double click arms it, as `c` does.
- **The lines above the Agenda's grid no longer get squeezed away.** The grid's
  scrollbox started from the height of the whole day, and the short lines above it
  (day navigation, armed state) paid for it; on a short terminal they could
  vanish. It now takes what is left.
- **`[`, `]` and `\` work in single-pane.** They moved the Agenda's day only when
  it was drawn, and the Agenda is drawn beside the board from 150 columns up, so
  in a narrow single-pane terminal, where it is one Shift-Tab away but drawn
  alone, the three keys did nothing. They now ask the same question Shift-Tab
  does — is this zone reachable? — so they work wherever the Agenda is, and
  still stay out when it is off or hidden with `F2`.
- **`c` (arm mode) no longer leaves the focus on a zone that is not drawn.** At
  100-149 columns there is no room for the Agenda beside the board, and arming a
  task moved the focus to it anyway: keys acted on something invisible. The
  Agenda now takes the screen for the placement and gives it back when arm mode
  ends (a zoom you chose with `z` is left alone). With the Agenda switched off,
  `c` says so instead of arming.
- **`v` no longer jumps to a planner that is off or hidden.** It says why and
  stays where it is.

## [0.14.5] - 2026-09-30

### Fixed
- **tuiboard no longer freezes under a busy Claude Code history.** The Agents
  list read and parsed *every* Claude Code transcript from the start on every
  scan, and a scan ran whenever any transcript changed, which a live session
  does several times a minute. With 172 transcripts (2.4 GB) each scan blocked
  the UI for about 4 s and allocated gigabytes, so the next one was already
  due: 100% of a core, 3-5 GB of memory, a second or two of delay on every key.
  Each transcript is now read once and afterwards only for the bytes appended
  to it: a scan of the same 172 files went from 4.1 s to 6 ms, and the first
  one from 5 GB of memory to 0.4 GB, with identical results. A last line that is
  still being written is picked up on the next scan.
- **Single-pane: every pane has the same edges.** With one zone on screen, the
  Planner and the board column stopped a cell short on the right, the Agenda
  started a cell late on the left, and Agents alone used the full width, so
  flipping between zones made the borders jump. The gap between panes exists to
  separate neighbours; a pane alone on screen no longer carries it. At 80
  columns all four now draw from column 2 to column 79. The side-by-side layout
  is unchanged.

### Added
- **`TUIBOARD_PERF`: a performance log for slow sessions.** Set it to a file path
  (or `1`) and tuiboard writes JSON lines (and `note` lines, e.g. the mouse events of a
  drag in the Agenda): a `sample` every 5 s (CPU, memory,
  worst event-loop lag, keys), a `lag` line when the loop was blocked for 150 ms
  or more with the last keys pressed before it, and a `slow-key` line when a key
  handler took 30 ms or more. Off by default: no timers run and nothing is
  written unless the variable is set. The README explains how to pair it with
  Bun's CPU profiler to see which functions were busy.

## [0.14.4] - 2026-09-30

### Changed
- **A task that changes day loses its time block, everywhere.** Shift+T already
  did it for overdue tasks (#79); now `t`, `m`, the Schedule modal (`s`), clearing
  the date, and the headless `tuiboard task defer` do too. A slot is an hour on
  a particular day, so carrying `09:30-10:30` over to another day put blocks on
  the agenda at hours nobody chose. Moving a task within the same day keeps its
  block, and undo brings the day and the block back together. The banner says
  when a block was cleared. Cancelling arm mode with Esc still restores the
  original day and block.

## [0.14.3] - 2026-09-30

### Fixed
- **Confirming a move in the Agenda no longer throws you to the board.** Click a
  block, click its new slot, press Enter: the placement was kept, but a block
  armed by a click has no "where `c` started" to go back to, so Enter jumped to
  the task's card in the kanban. It now stays in the Agenda. `g` is the way to
  the card.

## [0.14.2] - 2026-09-30

### Changed
- **Enter marks a task done from the Agenda.** The README already said Enter
  toggles done in board, planner *and* timeline, but in the Agenda it jumped to
  the task's card instead, so there was no key to tick a block off from where
  you plan the day. Enter now toggles done there like everywhere else (a block
  armed with `c` still keeps Enter for "keep the placement"). The jump to the
  card moved to `g`, "go to", which the Agenda did not use.

## [0.14.1] - 2026-09-28

### Changed
- **Shift+T clears the time blocks it carries to today** (#79). A time block
  is a slot on a particular day, so moving every overdue task to today used to
  keep theirs: tasks landed in today's agenda at hours nobody chose, stacked on
  whatever was already there. Now each moved task drops its block and waits in
  today's planner to be placed again (two keys, with arm mode). The banner
  says how many were cleared. `t` / `m` on a single task and the headless
  `tuiboard task defer` are unchanged.

## [0.14.0] - 2026-09-21

### Added
- **Status file viewer** (#67): point `status_file:` at a markdown file — a
  morning digest, a handover note, whatever you or an agent write there — and
  `i` shows it in a dialog, read-only. The markdown is rendered rather than
  shown as source: headings and bold as weight, links and wikilinks by their
  label, list and checkbox glyphs, frontmatter hidden. `j`/`k`, arrows and
  PgUp/PgDn scroll it. It re-reads itself while open when the file changes,
  and `tuiboard summary` reports its path and mtime (never its body) when
  configured.
- **Overdue tasks show how late they are** (#67): a task overdue for days is
  painted in a louder red than one that slipped yesterday. No day count
  anywhere — just two bands.
- **Agent interface documentation** (#69): `docs/agent-interface.md` spells
  out `tuiboard summary` and `tuiboard task` as a stable contract for agents
  and scripts — the JSON shape, title matching, exit codes and the rules that
  keep an agent from corrupting a board.

### Changed
- **Time blocking in arm mode takes fewer round trips** (#73). A task placed
  on the agenda stays armed, so `+`/`-` and `j`/`k` size and move it straight
  away. `Enter` keeps it and returns to where `c` was pressed (usually
  Today/Tomorrow — in single-pane, without passing through the agents panel);
  `Esc` puts the task back as it was and returns the same way.

### Fixed
- **Keypad `+` grows an armed time block** (#71) instead of opening the "new
  board" dialog.
- Arming a second task no longer rewrites the first task's reference in place
  (#73), a latent bug surfaced by the new arm-mode tests.

## [0.13.3] - 2026-09-19

### Fixed
- **`tuiboard task --board` refuses ambiguous boards** (#63) instead of taking
  the first configured board whose path ends with the argument. Two boards can
  easily end the same way (`Work/Personal.md`, `Home/Personal.md`), and this is
  the headless path used by cron jobs and the bar widget, so the wrong board
  could be mutated silently. It now lists the candidates and writes nothing,
  the way an ambiguous `--match` already did. Thanks to the commenter on
  Reddit who spotted it.

## [0.13.2] - 2026-09-17

### Fixed
- **A calmer Agents list while agents work** (#58).
  - A failed herdr poll no longer drops every link at once (states briefly
    reverting, rows jumping); herdr only counts as gone after a few misses.
  - A Claude Code PID file read mid-write reuses its last good read instead of
    making the session's state flicker.
  - Live sessions are ordered by their activity at their last state change,
    so a working agent moves once when it starts or finishes, not on every
    write; closed sessions still sort by last activity.
  - Ages tick on one shared clock and read `now` under a minute instead of
    jumping through seconds.

## [0.13.1] - 2026-09-17

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

[0.15.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.15.1
[0.15.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.15.0
[0.14.5]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.5
[0.14.4]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.4
[0.14.3]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.3
[0.14.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.2
[0.14.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.1
[0.14.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.14.0
[0.13.3]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.13.3
[0.13.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.13.2
[0.13.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.13.1
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
