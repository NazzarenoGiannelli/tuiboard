# tuiboard Dashboard — Design Doc

**Date:** 2026-05-27
**Status:** Draft for review
**Author:** Claude Sonnet 4.6 (1M ctx) + Nazz

---

## 1. Context

`tuiboard` started as a single-tool replacement for the Python `kanban.py` and now ships a working OpenTUI/Bun kanban + Today/Tomorrow virtual panel with multi-select, archive, detail modal, mouse click, undo, and atomic file roundtrip on all three boards.

The original goal was to unify three Python TUIs into one tool:

- **kanban.py** → kanban + virtual today/tomorrow panel ✅ done
- **agentview/av.py** → live status of Claude Code sessions across machines (read `~/.claude/projects/*.jsonl`)
- **timeline.py** → 24h vertical time grid with time-blocked tasks pinned to their slots, drag-to-schedule

The existing WezTerm dashboard layout (`Ctrl+Alt+D`) opens these as three separate panes in `nu` shells:

```
┌──────────┬──────┐
│   av     │      │  av  → top-left,    ~30% h of left column
├──────────┤ tln  │  kbn → bottom-left, ~70% h of left column
│   kbn    │      │  tln → right,       ~25% w, full height
└──────────┴──────┘
```

This works but has friction: three processes, three configs, three reload cycles when a kanban file changes, no shared cursor / mark / selection state between kanban and timeline (which read the same data).

## 2. Goals

- **One binary, one config, one install.** `bun install -g tuiboard` and you get the whole stack on Shadow, Laptop, MiniPC.
- **Default mode = unified dashboard.** Launching plain `tuiboard` shows all four zones at once — priorities, queue, timeline, agents — so the day is visible at a glance ("una dashboard, come dice il nome").
- **Standalone mode via flag.** `tuiboard --view=board|timeline|agents` lets the user keep using the WezTerm 3-pane workflow if preferred, swapping out `av`/`kbn`/`tln` shell scripts for `tuiboard --view=X` calls.
- **Shared store between kanban and timeline.** Time blocks set via `b` on a task appear in the timeline column instantly, with no file round-trip.
- **Reading flow top-left → bottom-right.** Priorities (left) → queue (center) → when (right) → what's running (bottom).
- **Responsive collapse.** On narrow terminals (<150 col), optional zones (timeline, agents) collapse with toggle keys to bring them back.

## 3. Non-goals

- **No split-pane *inside* tuiboard for the same view shown twice.** If the user wants kanban in pane A and timeline in pane B at different sizes, they use WezTerm panes with `--view=` flags.
- **No remote/multi-machine state sync.** Each machine reads its own local kanban files. Cross-machine awareness is provided only via agent view, which is itself local (`~/.claude/projects/`).
- **No agent control beyond resume.** The agent view shows status and offers a "resume" action; it does not start/stop agents, manage tool permissions, or edit configs. That belongs in Claude Code itself.
- **No drag between kanban and timeline in v1.** Drag-to-schedule on the timeline itself is in scope for Day 5.3; cross-zone drag (e.g., drag a task from the board onto a time slot) is deferred.

## 4. Layout design

### 4.1 Default dashboard (≥150 cols)

