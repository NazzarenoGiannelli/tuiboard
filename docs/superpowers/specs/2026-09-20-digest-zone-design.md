# tuiboard Status File Viewer + Overdue Aging — Design Doc

**Date:** 2026-09-20 (revised same day, after design review)
**Status:** Draft for review
**Author:** Claude Sonnet 5 + Nazz

---

## Revision note

The original version of this doc proposed a fourth persistent zone ("Digest"), on par with planner/agenda/agents, holding both a rendered status file and a ranked list of how-overdue-each-task-is. Design review with Nazz cut it down twice:

1. **No persistent zone for the status file.** tuiboard's other zones earn permanent screen space because they're consulted continuously while working (planner, agenda, agents). A status file is read once, typically in the morning, then not needed again until it's rewritten. That usage pattern fits a modal — open, read, dismiss — not a panel competing for space all day. tuiboard already has exactly this shape for a task's linked note (`o`, `DialogShell`); the status file is the same kind of object.
2. **No ranked overdue-tasks list, no day-count shown anywhere.** Nazz already resets most tasks to Today each morning, so multi-day staleness is the exception, not the steady state — a whole list for it is disproportionate. And the exact day-count already exists as a value: the `/morning` ritual's block-by-block "piano vs realtà" comparison, which is where "am I chronically late on this kind of task" actually gets read and acted on. Duplicating that number as a badge in tuiboard would be a second place for the same fact to drift. What tuiboard's board/planner rows lack today is not the number — it's a **visual band**, so a task overdue one day doesn't look identical to one overdue three weeks at a glance.

What is left is two small, independent, and much cheaper changes. They are not a "zone" and don't need to ship together.

## 1. Context

**A. The status file.** Reading it today means leaving tuiboard for an editor or Obsidian. Not Obsidian-specific, not tied to any particular AI setup: tuiboard should read whatever file is configured the same way it already reads a task's linked note — displayed, not parsed, no opinion about who wrote it or how.

**B. Overdue tasks look the same regardless of age.** `TaskRow.tsx:statusOf()` already buckets a task into `"overdue"` the moment `scheduled < today`, and `titleColorFor()` paints every one of them with the single color `T.overdue` (`TaskRow.tsx:176`). A task one day late and one three weeks late are visually identical. Both are the same underlying fact tuiboard already computes; the only new thing is showing degree instead of a plain flag.

## 2. Part A — Status file modal

### Goals

- A configured path to a markdown file, opened on demand in a dialog, dismissed like any other.
- Zero assumptions about the file's structure — displayed, not parsed.
- Read-only. tuiboard never writes it.
- Reachable headless too (see §2.5), so a bar widget can show *that* it changed without tuiboard running, same reasoning that put the planner in `tuiboard summary`.

### Architecture

No new reader. `notes/index.ts:readNoteBody(path)` — read, strip frontmatter, trim — already does exactly this; a status file and a task's note are the same kind of object from tuiboard's point of view. The only new pieces are config plumbing and a thin modal.

```ts
// on Config (config/loader.ts)
statusFilePath?: string;   // resolved like a board path: ~ expanded, absolute
```

No `ZonesConfig` entry — this isn't a zone, so there's nothing to toggle on/off per se. If `statusFilePath` is unset, the key that would open it simply does nothing (or the help text omits the row — TBD, not a hard decision).

### UI

A new modal kind, `{ kind: "status-file" }`, reusing `DialogShell` exactly as the task-note detail view does (`Modal.tsx:726` area): title, the file's relative last-modified time in the subtitle, the body in the same scrollable text block already used for note bodies. No new rendering primitive — same non-goal as before: plain text, no markdown-to-styled-text pass in this iteration.

**Keybinding — genuinely not free, checked against the real bindings, not assumed.** `input/handleKey.ts` already uses nearly the entire alphabet for single-letter actions (`a b c d e f g h j k l m n o p q r s t v x y z` lowercase, plus `C H N` uppercase — confirmed by grep, not guessed). Free lowercase letters: **`i`, `u`, `w`**. Candidate: `i` ("info"), but this is Nazz's call, not fixed here.

