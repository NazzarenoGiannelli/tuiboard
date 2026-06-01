# Changelog

All notable changes to **tuiboard** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.7.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.7.0
[0.6.2]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.2
[0.6.1]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.1
[0.6.0]: https://github.com/NazzarenoGiannelli/tuiboard/releases/tag/v0.6.0