```
┌─tuiboard──[1 R3PLICA · 2 Personal · 3 Platform]──────open·done·cols──────────┐
│                                                                              │
│ ┌─Today/Tomorrow─┐ ┌─Board (R3PLICA)─────────────────────┐ ┌──Timeline─────┐│
│ │● Overdue       │ │ Inbox 3   In Progress 5   Done 12   │ │ 07 ─────────  ││
│ │ ⏰ Agenda      │ │                                     │ │ 08 ─────────  ││
│ │  ⌚09:00 …     │ │ ▶ Task 1                            │ │ 09 ⌚ outreach││
│ │ 🔺 Priority    │ │   Task 2                            │ │   ─────────   ││
│ │  …             │ │   Task 3                            │ │ 10 ⌚ deep wrk││
│ │● Today         │ │                                     │ │ 11 ─────────  ││
│ │ ⏰ Agenda      │ │                                     │ │ 12 ─────────  ││
│ │  …             │ │                                     │ │ 13 ⌚ Federico││
│ │● Tomorrow      │ │                                     │ │ 14 ─────────  ││
│ └────────────────┘ └─────────────────────────────────────┘ │ …             ││
│                                                            │ 22 ─────────  ││
│ ┌─Agents (live, compact)─────────────────────────────────┐ │               ││
│ │● tuiboard       Shadow  💬 attivo  📂 Personal/tuiboard│ │  full-height  ││
│ │ pulse-analytics Laptop  💤 3m fa   📂 R3lab/pulse      │ │               ││
│ │ morning         Shadow  ✅ 9:15    📂 nazzaverse       │ │               ││
│ └────────────────────────────────────────────────────────┘ └───────────────┘│
│                                                                              │
│ hjkl move · Tab board · F1/F2/F3 toggle zone · ⏎ done · q quit              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Proportions** on a 200×50 terminal (target widescreen):

- **Right column (Timeline):** 50 col × full height (~46 rows of content). Always visible when terminal is ≥150 col wide.
- **Left column:** 150 col, split vertically into:
  - **Top zone** (~85% height, ~38 rows): Today/Tomorrow (38 col) + Board (rest, ~110 col).
  - **Bottom zone** (~15% height, ~7 rows): Agent view, full width of left column.

### 4.2 Responsive collapse breakpoints

| Terminal width | Visible zones | Notes |
|----------------|---------------|-------|
| ≥ 150 col | Virtual + Board + Timeline + Agents | Default dashboard |
| 120–149 col | Virtual + Board + Agents (Timeline collapsed) | Press F2 to bring timeline back as overlay |
| 100–119 col | Virtual + Board (Timeline + Agents collapsed) | Press F2 / F3 to bring them back |
| < 100 col | Board only (Virtual collapsed) | Press F1 to bring virtual back |

Toggle keys: **F1** = Virtual panel, **F2** = Timeline, **F3** = Agents. Toggling shows/hides independent of width.

### 4.3 Standalone views (`--view=X`)

When launched with `--view=board|timeline|agents`, the dashboard shell disappears and only the requested zone renders fullscreen, using all available width and height. This mode is for WezTerm pane workflows.

## 5. Process model & binary structure

- **One binary** built from `src/app.tsx`.
- `app.tsx` parses `process.argv` for `--view=X` and dispatches:
  - `undefined` → `<Dashboard store={store} />`
  - `board` → `<BoardOnly store={store} />`
  - `timeline` → `<TimelineOnly store={store} />`
  - `agents` → `<AgentsOnly store={store} />`
- Bootstrap (config load, store creation, file watchers) is identical across modes. Only the root render component differs.
- Multiple `tuiboard` processes can coexist (e.g., 3 WezTerm panes). Each owns its own store + watchers. When one writes a kanban file, the others reload via chokidar within 150ms.
- The agent view reads `~/.claude/projects/**/*.jsonl` read-only; multiple readers are safe.

## 6. Internal architecture

### 6.1 Repo layout after refactor

```
src/
├── app.tsx                    ← bootstrap: parse argv, dispatch view, render
├── config/loader.ts           ← exists
├── io/                        ← exists (writer, watcher)
├── parser/                    ← exists (markdown, serialize)
├── store/
│   ├── index.ts               ← core kanban store (exists)
│   ├── virtual-panel.ts       ← today/tomorrow aggregation (exists)
│   ├── parsers.ts             ← exists (date/time shortcut parsers)
│   ├── agents.ts              ← NEW: discover + tail Claude sessions
│   └── timeline.ts            ← NEW: derive time-blocked items per day
├── views/
│   ├── Dashboard.tsx          ← NEW: 4-zone layout
│   ├── BoardOnly.tsx          ← NEW: virtual + board fullscreen
│   ├── TimelineOnly.tsx       ← NEW: timeline fullscreen
│   └── AgentsOnly.tsx         ← NEW: agents fullscreen
└── ui/
    ├── BoardView.tsx          ← exists
    ├── VirtualPanel.tsx       ← exists
    ├── TaskRow.tsx            ← exists
    ├── Modal.tsx              ← exists
    ├── glyphs.ts              ← exists
    ├── TimelineView.tsx       ← NEW: 24h column with time-block bands
    └── AgentsBar.tsx          ← NEW: compact list of sessions
