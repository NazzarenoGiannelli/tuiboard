# tuiboard examples — a demo vault

Three small, **fictional** boards (Work / Personal / Home) so you can run
tuiboard for a screencast or screenshots without showing any real tasks,
clients, or Claude Code session names.

```bash
cd examples
tuiboard          # walks up, finds .tuiboard/config.yaml, loads the three boards
```

What's set up for a clean demo:

- **Three boards** as tabs, with priorities (🔺🔼⏫), assignees (`@Alex`,
  `@Jordan`), tags, due dates (📅), scheduled dates (⏳), and done items (✅).
- **A full day on the agenda** — seven time-blocked tasks across the boards
  (`⌚ 09:00-10:30` … `20:00-20:30`) so the 24h timeline looks alive.
- **Today / Tomorrow planner** populated from the scheduled dates.
- **Agents view off** (config) so it never shows your real sessions.

## Before you record

The dates are anchored around **2026-06-06**. Bump the `⏳` / `📅` / `✅` dates to
the current week so "Today" and the agenda are populated when you hit record —
otherwise today's tasks read as overdue. A quick way on macOS/Linux:

```bash
# shift every 2026-06-06 → today, 06-07 → tomorrow, etc. (adjust to taste)
sed -i 's/2026-06-06/'"$(date +%F)"'/g' *.md
```

Or just edit a handful of dates by hand — there aren't many.

These files are **not** part of the published npm package (the `files` allowlist
excludes `examples/`); they live here only for trying the tool and for demos.
