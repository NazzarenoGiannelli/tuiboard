# tuiboard Single-Pane Mode — Design Doc

**Date:** 2026-09-08
**Status:** Draft for review
**Author:** Claude Opus 5 + Nazz

---

## 1. Context

Open tuiboard in a narrow vertical panel — 60 columns beside other work — and it shows the one thing least useful at that size: kanban columns, clipped mid-word, with the second one sliced by the right edge. The Today/Tomorrow planner and the Agenda are gone, and no key brings them back.

The capability is not missing. `z` already focuses one zone full-screen, and for the board zone it renders **a single column** at full width. At 60 columns, `v` then `z` produces exactly the wanted result:

```
╭─┤ ⤢ Today / Tomorrow  13 ├────────────────────────────╮
│  ● Today                                              │
│  ▶ 🔺 Documento + allegato InspirationTuts — mail p…   │
```

What blocks it is a conflation in `visibleZones`, which today means both *enabled and wanted* and *fits on screen*. When space runs out, the second meaning does not merely hide a zone — it makes it unreachable:

- `cycleActiveZone` (`store/index.ts:1068`) filters on visible zones, so at 60 columns the list holds one element and the function returns immediately. **Shift-Tab does nothing.**
- `recomputeVisible` (`store/index.ts:1033`) forces the active zone back to `board` when the current one stops being visible, so narrowing the window **yanks the user off the planner**.
- The board is the only zone that cannot be hidden, so what survives is the kanban.

`v` works only by accident: it sets the zone directly, bypassing the filter.

## 2. Goals

- On a narrow terminal, every enabled zone stays reachable, one at a time.
- One direction key walks the whole set — planner, each board column, agenda, agents — and loops.
- Shift-Tab keeps making long jumps, so eight columns are not a toll gate on the way to the Agenda.
- `tuiboard --view=planner` launches straight into a Today/Tomorrow panel.
- Narrowing the window never moves the user's focus.

## 3. Non-goals

- **No new layout.** `ZoomedLayout` (`views/Dashboard.tsx:63`) already renders one zone full-screen by reusing the standalone views, and `BoardView` in that state already renders one column.
- **No new gestures.** Shift-Tab and `h`/`l` keep their meanings; only their behaviour at the edges changes.
- **No new breakpoint.** 100 columns is already where the planner disappears today. Its effect changes, not its value.
- **No text reflow below one column width** (`COL_WIDTH = 42`, `BoardView.tsx:33`). Content clips as it clips today.
- **No persisted state.** Zoom stays a session-level choice; nothing new is written to disk.

## 4. Architecture

The change is semantic, not mechanical: **"does not fit" must mean "not at the same time", never "does not exist".** Below the threshold the zones do not disappear, they queue: one drawn at a time, which is what `z` already does.

One new piece of state, `narrow`, set by the responsive layer. The effective condition everything reads is derived:

```ts
singlePane() = ui.narrow || ui.zoomed
```

Zoom stops being a separate mode and becomes one of two ways into the same state — the other being the width of the terminal.

## 5. Components

### `store/index.ts`

```ts
narrow: boolean              // in UIState — "there is no room for two"
singlePane(): boolean        // derived: narrow || zoomed
setNarrow(v: boolean)
stepPane(delta: 1 | -1)      // h/l with spill-over: next column, or the zone beside it
```

Three targeted fixes, one per defect named in §1:

- `cycleActiveZone` filters on **enabled and wanted**, not on fits. Width decides how many zones are drawn together, not which ones exist.
- `recomputeVisible` no longer steals focus in single-pane: the active zone is reachable by definition, it is simply the only one drawn.
- `toggleZoom` below the threshold becomes inert with a notice ("nothing else fits at this width") instead of returning the user to the cramped layout this design exists to escape.

The reads of `ui.zoomed` become `singlePane()`. That is five files and roughly thirty references — `BoardView` alone holds eighteen, `Dashboard` nine — so the rename, not the new logic, is the bulk of the diff.

### `src/ui/pane-ring.ts` — new, pure

Ring construction and stepping, with no knowledge of the renderer, on the model of `board-scroll.ts` (a pure module with its own tests):

```ts
type Pane =
  | { kind: "zone"; zone: "planner" | "timeline" | "agents" }
  | { kind: "column"; index: number };

function buildRing(input: {
  enabledZones: Record<ActiveZone, boolean>;
  renderedColumns: number[];       // board column indexes actually drawn
}): Pane[]

function stepRing(ring: Pane[], current: Pane, delta: 1 | -1): Pane
```

### Modified

| File | Change |
|---|---|
| `app.tsx` | `applyResponsiveLayout` also computes `narrow = width < 100` and calls `setNarrow` |
| `cli/args.ts` | `ViewKind` accepts `planner` |
| `app.tsx` | `--view=planner` = `BoardOnly` with active zone `planner` and single-pane forced — no new view file; `BoardOnly` in that state already draws only the panel |
| `input/handleKey.ts` | `h`/`l` call `stepPane` while in single-pane; unchanged at full width |
| `ui/Chrome.tsx` | Compact top bar in single-pane, with a position indicator (`⤢ Planner ‹ 1/6 ›`) — with one zone on screen there is no other way to know where you are. At 60 columns it currently truncates mid-word |