```

### 6.2 State changes

The current `ui.inVirtual: boolean` (binary toggle) is replaced by:

```typescript
type ActiveZone = "virtual" | "board" | "timeline" | "agents";

interface UIState {
  activeZone: ActiveZone;            // was: inVirtual
  visibleZones: Set<ActiveZone>;     // NEW: controlled by F1-F3 toggles
  // ... (rest unchanged)
}
```

`Shift+Tab` cycles `activeZone` through `visibleZones` only (skipping hidden zones). Plain `Tab` retains its existing meaning of "switch active board" in the kanban zone.
`hjkl` navigates within the active zone. The handler dispatches based on `activeZone`.

### 6.3 New stores

**`store/agents.ts`** — reads `~/.claude/projects/**/*.jsonl`, watches for new files and updates to existing ones, derives per-session status (`live` if last message within 30s, `idle` if within 30 min, `done` otherwise).

```typescript
interface AgentSession {
  id: string;              // jsonl filename without extension
  cwd: string;             // decoded from path: "C--Users-..." → "C:/Users/..."
  shortCwd: string;        // last 2-3 path segments for display
  machine: string;         // hostname if recorded, else "local"
  lastActivityTs: number;
  lastMessage: string;     // truncated to ~60 chars
  status: "live" | "idle" | "done";
  name?: string;           // from session rename, if any
}
```

**`store/timeline.ts`** — derived memo: for a given date (default today), enumerates all tasks across all boards that have a `timeBlock`, sorted by `startMin`. Each entry references its source task so click → cursor jumps to the kanban task.

```typescript
interface TimelineEntry {
  ref: TaskRef;
  task: Task;
  startMin: number;
  endMin: number;
  label: string;
}
```

No mutation lives in `timeline.ts`; it's a read-only view derived from the kanban store. Editing happens via existing `setTimeBlock(ref, ...)`.

## 7. View specs

### 7.1 Dashboard layout (Dashboard.tsx)

```tsx
<box flexDirection="column" w="100%" h="100%">
  <TopBar />
  <box flexDirection="row" flexGrow={1}>
    {/* Left column */}
    <box flexDirection="column" flexGrow={1}>
      {/* Top zone: virtual + board */}
      <box flexDirection="row" flexGrow={1}>
        <Show when={isVisible("virtual")}><VirtualPanel /></Show>
        <Show when={isVisible("board")}><BoardView /></Show>
      </box>
      {/* Bottom zone: agents */}
      <Show when={isVisible("agents")}>
        <AgentsBar height={7} />
      </Show>
    </box>
    {/* Right column: timeline */}
    <Show when={isVisible("timeline")}>
      <TimelineView width={50} />
    </Show>
  </box>
  <ModalLayer />
  <BottomBar />