### Watcher

Registers through `BoardWatcher.watch(statusFilePath)` — the same generic call the board-lifecycle work already added for adopting a board file at runtime. No second watcher.

### Headless

`cli/summary.ts` gains one optional field:

```ts
statusFile?: { path: string; updatedAt: string };  // mtime only — no body
```

Present only when configured, so the JSON shape for every existing consumer (including the Omarchy widget) is unchanged when it isn't. Deliberately no body in the JSON: a bar widget wants to know *that* something changed, not to lay out a page of prose.

### Error handling

| Situation | Behaviour |
|---|---|
| Configured, file missing | Modal opens showing "File non trovato: `<path>`" instead of failing to open |
| Configured, file empty | "(vuoto)" — same wording the note viewer already uses |
| Not configured | The key does nothing (or is absent from help — TBD) |
| File larger than a sane cap (TBD, tens of KB) | Rendered truncated with a note at the cut |

### Testing

Nothing new needed on the read side — `readNoteBody` is already covered by `notes.test.ts`. The modal itself is out of scope for direct testing, same reasoning `boards.test.ts` already gives for modals in general: a thin caller over tested logic.

## 3. Part B — Overdue aging (color only)

### Goal

A task overdue by a little and a task overdue by a lot should not read identically in board and planner rows. No number shown anywhere in the UI — the exact count already lives in the `/morning` ritual's daily comparison, which is where that data actually gets used.

### Architecture

`TaskRow.tsx:statusOf()` already computes `"overdue"` from `t.scheduled < today`. The only change is computing **how** overdue and mapping that to one of a small number of color bands instead of the single flat `T.overdue`:

```ts
// TaskRow.tsx, near statusOf/titleColorFor
function overdueBand(scheduled: string, today: string): "light" | "heavy" {
  const days = daysBetween(scheduled, today);   // existing date utility, if one exists; else trivial
  return days >= 7 ? "heavy" : "light";          // exact threshold: Nazz's call, not fixed here
}
```

Two bands, not a gradient with many steps — the point is "a little" vs. "a lot," not a precise scale. `titleColorFor()` picks `T.overdue` for light and a new, more alarming `T.overdueHeavy` for heavy, keeping every other precedence rule (`done` > `overdue` > priority > today > tomorrow) exactly as it is today.

### Non-goals

- No day-count displayed anywhere in the row.
- No new zone, no ranked list, no separate view.
- No change to which tasks count as overdue — `statusOf()`'s definition is untouched, only the color of the ones already in that bucket changes.

### Testing

A pure function (`overdueBand`, or wherever the threshold logic lands) — trivially unit-testable with a handful of `(scheduled, today)` pairs across the boundary. `titleColorFor`'s existing precedence order needs one added case in whatever test already covers it.

## 4. Build phasing

These are two unrelated, independently shippable changes:

1. **Part B first** — smaller, self-contained, no config surface, immediately useful given Nazz's current backlog. One threshold constant, one new color, one branch in `titleColorFor`.
2. **Part A** — config field, modal, watcher wiring, `summary` field.

## 5. Risks & open issues

- **Overdue-band threshold** (the spec above uses 7 days as a placeholder) is Nazz's call.
- **Modal keybinding** — `i`, `u`, or `w` are free today; final pick is Nazz's, and should be checked again at implementation time in case another PR has claimed one meanwhile.
- **Whether `BoardWatcher` can watch a not-yet-existing path** still needs verifying against chokidar's actual configuration before Part A's watcher wiring — carried over from the original draft, still unresolved.

## 6. Decisions captured

- **No fourth persistent zone.** A file read once a day belongs in a modal, not a panel competing for space with things read continuously.
- **No day-count anywhere in the tuiboard UI.** That number already has a home in `/morning`'s daily comparison; showing it twice is a second place for one fact to drift.
- **Status file reading reuses `readNoteBody`, unchanged** — no new reader module.
- **Overdue aging is color-only, two bands, no new date semantics** beyond what `statusOf()` already computes.
- **tuiboard never writes the status file.** Read-only, same posture as boards.