## 6. Data flow

Today the horizontal graph is a **star centred on the board**, and only leftward:

```
planner  —l→  board  ←h—  timeline
                ↑ h            ←h— agents
```

That fits a wide screen, where zones sit side by side and "left" is a geometric fact. In single-pane there is no geometry, only a sequence, and `stepPane` walks it — the board expanded into its rendered columns:

```
[ Planner ] → [ Marketing ] → [ Partners ] → [ Company ] → [ Agenda ] → [ Agents ] ↺
```

`l` advances, `h` retreats, both wrap. Hidden columns (Done, Archive) stay out — `adjacentVisibleColumn` already skips them, and landing on an undrawn column is a dead end. Zones disabled via `zones:` are not in the ring.

Shift-Tab stays the long jump: **next zone, not next pane**, and re-entering the board returns to the column the user left, not the first one. That is what makes eight columns skippable.

**At full width nothing changes**: the star stays. A ring that wraps would be disorienting when every zone is visible at once — `l` from the last column jumping to a planner at the other end of the screen helps nobody. The ring answers "I see one thing at a time", so it lives only there.

### 6.1 Resizing never moves the user

This is where today's behaviour does the most damage, so the rule is absolute: **narrowing the window never changes the active zone.** `recomputeVisible` currently drags focus to the board the moment the planner stops fitting. Instead the active zone survives and simply becomes the only one drawn. Widening re-opens the layout with the same zone focused, now beside the others. The focus belongs to the user, not to the width of the terminal.

`--view=planner` is a starting state, not a cage: it opens with the planner focused and single-pane forced, and Shift-Tab still works.

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Zones disabled in `zones:` | Not in the ring. Agenda off → `l` from the last column goes to Agents |
| Ring of one (single column, everything else off) | `h`/`l` do nothing. No flash, no wrap onto itself |
| Grab mode (`g`) | Untouched. There `h`/`l` **move the task** between columns, and a task cannot spill into the planner — it means nothing. The grab branch intercepts first, so it stops at the edges as today. Spill-over is navigation, never movement |
| Modal open | `ZoomedLayout` already floats it centred over the focused zone rather than taking its place. Close it and the pane is as it was |
| `z` below the threshold | Inert, with a notice. Above it, unchanged |
| `--view=planner` with `zones: planner: off` | The flag wins for that session. An explicit command-line option beats a config preference: whoever typed it is asking for that zone |
| Below 42 columns (`COL_WIDTH`) | Content clips as it does today. Reflow is different work |

## 8. Testing

**`pane-ring.ts`** — the pure module, tested without a terminal:

- the ring skips disabled zones and hidden columns
- it wraps in both directions; a one-element ring is a no-op
- Shift-Tab re-enters the board on the remembered column, not the first

**Store** — two tests capturing the two defects from §1:

- `cycleActiveZone` cycles even when zones report they do not fit
- narrowing does not change the active zone

**End to end in a pty at 60 columns**, the same technique that reproduced the problem: it starts in single-pane, and `l` walks planner → columns → agenda → agents → planner.

The modal, the chrome and the rendering are not unit-tested: they are thin, and an OpenTUI render costs more to test than it protects. The pty walk covers them in the only way that matters — from the outside.

## 9. Build phasing

1. `pane-ring.ts` with its tests. No wiring.
2. `narrow` + `singlePane()` + the three store fixes, with store tests.
3. `h`/`l` spill-over through `stepPane`.
4. `--view=planner`.
5. Compact chrome and the position indicator.
6. The pty walk at 60 columns.

Phases 1–3 already deliver the feature to anyone who presses `z`; 4 and 5 make it launchable and legible.

## 10. Risks & open issues

- **The `zoomed` → `singlePane()` rename is the largest part of the diff**: five files, ~30 references, eighteen inside `BoardView` alone. Each is mechanical, but volume is its own risk, and none of those files has a unit test — `BoardView` is where a missed one would silently render the wrong thing. The pty walk is the net, and phase 2 should land alone so a bisect can find it.
- **Two meanings of "hidden" remain** after this: a zone can be off (config) or not fitting (width), and only the second now degrades gracefully. If a third ever appears, this is the place it will be confusing.
- **The position indicator competes for space** exactly where space is scarcest. If the compact bar cannot hold both the board name and the ring position, the position wins: in single-pane, knowing where you are matters more than knowing which board you are on — the board name is one Shift-Tab away from being obvious anyway.

## 11. Decisions captured

- **Single-pane is zoom**, not a mode beside it: `singlePane() = narrow || zoomed`.
- **"Does not fit" means "not simultaneously"**, never "unreachable".
- **Two levels of movement**: Shift-Tab jumps zones, `h`/`l` walk the ring one pane at a time and wrap.
- **The ring exists only in single-pane.** At full width the current star behaviour is unchanged.
- **Automatic below 100 columns**, the existing breakpoint; `z` still commands manually at any width.
- **Resizing never moves the user's focus.**
- **`--view=planner` added**, reusing `BoardOnly` rather than adding a view.
- **Grab mode is untouched**: spill-over is navigation, not task movement.