</box>
```

### 7.2 TimelineView

- 24h vertical column. Each hour = 2 rows (00 min and 30 min sub-slots). Total ~48 rows for the day. Scrolls vertically if taller than available space.
- Time-blocked task bands span from `startMin/30` to `endMin/30` rows, colored by priority / status (same palette as TaskRow).
- "Now" indicator: red horizontal line at current minute.
- Cursor: in this zone, j/k moves between time blocks (not minute-by-minute). Pressing `⏎` switches `activeZone` to `"board"` AND moves the kanban cursor onto the underlying task (so subsequent kanban shortcuts act on it).
- Mouse: click on a band → same behavior as `⏎` (switch zone + move kanban cursor). Drag on empty area → opens "create time block" modal (deferred; v1 = click only).

### 7.3 AgentsBar

- Compact list, 1 row per session. Shows: status dot + name + machine + status text + cwd.
- Status dot color: green (live), amber (idle), gray (done).
- Sorted: live first, then by `lastActivityTs` desc.
- Scrolls vertically if more sessions than visible rows.
- `⏎` on a session opens a modal with last 5 messages preview + "Resume" action.
- "Resume" action: spawn `wt -w 0 nt -p "PowerShell" -d <cwd> claude --resume <id>` (Windows) or equivalent. Deferred to a follow-up — v1 just shows the session list and the command to copy.

### 7.4 Modified TopBar / BottomBar

- TopBar gains a zone indicator: `[Today/Tom · Board · Timeline · Agents]` with active zone bolded.
- BottomBar keybar updated to include `F1/F2/F3 toggle zone`.

## 8. Keyboard map (updated)

Unchanged from current:
- `hjkl` / arrows → navigate within active zone
- `Tab` / `1-9` → switch board (kanban only)
- `z` → zoom (kanban only)
- `Space` → mark task
- `o` → detail
- `Enter` → toggle done / activate item
- `t`/`m`/`s`/`b`/`a`/`n`/`e`/`d`/`X` → task actions (kanban only)
- `T` → reset all overdue
- `Ctrl+Z` → undo
- `Esc` → close modal / clear marks
- `q` / `Ctrl+C` → quit

New:
- `Shift+Tab` → cycle `activeZone` (Virtual → Board → Timeline → Agents → Virtual). Skips hidden zones.
- `F1` → toggle Virtual panel
- `F2` → toggle Timeline
- `F3` → toggle Agents
- In Timeline zone: `j/k` → next/prev time block, `⏎` → jump kanban cursor to task
- In Agents zone: `j/k` → next/prev session, `⏎` → open detail modal + copy resume command

## 9. Build phasing

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **5.1 Skeleton** | Refactor `inVirtual → activeZone`, dashboard 4-zone layout with timeline and agents as empty placeholders, `--view=X` argv parsing | All 4 zone borders visible; Shift+Tab cycles; `--view=board` opens kanban-only fullscreen; existing kanban functionality intact |
| **5.2 Agent view** | `store/agents.ts`, `ui/AgentsBar.tsx`, `views/AgentsOnly.tsx`, jsonl discovery + tail | Agents bar shows live sessions; `tuiboard --view=agents` works; click → detail modal with resume command |
| **5.3 Timeline** | `store/timeline.ts`, `ui/TimelineView.tsx`, `views/TimelineOnly.tsx`, time-block bands render | Timeline shows today's time blocks; click on band → kanban cursor jumps; `tuiboard --view=timeline` works |
| **5.4 Responsive** | Read terminal dimensions at mount + on resize; F1/F2/F3 toggle keys; collapse breakpoints | Layout adapts at 150/120/100 col breakpoints; toggles work independently of width |
| **5.5 Distribution** | Build script, README, `bun install -g tuiboard`, basic doctor command to validate `.tuiboard/config.yaml` | Fresh machine: `bun install -g tuiboard && tuiboard` works |

Each phase commits independently and leaves `tuiboard` runnable on `main`.

## 10. Risks & open issues

1. **`useTerminalDimensions` crashes on mount** (known from current code). Mitigation: read `process.stdout.columns` / `.rows` directly + listen on `process.stdout.on('resize', ...)`. Skip the OpenTUI hook entirely.

2. **Tab cycling with hidden zones** needs a `getVisibleZones()` helper that returns only zones in `visibleZones` set. Trivial.

3. **Multi-instance write conflicts**: if two `tuiboard` processes edit the same task at the same time, the second write hits an mtime conflict and shows a banner. UX is mildly annoying but no data loss. Acceptable for v1.

4. **Timeline drag-to-schedule via mouse**: mouseDown→Move→Up tracking in OpenTUI is unproven. v1 ships click-only on existing bands. Drag-to-create is a Day 5.3.x follow-up if the click-only feels limiting.

5. **Agent view "resume" action**: spawning a new WezTerm window with a specific cwd + `claude --resume <id>` is OS-dependent. v1 ships the command string + clipboard copy as fallback. v2 can shell out.

6. **`~/.claude/projects/` schema drift**: jsonl format is internal to Claude Code and may change between versions. Parser must be defensive (try/catch per line, skip malformed messages).

7. **Performance**: tailing many .jsonl files (Nazz has ~20-30 active session files) with chokidar is fine. But re-reading entire files on every line append would be O(file size) per update; we should track read offset per file and only parse new bytes. This is a known pattern and not high-risk.

## 11. Decisions captured

- Layout = reading flow top-left → bottom-right (NOT 1:1 Python replica).
- Single binary, dispatched by `--view=X` flag, default = full dashboard.
- Agent view = horizontal strip at bottom-left, ~7 rows, 1 line per session.
- Timeline = right column full-height, ~50 col wide.
- Build order = skeleton → agent view → timeline → responsive → distribution.

---

*This spec will be turned into an implementation plan via the writing-plans skill once approved.*
