# tuiboard Digest Zone — Design Doc

**Date:** 2026-09-20
**Status:** Draft for review
**Author:** Claude Sonnet 5 + Nazz

---

## 1. Context

Two unrelated pieces of state already exist and neither is visible from inside tuiboard.

The first is a file: whoever runs a personal vault often keeps one markdown note that a coordinator process — an AI routine, a cron job, a person at the end of the day — rewrites on a cadence with "what needs your attention right now." Reading it today means leaving tuiboard for an editor or Obsidian. tuiboard has no opinion about who writes that file or how, and this design does not give it one.

The second is a number tuiboard already computes and throws away: `task.scheduled < today` marks a task overdue (`store/index.ts:1290`), but a task overdue by one day and one overdue by three weeks render identically. The planner's `overdue` filter answers *whether*, never *how long*.

Both are "state already on disk or already in memory, surfaced by nothing." One new zone for both, because the underlying move is the same: stop making the user go somewhere else to see something tuiboard already has or could trivially read.

**Not Obsidian-specific, not Tori-specific.** "Tori" is one user's name for a coordinator that writes such a file; the zone must work for anyone who maintains one by hand, or not at all — in which case only the staleness half is useful, and the zone degrades to that.

## 2. Goals

- A configurable path to a markdown file, rendered read-only in a new zone, updated when the file changes on disk.
- Zero assumptions about that file's structure. tuiboard displays it; it does not parse it.
- A view of overdue tasks across all configured boards, ranked by how long they have been overdue, not just that they are.
- Both available headless through `tuiboard summary`, so a bar widget (the Omarchy plugin, or anyone else's) can show them without a TUI running — same reasoning that already put the planner in `summary`.
- Works with no digest file configured: the zone then shows staleness only, and says so.

## 3. Non-goals

- **No markdown-to-styled-text rendering.** The digest body renders as plain text, the same primitive the task-note viewer already uses (`Modal.tsx:815`, `n().body`). Bold, headers, and links styled would be a real, separate, generic renderer — valuable to the note viewer too, but not scoped here. Building it bespoke for one zone is the wrong shape for the gain.
- **No semantic parsing of the digest file.** No attempt to recognise sections, extract fields, or understand what the file's author meant by any heading. The moment tuiboard parses meaning out of it, the file stops being "any markdown a user already writes" and becomes a dialect tuiboard owns — the exact drift `roundtrip-check` exists to catch on boards, and this design avoids creating a second surface that needs the same discipline.
- **No writing.** tuiboard never touches the digest file. It is exactly as external as the boards themselves.
- **Multiple digest files.** One path, one panel, this iteration. A user (or a future need of Nazz's own) wanting several is a config-shape question for later, not a default to guess now.
- **No new zone-specific keybinding scheme.** It slots into the existing zone-toggle mechanism (`ZonesConfig`, F-key rotation) like agenda and agents did.

## 4. Architecture

No new subsystem for reading. `notes/index.ts:readNoteBody(path)` — read a file, strip frontmatter, trim — already does exactly what the digest body needs, because a digest file and a task's note are the same kind of object: a markdown file a human or a process maintains, that tuiboard shows without editing. Calling it a second time from a second config key is the entire read side.

The one genuinely new pure function is staleness, parallel in shape to `store/planner-panel.ts`:

```ts
// store/digest.ts
export interface StaleTask {
  title: string;
  board: string;
  column: string;
  scheduled: string;   // YYYY-MM-DD, already on Task
  daysOverdue: number;
}

function computeStaleness(boards: Board[], today: string): StaleTask[]
// Same definition as the planner's "overdue" filter (store/index.ts:1290):
// task.scheduled !== undefined && task.scheduled < today, done tasks excluded.
// Sorted by daysOverdue descending. No new date semantics invented.
```

### Config

```ts
export interface ZonesConfig {
  planner: ZoneMode;
  agenda: ZoneMode;
  agents: ZoneMode;
  digest: ZoneMode;        // new
}

// on Config:
digestPath?: string;       // resolved like a board path: ~ expanded, made absolute
```

Unset `digestPath` is a supported state, not an error: the zone shows staleness only (see §7).

### UI

`DigestPanel.tsx`, structurally parallel to `PlannerPanel.tsx`: a header (file name + relative last-modified time, e.g. "aggiornato 3h fa" from the watcher's change event or the file's mtime), the plain-text body in the same scrollable text block the note viewer already renders, and a ranked overdue list below it. Whether that list is a second scroll region in the same panel or a tab within it is a UI call for Nazz, not fixed here (see §10).

### Watcher

`BoardWatcher.watch(filepath)` already exists for exactly this — adding a path to the live watch set at runtime, built for board adoption (`io/watcher.ts:32`, landed in the board-lifecycle design). The digest path registers through the same call. No second watcher implementation.

### Headless

`cli/summary.ts` gains one optional field:

```ts
digest?: {
  path: string;
  updatedAt: string;        // file mtime, ISO
  staleness: StaleTask[];
}
```

Present only when `digestPath` is configured, so the shape returned to every existing consumer — including the Omarchy widget already parsing this JSON — is unchanged when it is not. The body itself is deliberately **not** included in `summary`'s JSON: a bar widget wants numbers and a badge, not a page of prose to lay out, and staleness already gives it something to render.

## 5. Components

| File | Change |
|---|---|
| `config/loader.ts` | `ZonesConfig.digest`, `Config.digestPath`, default `zones.digest = "off"` (see §7 for why off, not on) |
| `store/digest.ts` | new — `computeStaleness()`, pure, tested against a temp board set |
| `ui/DigestPanel.tsx` | new — thin, calls `readNoteBody` and `computeStaleness`, no logic of its own |
| `io/watcher.ts` | no change — `watch()` already generic |
| `cli/summary.ts` | `digest` field, populated from the same `computeStaleness()` |
| `app.tsx` | mount `DigestPanel` when `zones.digest !== "off"`, wire its F-key alongside planner/agenda/agents |

## 6. Data flow

```
launch, zones.digest !== "off"
  ↓
digestPath configured? ──no──→ panel shows staleness only, no header file line
  │yes
  ↓
readNoteBody(digestPath) → body            (throws → caught, shown as "file not found")
watcher.watch(digestPath)                  (fires on external edit)
  ↓
on every board load/change (already reactive today)
  ↓
computeStaleness(boards, today) → ranked list
```

The body and the staleness list update on different triggers by nature — one on file change, one on task change — and that is fine: they are unrelated data shown in one panel because they answer the same question ("what needs me right now"), not because they share a source.

## 7. Error handling

| Situation | Behaviour |
|---|---|
| `digestPath` set, file missing | Panel shows "File non trovato: `<path>`" in place of the body. Staleness list still renders — one half failing must not blank the other. |
| `digestPath` unset | No file section at all; panel opens straight on staleness. This is why the default is `zones.digest = "off"` rather than "on": a zone that renders nothing useful out of the box on every existing install is a worse default than opt-in. |
| File exists but is empty | "(vuoto)", same wording pattern the note viewer already uses for an empty note. |
| File larger than a sane cap (TBD, likely tens of KB) | Rendered truncated with a note at the cut. A digest is meant to be a short daily read; a file that has grown past that is a signal for its own author, not a reason to freeze the render. |
| Watching a path that does not exist yet | **Open question, not assumed** — needs checking against chokidar's actual behaviour in `io/watcher.ts` before implementation. If it does not fire on later creation, the fallback is picking the file up on next launch, stated plainly rather than silently missed. |

## 8. Testing

`src/store/digest.test.ts`, same shape as `boards.test.ts` and `planner-panel`'s existing tests:

- `computeStaleness`: empty board set → `[]`; a mix of past/today/future `scheduled` dates → only past ones returned, sorted oldest-first; done tasks excluded even when their `scheduled` is in the past; no `scheduled` at all → excluded, not treated as infinitely overdue.
- Digest body reading needs no new tests: it is `readNoteBody`, already covered by `notes.test.ts`.
- `DigestPanel.tsx` is declared out of scope for direct testing, same reasoning `boards.test.ts` gives for the modal and the chip: a thin caller over tested logic, and an OpenTUI render test costs more than it protects.

## 9. Build phasing

1. `computeStaleness()` + tests. No config, no UI — provable in isolation.
2. Config: `digestPath`, `zones.digest`, default `"off"`.
3. `cli/summary.ts` gains the `digest` field.
4. `DigestPanel.tsx` + watcher wiring + F-key, reusing `readNoteBody` directly.
5. *(Separate future spec, not this one)* — a real markdown-to-styled-text renderer, if the plain-text panel turns out to want it. Improves the note viewer too if built.

Phases 1–3 are shippable and independently useful before the TUI grows a panel — the same phasing argument the board-lifecycle design makes for its own CLI-first slice.

## 10. Risks & open issues

- **Panel layout for two unrelated lists (body + staleness) is not decided here.** One scrollable panel with a divider, or a tab within the zone — a real UI call, left to Nazz rather than guessed.
- **Whether `BoardWatcher` can watch a not-yet-existing path** needs verifying against chokidar's configuration before phase 4 starts, not assumed from this doc.
- **Free F-key for a fourth toggleable zone** — check current bindings before wiring; this doc does not reserve one.
- **Truncation threshold for an oversized digest file** is a number to pick during implementation, not a design decision worth blocking on now.

## 11. Decisions captured

- **The digest file is read with `readNoteBody`, unchanged.** No new reader module — a digest and a task note are the same kind of file from tuiboard's point of view.
- **No markdown parsing or styled rendering of the digest body in this iteration.** Plain text, matching the existing note viewer exactly.
- **Staleness reuses the planner's existing overdue definition** (`scheduled < today`, done excluded) — no new date semantics.
- **tuiboard never writes the digest file.** Read-only, same posture as boards.
- **`zones.digest` defaults to `"off"`**, because an unconfigured `digestPath` gives an existing install nothing to show by default.
- **Exposed through `tuiboard summary` as an optional field** — absent when unconfigured, so no existing consumer of that JSON sees a shape change.
