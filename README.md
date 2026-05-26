# tuiboard

A modern terminal dashboard for markdown-based task boards.
Kanban + timeline + agent view, in one TUI, with real drag & drop and a shared reactive store.

> Status: **Day 1** — bootstrapping. Not usable yet.

## Why

Existing TUI task tools either:

- Tie you to a specific app (Obsidian Kanban plugin, Notion, Linear),
- Are read-only viewers without scheduling,
- Or are slow Python TUIs without real mouse interaction.

`tuiboard` aims to be:

- **Vendor-neutral** — boards are plain markdown files. Open them in any editor.
  Compatible with Obsidian Kanban plugin and Tasks plugin conventions, but never required.
- **Unified** — kanban view, timeline view, and Claude Code agent view share one
  in-memory store, so an edit in one view re-renders the others instantly.
- **Modern** — built on [OpenTUI](https://opentui.com) + SolidJS for fast
  reactive rendering, real mouse drag & drop, and a native-feeling layout.

## Markdown board format

`tuiboard` reads and writes **plain CommonMark** with a small set of well-known
conventions inspired by the Obsidian Tasks plugin. Any markdown editor renders
these files sensibly; the Obsidian Kanban plugin renders them as a kanban; we
render them as our TUI.

### Minimal example

```markdown
---
type: board
name: R3PLICA
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
| `@name` | Assignee | Configurable list in `.tuiboard/config.yaml` |
| `#tag` | Tag | Any hashtag; passed through verbatim |
| `⏳ YYYY-MM-DD` | Scheduled date | Tasks-plugin convention |
| `📅 YYYY-MM-DD` | Due date | Tasks-plugin convention |
| `🛫 YYYY-MM-DD` | Start date | Tasks-plugin convention |
| `✅ YYYY-MM-DD` | Done date | Tasks-plugin convention |
| `⌚ HH:MM-HH:MM` | Time block (today's calendar slot) | **tuiboard-specific** — Tasks plugin has no time-of-day |
| `🔺` / `⏫` / `🔼` / `🔽` / `⏬` | Priority | Tasks-plugin convention |

Anything else stays in the task text untouched on write-back.

## Config

`tuiboard` looks for `.tuiboard/config.yaml` in the current directory and
walks up. Example:

```yaml
boards:
  - path: Tasks - R3PLICA.md
    name: R3PLICA
  - path: Tasks - Personal.md
    name: Personal
assignees: [Nazza, Shadow, Laptop, MiniPc]
done_column: Done
archive_column: Archive
```

If no config is found, `tuiboard` falls back to scanning the cwd for any
`.md` file containing at least one `- [ ]` task.

## Install

```bash
bun install
bun run dev
```

Requires Bun ≥ 1.1. OpenTUI ships native bindings; on Windows make sure
Visual Studio Build Tools are available if installation needs to compile.

## Status / roadmap

- [x] Day 1 — scaffolding, parser, config loader, first render
- [ ] Day 2 — atomic writer, file watcher, store
- [ ] Day 3 — kanban view v0 (nav, toggle done, inline edit)
- [ ] Day 4 — kanban drag & drop, multi-select, undo log
- [ ] Day 5 — timeline view v0
- [ ] Day 6 — timeline drag-to-schedule + resize
- [ ] Day 7 — agent view (Claude Code session discovery)
- [ ] Day 8 — unified dashboard layout + quick-add bar
- [ ] Day 9 — command palette, themes, conflict-safe writes
- [ ] Day 10 — single-binary bundle, v0.1 release

## License

MIT (pending).
