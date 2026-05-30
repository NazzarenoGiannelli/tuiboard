/**
 * Reactive store — single source of truth for tuiboard.
 *
 * Built on Solid's `createStore` (proxied mutable store) for cheap fine-
 * grained reactivity: a change to a single task's `done` flag re-renders
 * only the views observing that task, not the whole board.
 *
 * The store also owns:
 *   - The list of loaded boards (with their original mtime watermark)
 *   - UI state: active board index, cursor (col/row), collapse flags,
 *     filter, mode (kanban / virtual / list)
 *   - The undo log
 *
 * Mutations always:
 *   1. Update the in-memory model.
 *   2. Mark the touched task as `dirty: true`.
 *   3. Push an inverse action onto the undo log.
 *   4. Schedule a debounced write to disk (writer + watcher self-mark).
 */

import { readFileSync } from "node:fs";
import { createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";

import type { Config } from "~/config/loader";
import {
  createBoardWatcher,
  type BoardWatcher,
} from "~/io/watcher";
import { createAgentsStore, type AgentsStore } from "./agents";
import { createCalendarStore, type CalendarStore } from "./calendar";
import { ConflictError, statMtime, writeBoardFile } from "~/io/writer";
import { isTask, parseBoard } from "~/parser/markdown";
import { serializeBoard } from "~/parser/serialize";
import type {
  Board,
  Column,
  PriorityLevel,
  Task,
  TimeBlock,
} from "~/types";

// ─── Store shape ────────────────────────────────────────────────────────────

/** Identity of a task within the store: board path + column index + task index in column. */
export interface TaskRef {
  boardPath: string;
  columnIndex: number;
  /** Index of the task among `Task` children of its column (ignores blanks/breaks). */
  taskIndex: number;
}

export interface LoadedBoard {
  board: Board;
  /** mtime in ms at the moment of the last successful read or write. */
  mtimeMs: number;
}

export type ViewMode = "kanban" | "list";

export type ModalKind =
  | { kind: "add"; targetColumnIndex: number }
  | { kind: "edit"; ref: TaskRef }
  | { kind: "schedule"; ref: TaskRef }
  | { kind: "timeblock"; ref: TaskRef }
  | { kind: "assign"; ref: TaskRef }
  | { kind: "confirm-delete"; ref: TaskRef }
  | { kind: "detail"; ref: TaskRef }
  | { kind: "agent-detail"; sessionId: string }
  | { kind: "search" }
  | { kind: "help" };

/** Which dashboard zone owns the keyboard cursor. */
export type ActiveZone = "virtual" | "board" | "timeline" | "agents";

/** Fixed cycling order for Shift+Tab navigation. */
const ZONE_ORDER: readonly ActiveZone[] = ["virtual", "board", "timeline", "agents"];

export interface UIState {
  activeBoardIndex: number;
  /** Which dashboard zone owns the keyboard cursor right now. */
  activeZone: ActiveZone;
  /** Which zones are currently rendered. `board` cannot be hidden (load-bearing). */
  visibleZones: Record<ActiveZone, boolean>;
  /** Column index (within active board) — meaningful only when `activeZone === "board"`. */
  col: number;
  /** Row index inside the active zone. */
  row: number;
  /**
   * Zoom mode: when true, only the active column is rendered, taking the
   * full width of the board area. Done tasks within the zoomed column
   * become visible inline (since the user has explicitly focused there).
   * Toggled with `z`.
   */
  zoomed: boolean;
  /**
   * Grab mode: when true, h/l moves the cursor task between adjacent
   * columns instead of just moving the cursor. Toggled with `g`. Exit
   * with `g` again or `Esc`. Mirrors Python kanban `toggle_move`.
   */
  grabbing: boolean;
  /**
   * Currently-armed timeline block. Click-to-arm + click-to-place pattern
   * (mirrors Python timeline.py): first click arms; second click on an
   * empty row moves the armed block's start there; shift+click resizes
   * end. `j`/`k`/`+`/`-` while armed nudge the block by 15 min. `Esc`
   * cancels.
   */
  armedTimelineRef?: TaskRef;
  /**
   * Persistent calendar "arm mode" (toggled with `c`). While on, clicking any
   * task in the board / virtual panel arms it for the timeline, so you can
   * schedule several tasks in a row — click a task, click a slot, repeat —
   * without re-pressing `c`. `Esc` (or `c` again) exits. Distinct from
   * `armedTimelineRef`, which is the single task currently armed.
   */
  armMode: boolean;
  /**
   * Which day the Agenda (timeline) zone is showing, as a signed offset from
   * today (0 = today, +1 = tomorrow, -1 = yesterday). Drives both the task
   * entries and the calendar overlay. Changed with `[` / `]`; `\` resets to 0.
   */
  agendaOffset: number;
  view: ViewMode;
  /**
   * Tasks marked for bulk ops (`Space`). Key format:
   *   `${boardPath}::${columnIndex}::${taskIndex}`
   *
   * Plain Record for Solid reactivity (Set isn't tracked).
   */
  marked: Record<string, true>;
  /** Active filter. */
  filter: "all" | "today" | "overdue" | "tomorrow" | "followup";
  /** Banner messages (errors, conflicts, undo notifications). */
  banner?: { kind: "info" | "warn" | "error"; text: string; ts: number };
  /** Open modal, if any. Keyboard handler routes input to the modal when set. */
  modal?: ModalKind;
}

export interface UndoEntry {
  description: string;
  /** Inverse function — closes over enough state to restore the prior value. */
  inverse: () => void;
  ts: number;
}

export interface StoreState {
  boards: LoadedBoard[];
  ui: UIState;
  undo: UndoEntry[];
  /**
   * Monotonic mutation counter. Bumped on every board mutation (via
   * `saveBoard`). Derived views (board columns, virtual panel, timeline) read
   * it so their memos recompute on any change — a reliable top-level signal
   * dependency, since OpenTUI/Solid's fine-grained tracking of deeply-nested
   * store edits (e.g. growing a column's `children` array) doesn't always
   * propagate to an already-mounted `<For>`. This is the same mechanism that
   * makes a board switch refresh everything.
   */
  rev: number;
}

// ─── Construction ───────────────────────────────────────────────────────────

export interface CreateStoreOptions {
  config: Config;
}

export function createTuiStore({ config }: CreateStoreOptions) {
  const initialBoards = loadAll(config);

  const [state, setState] = createStore<StoreState>({
    boards: initialBoards,
    ui: {
      activeBoardIndex: 0,
      activeZone: "board",
      visibleZones: { virtual: true, board: true, timeline: true, agents: true },
      col: 0,
      row: 0,
      zoomed: false,
      grabbing: false,
      armMode: false,
      agendaOffset: 0,
      view: "kanban",
      marked: {},
      filter: "all",
    },
    undo: [],
    rev: 0,
  });

  // ─── Watcher ─────────────────────────────────────────────────────────────
  // Last content tuiboard itself wrote per board path — used by the watcher's
  // self-write guard to ignore our own writes echoed back by the OS / sync.
  const lastWrittenContent = new Map<string, string>();
  const watcher: BoardWatcher = createBoardWatcher(
    initialBoards.map((b) => b.board.filepath),
  );

  // Agents store has its own lifecycle (chokidar watcher on ~/.claude).
  // Shared dispose() boundary below so SIGINT cleans both.
  const agentsStore: AgentsStore = createAgentsStore();
  // Calendar feeds (read-only) merged into the Agenda zone. No-op when no
  // `calendars:` block is configured.
  const calendarStore: CalendarStore = createCalendarStore(config.calendars, isoToday);
  watcher.onChange((filepath) => {
    // External edit. Re-read this board from disk.
    try {
      const content = readFileSync(filepath, "utf-8");
      // Robust self-write guard: if what's on disk is byte-identical to what we
      // last wrote, this event is our own write echoed back — even if the mtime
      // changed (Windows fs latency, antivirus, or Obsidian/vault-sync
      // re-saving the same bytes). The in-memory board is authoritative, so
      // reloading would only clobber a just-added/edited task with no net
      // change — and spuriously flash "Reloaded after external edit". Skip.
      if (lastWrittenContent.get(filepath) === content) return;
      const { board } = parseBoard(content, { filepath });
      const mtimeMs = statMtime(filepath);
      setState(
        "boards",
        (b) => b.board.filepath === filepath,
        produce((lb) => {
          lb.board = board;
          lb.mtimeMs = mtimeMs;
        }),
      );
      setState("rev", (r) => r + 1);
      flashBanner("info", `Reloaded ${board.name} after external edit`);
    } catch (e) {
      flashBanner("error", `Reload failed: ${(e as Error).message}`);
    }
  });
  watcher.start();

  // ─── Derived selectors ───────────────────────────────────────────────────

  const activeBoard = createMemo(() => state.boards[state.ui.activeBoardIndex]?.board);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function getBoardByPath(path: string): LoadedBoard | undefined {
    return state.boards.find((b) => b.board.filepath === path);
  }

  function getTask(ref: TaskRef): Task | undefined {
    const lb = getBoardByPath(ref.boardPath);
    const col = lb?.board.columns[ref.columnIndex];
    if (!col) return undefined;
    let i = 0;
    for (const child of col.children) {
      if (isTask(child)) {
        if (i === ref.taskIndex) return child;
        i++;
      }
    }
    return undefined;
  }

  function listTasks(col: Column): Task[] {
    return col.children.filter(isTask);
  }

  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  function flashBanner(
    kind: "info" | "warn" | "error",
    text: string,
  ): void {
    const ts = Date.now();
    setState("ui", "banner", { kind, text, ts });
    if (bannerTimer) clearTimeout(bannerTimer);
    // Auto-dismiss after a few seconds so the keybar isn't permanently
    // crowded by stale messages. Errors linger a bit longer.
    const ttl = kind === "error" ? 6000 : 3000;
    bannerTimer = setTimeout(() => {
      if (state.ui.banner?.ts === ts) {
        setState("ui", "banner", undefined);
      }
    }, ttl);
  }

  function clearBanner(): void {
    if (bannerTimer) clearTimeout(bannerTimer);
    setState("ui", "banner", undefined);
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  /** Save the board containing the referenced task. */
  function saveBoard(boardPath: string): void {
    const lb = getBoardByPath(boardPath);
    if (!lb) return;
    // Signal "data changed" to every derived view (see StoreState.rev). This
    // runs for every mutation since they all persist through saveBoard.
    setState("rev", (r) => r + 1);
    try {
      const content = serializeBoard(lb.board);
      // Record what we're writing so the watcher can recognize this exact
      // content echoed back (Obsidian / vault-sync may re-save the file with
      // identical bytes but a fresh mtime — a content match means it's still
      // our write, not a genuine external edit).
      lastWrittenContent.set(boardPath, content);
      watcher.markSelfWrite(boardPath);
      const { mtimeMs } = writeBoardFile(boardPath, content, {
        expectedMtimeMs: lb.mtimeMs,
      });
      setState(
        "boards",
        (b) => b.board.filepath === boardPath,
        "mtimeMs",
        mtimeMs,
      );
    } catch (e) {
      if (e instanceof ConflictError) {
        flashBanner(
          "warn",
          `${boardPath.split(/[/\\]/).pop()} changed externally — reload before saving`,
        );
        // Re-read to recover.
        try {
          const content = readFileSync(boardPath, "utf-8");
          const { board } = parseBoard(content, { filepath: boardPath });
          setState(
            "boards",
            (b) => b.board.filepath === boardPath,
            produce((lb2) => {
              lb2.board = board;
              lb2.mtimeMs = statMtime(boardPath);
            }),
          );
        } catch {
          // ignore — banner already shown
        }
      } else {
        flashBanner("error", `Save failed: ${(e as Error).message}`);
      }
    }
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  function pushUndo(entry: Omit<UndoEntry, "ts">): void {
    setState(
      "undo",
      produce((u) => {
        u.push({ ...entry, ts: Date.now() });
        // Cap at 50 entries.
        while (u.length > 50) u.shift();
      }),
    );
  }

  function undo(): void {
    const last = state.undo[state.undo.length - 1];
    if (!last) {
      flashBanner("info", "Nothing to undo");
      return;
    }
    last.inverse();
    setState("undo", (u) => u.slice(0, -1));
    flashBanner("info", `Undone: ${last.description}`);
  }

  function toggleDone(ref: TaskRef): void {
    const task = getTask(ref);
    if (!task) return;
    const wasD = task.done;
    const prevDoneDate = task.doneDate;
    const today = isoToday();

    setState(
      "boards",
      (b) => b.board.filepath === ref.boardPath,
      "board",
      "columns",
      ref.columnIndex,
      produce((col: Column) => {
        const t = listTasks(col)[ref.taskIndex];
        if (!t) return;
        t.done = !wasD;
        t.dirty = true;
        t.doneDate = t.done ? (prevDoneDate ?? today) : undefined;
      }),
    );

    pushUndo({
      description: `toggle done: ${task.displayTitle.slice(0, 40)}`,
      inverse: () => {
        setState(
          "boards",
          (b) => b.board.filepath === ref.boardPath,
          "board",
          "columns",
          ref.columnIndex,
          produce((col: Column) => {
            const t = listTasks(col)[ref.taskIndex];
            if (!t) return;
            t.done = wasD;
            t.doneDate = prevDoneDate;
            t.dirty = true;
          }),
        );
        saveBoard(ref.boardPath);
      },
    });

    saveBoard(ref.boardPath);
  }

  function setScheduled(ref: TaskRef, date: string | undefined): void {
    const task = getTask(ref);
    if (!task) return;
    const prev = task.scheduled;
    mutateTask(ref, (t) => {
      t.scheduled = date;
      t.dirty = true;
    });
    pushUndo({
      description: `schedule date`,
      inverse: () => {
        mutateTask(ref, (t) => {
          t.scheduled = prev;
          t.dirty = true;
        });
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  function setTimeBlock(ref: TaskRef, tb: TimeBlock | undefined): void {
    const task = getTask(ref);
    if (!task) return;
    const prev = task.timeBlock;
    const prevSrc = task.timeBlockSource;
    mutateTask(ref, (t) => {
      t.timeBlock = tb;
      t.timeBlockSource = tb ? "watch-emoji" : undefined;
      t.dirty = true;
    });
    pushUndo({
      description: `time block`,
      inverse: () => {
        mutateTask(ref, (t) => {
          t.timeBlock = prev;
          t.timeBlockSource = prevSrc;
          t.dirty = true;
        });
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  function setAssignee(ref: TaskRef, assignee: string | undefined): void {
    const task = getTask(ref);
    if (!task) return;
    const prev = task.assignee;
    mutateTask(ref, (t) => {
      t.assignee = assignee;
      t.dirty = true;
    });
    pushUndo({
      description: `assignee`,
      inverse: () => {
        mutateTask(ref, (t) => {
          t.assignee = prev;
          t.dirty = true;
        });
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  function setPriority(ref: TaskRef, p: PriorityLevel): void {
    const task = getTask(ref);
    if (!task) return;
    const prev = task.priority;
    mutateTask(ref, (t) => {
      t.priority = p;
      t.dirty = true;
    });
    pushUndo({
      description: `priority`,
      inverse: () => {
        mutateTask(ref, (t) => {
          t.priority = prev;
          t.dirty = true;
        });
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  function editDisplayTitle(ref: TaskRef, title: string): void {
    const task = getTask(ref);
    if (!task) return;
    const prev = task.displayTitle;
    mutateTask(ref, (t) => {
      t.displayTitle = title;
      t.dirty = true;
    });
    pushUndo({
      description: `edit text`,
      inverse: () => {
        mutateTask(ref, (t) => {
          t.displayTitle = prev;
          t.dirty = true;
        });
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  /** Insert a brand-new task into a column. Returns its ref. */
  function addTask(
    boardPath: string,
    columnIndex: number,
    init: Partial<Task> & { displayTitle: string },
    insertPos: "top" | "bottom" = "top",
  ): TaskRef | undefined {
    const lb = getBoardByPath(boardPath);
    if (!lb) return undefined;
    const col = lb.board.columns[columnIndex];
    if (!col) return undefined;

    const newTask: Task = {
      id: `${columnIndex}:new-${Date.now()}`,
      done: false,
      rawBody: "",
      rawLine: "",
      dirty: true,
      displayTitle: init.displayTitle,
      tags: init.tags ?? [],
      wikilinks: init.wikilinks ?? [],
      priority: init.priority ?? "none",
      assignee: init.assignee,
      scheduled: init.scheduled,
      due: init.due,
      start: init.start,
      doneDate: init.doneDate,
      timeBlock: init.timeBlock,
      timeBlockSource: init.timeBlock ? "watch-emoji" : undefined,
    };

    // Insert by REASSIGNING the children array (not an in-place unshift/push
    // inside produce). A new array reference is what Solid's <For> reliably
    // reconciles; the in-place mutation left the mounted column stale until the
    // board was switched away and back. (Delete uses splice and happened to
    // re-render, but reassignment is the dependable pattern for both grow and
    // shrink.)
    const prevTaskCount = listTasks(col).length;
    setState(
      "boards",
      (b) => b.board.filepath === boardPath,
      "board",
      "columns",
      columnIndex,
      "children",
      (prev: Column["children"]) =>
        insertPos === "top" ? [newTask, ...prev] : [...prev, newTask],
    );
    const taskIndex = insertPos === "top" ? 0 : prevTaskCount;

    pushUndo({
      description: `add task: ${init.displayTitle.slice(0, 40)}`,
      inverse: () => {
        setState(
          "boards",
          (b) => b.board.filepath === boardPath,
          "board",
          "columns",
          columnIndex,
          produce((c: Column) => {
            const idx = c.children.indexOf(newTask);
            if (idx >= 0) c.children.splice(idx, 1);
          }),
        );
        saveBoard(boardPath);
      },
    });

    saveBoard(boardPath);
    return { boardPath, columnIndex, taskIndex };
  }

  function deleteTask(ref: TaskRef): void {
    const lb = getBoardByPath(ref.boardPath);
    if (!lb) return;
    const col = lb.board.columns[ref.columnIndex];
    if (!col) return;
    // Find the children-index of the Nth task.
    let found = -1;
    let i = 0;
    for (let k = 0; k < col.children.length; k++) {
      if (isTask(col.children[k]!)) {
        if (i === ref.taskIndex) { found = k; break; }
        i++;
      }
    }
    if (found < 0) return;
    const removed = col.children[found]!;
    setState(
      "boards",
      (b) => b.board.filepath === ref.boardPath,
      "board",
      "columns",
      ref.columnIndex,
      produce((c: Column) => {
        c.children.splice(found, 1);
      }),
    );
    pushUndo({
      description: `delete task`,
      inverse: () => {
        setState(
          "boards",
          (b) => b.board.filepath === ref.boardPath,
          "board",
          "columns",
          ref.columnIndex,
          produce((c: Column) => {
            c.children.splice(found, 0, removed);
          }),
        );
        saveBoard(ref.boardPath);
      },
    });
    saveBoard(ref.boardPath);
  }

  /** Move a task between columns of the same board. */
  function moveTaskWithinBoard(
    ref: TaskRef,
    destColumnIndex: number,
    destInsertAt: "top" | "bottom" = "top",
  ): TaskRef | undefined {
    if (destColumnIndex === ref.columnIndex) return ref;
    const lb = getBoardByPath(ref.boardPath);
    if (!lb) return undefined;
    const srcCol = lb.board.columns[ref.columnIndex];
    const dstCol = lb.board.columns[destColumnIndex];
    if (!srcCol || !dstCol) return undefined;

    // Find children-index of the source task.
    let srcCh = -1;
    let i = 0;
    for (let k = 0; k < srcCol.children.length; k++) {
      if (isTask(srcCol.children[k]!)) {
        if (i === ref.taskIndex) { srcCh = k; break; }
        i++;
      }
    }
    if (srcCh < 0) return undefined;
    const task = srcCol.children[srcCh] as Task;

    let newTaskIndex = 0;
    setState(
      "boards",
      (b) => b.board.filepath === ref.boardPath,
      "board",
      "columns",
      produce((cols: Column[]) => {
        cols[ref.columnIndex]!.children.splice(srcCh, 1);
        const target = cols[destColumnIndex]!;
        if (destInsertAt === "top") {
          target.children.unshift(task);
          newTaskIndex = 0;
        } else {
          target.children.push(task);
          newTaskIndex = target.children.filter(isTask).length - 1;
        }
        task.dirty = true;
      }),
    );

    pushUndo({
      description: `move task`,
      inverse: () => {
        setState(
          "boards",
          (b) => b.board.filepath === ref.boardPath,
          "board",
          "columns",
          produce((cols: Column[]) => {
            const idx = cols[destColumnIndex]!.children.indexOf(task);
            if (idx >= 0) cols[destColumnIndex]!.children.splice(idx, 1);
            cols[ref.columnIndex]!.children.splice(srcCh, 0, task);
          }),
        );
        saveBoard(ref.boardPath);
      },
    });

    saveBoard(ref.boardPath);
    return { ...ref, columnIndex: destColumnIndex, taskIndex: newTaskIndex };
  }

  // ─── Cursor / UI ─────────────────────────────────────────────────────────

  function setActiveBoard(idx: number): void {
    const len = state.boards.length;
    if (len === 0) return;
    setState("ui", "activeBoardIndex", ((idx % len) + len) % len);
    setState("ui", "col", 0);
    setState("ui", "row", 0);
    setState("ui", "activeZone", "board");
  }

  function setCursor(col: number, row: number): void {
    setState("ui", "col", Math.max(0, col));
    setState("ui", "row", Math.max(0, row));
  }

  function setActiveZone(zone: ActiveZone): void {
    setState("ui", "activeZone", zone);
    // Moving to a vertical-list zone (virtual / agents / timeline) resets
    // the row cursor to the top so the user always lands somewhere sensible.
    if (zone !== "board") setState("ui", "row", 0);
  }

  function setZoneVisible(zone: ActiveZone, visible: boolean): void {
    // Board is the load-bearing zone — never allow it to be hidden.
    if (zone === "board" && !visible) return;
    setState("ui", "visibleZones", zone, visible);
    // If we just hid the active zone, bounce the cursor to "board".
    if (!visible && state.ui.activeZone === zone) {
      setActiveZone("board");
    }
  }

  function cycleActiveZone(): void {
    const visible = ZONE_ORDER.filter((z) => state.ui.visibleZones[z]);
    if (visible.length <= 1) return;
    const currentIdx = visible.indexOf(state.ui.activeZone);
    const nextIdx = (currentIdx + 1) % visible.length;
    setActiveZone(visible[nextIdx]!);
  }

  function toggleZoom(): void {
    setState("ui", "zoomed", (z: boolean) => !z);
  }

  function setFilter(f: UIState["filter"]): void {
    setState("ui", "filter", f);
    // The cursor's row was an index into the unfiltered list — reset to top
    // of the new view to avoid pointing past the filtered tail.
    setState("ui", "row", 0);
  }

  /**
   * Apply the current board filter to an open-task list. Used by both the
   * BoardView render (to decide what to draw) and handleKey (to keep the
   * cursor reference aligned with the rendered list).
   */
  function applyBoardFilter(tasks: Task[]): Task[] {
    const f = state.ui.filter;
    if (f === "all") return tasks;
    const today = isoToday();
    const tomorrow = isoTomorrow();
    switch (f) {
      case "today":
        return tasks.filter((t) => t.scheduled === today);
      case "overdue":
        return tasks.filter((t) => t.scheduled !== undefined && t.scheduled < today);
      case "tomorrow":
        return tasks.filter((t) => t.scheduled === tomorrow);
      case "followup":
        return tasks.filter((t) => t.tags.includes("pr-followup"));
    }
    return tasks;
  }

  function setZoomed(v: boolean): void {
    setState("ui", "zoomed", v);
  }

  function toggleGrab(): void {
    setState("ui", "grabbing", (g: boolean) => !g);
  }

  function exitGrab(): void {
    setState("ui", "grabbing", false);
  }

  function armTimeline(ref: TaskRef | undefined): void {
    setState("ui", "armedTimelineRef", ref);
  }

  function setArmMode(on: boolean): void {
    setState("ui", "armMode", on);
  }

  /** ISO date the Agenda is currently showing (today + offset). Reactive. */
  function agendaDate(): string {
    return isoAddDays(isoToday(), state.ui.agendaOffset);
  }

  /**
   * Move the Agenda's viewed day. `delta` shifts relative to the current day;
   * pass `0`-reset behavior via `resetAgendaDay`. Clamped to ±365 days so the
   * calendar fetch can't run away. Resets the timeline cursor and disarms,
   * since the prior day's armed block no longer renders.
   */
  function shiftAgendaDay(delta: number): void {
    const next = Math.max(-365, Math.min(365, state.ui.agendaOffset + delta));
    if (next === state.ui.agendaOffset) return;
    setState("ui", "agendaOffset", next);
    setState("ui", "row", 0);
    setState("ui", "armedTimelineRef", undefined);
  }

  function resetAgendaDay(): void {
    if (state.ui.agendaOffset === 0) return;
    setState("ui", "agendaOffset", 0);
    setState("ui", "row", 0);
    setState("ui", "armedTimelineRef", undefined);
  }

  // ─── Multi-select ────────────────────────────────────────────────────────

  function markKey(ref: TaskRef): string {
    return `${ref.boardPath}::${ref.columnIndex}::${ref.taskIndex}`;
  }

  function toggleMark(ref: TaskRef): void {
    const key = markKey(ref);
    setState("ui", "marked", produce((m: Record<string, true>) => {
      if (m[key]) delete m[key];
      else m[key] = true;
    }));
    // Bump rev so the ● indicators re-render. OpenTUI/Solid's fine-grained
    // tracking of a dynamic-key Record doesn't reliably reach the mounted
    // task rows; rev is the proven top-level signal (same as the cursor).
    setState("rev", (r) => r + 1);
  }

  function isMarked(ref: TaskRef): boolean {
    state.rev; // subscribe to the mutation counter (see toggleMark/clearMarks)
    return state.ui.marked[markKey(ref)] === true;
  }

  function clearMarks(): void {
    // Delete keys via produce (NOT `setState("ui","marked",{})`): replacing the
    // whole object doesn't notify subscribers that read it via Object.keys(),
    // so the ● indicators wouldn't repaint. A produce-mutation does notify
    // granularly — same path toggleMark uses.
    setState("ui", "marked", produce((m: Record<string, true>) => {
      for (const k of Object.keys(m)) delete m[k];
    }));
    setState("rev", (r) => r + 1);
  }

  /**
   * Decoded list of currently marked refs, sorted by board, then column, then
   * taskIndex DESCENDING. The descending order matters for index-shifting
   * operations (delete, archive/move): processing the highest taskIndex first
   * means earlier indices stay valid as later tasks are removed. Order is
   * irrelevant for in-place edits (schedule, time block, priority, done).
   */
  function getMarkedRefs(): TaskRef[] {
    return Object.keys(state.ui.marked)
      .map((k) => {
        const [boardPath, ci, ti] = k.split("::");
        return {
          boardPath: boardPath!,
          columnIndex: Number(ci),
          taskIndex: Number(ti),
        };
      })
      .sort((a, b) =>
        a.boardPath !== b.boardPath
          ? a.boardPath.localeCompare(b.boardPath)
          : a.columnIndex !== b.columnIndex
            ? a.columnIndex - b.columnIndex
            : b.taskIndex - a.taskIndex,
      );
  }

  /**
   * Apply a single-task action to the marked set if non-empty, otherwise
   * to the provided fallback ref. The caller passes the bound action.
   */
  function applyToMarkedOr(
    fallback: TaskRef | undefined,
    action: (ref: TaskRef) => void,
  ): number {
    const marked = getMarkedRefs();
    if (marked.length > 0) {
      for (const ref of marked) action(ref);
      clearMarks();
      return marked.length;
    }
    if (fallback) {
      action(fallback);
      return 1;
    }
    return 0;
  }

  // ─── Archive ─────────────────────────────────────────────────────────────

  /**
   * Move the task into the configured Archive column. If the Archive
   * column doesn't exist on the board, create one at the end and use it.
   * Returns the new TaskRef inside Archive, or undefined on failure.
   */
  function archiveTask(ref: TaskRef): TaskRef | undefined {
    const lb = getBoardByPath(ref.boardPath);
    if (!lb) return undefined;
    const archiveName = config.archiveColumn;
    let archiveIdx = lb.board.columns.findIndex((c) => c.name === archiveName);
    if (archiveIdx < 0) {
      // Create Archive column at the end.
      const lineEnding = lb.board.lineEnding;
      setState(
        "boards",
        (b) => b.board.filepath === ref.boardPath,
        "board",
        "columns",
        produce((cols: Column[]) => {
          cols.push({
            name: archiveName,
            headerLevel: 2,
            rawHeading: `## ${archiveName}`,
            children: [],
          });
        }),
      );
      void lineEnding;
      archiveIdx = lb.board.columns.length - 1;
    }
    return moveTaskWithinBoard(ref, archiveIdx, "top");
  }

  // ─── Bulk: reset all overdue across all boards to today ──────────────────

  function resetAllOverdueToToday(): number {
    const today = isoToday();
    let count = 0;
    for (const lb of state.boards) {
      const board = lb.board;
      for (let ci = 0; ci < board.columns.length; ci++) {
        const col = board.columns[ci]!;
        let ti = 0;
        for (const child of col.children) {
          if (!isTask(child)) continue;
          if (!child.done && child.scheduled && child.scheduled < today) {
            setScheduled(
              { boardPath: board.filepath, columnIndex: ci, taskIndex: ti },
              today,
            );
            count++;
          }
          ti++;
        }
      }
    }
    return count;
  }

  function openModal(m: ModalKind): void {
    setState("ui", "modal", m);
  }

  function closeModal(): void {
    setState("ui", "modal", undefined);
  }

  // ─── Private mutation helper ─────────────────────────────────────────────

  function mutateTask(ref: TaskRef, f: (t: Task) => void): void {
    setState(
      "boards",
      (b) => b.board.filepath === ref.boardPath,
      "board",
      "columns",
      ref.columnIndex,
      produce((col: Column) => {
        const t = listTasks(col)[ref.taskIndex];
        if (t) f(t);
      }),
    );
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  async function dispose(): Promise<void> {
    await watcher.stop();
    await agentsStore.dispose();
    await calendarStore.dispose();
  }

  return {
    state,
    config,
    activeBoard,
    agents: agentsStore,
    calendar: calendarStore,
    // queries
    getBoardByPath,
    getTask,
    listTasks,
    // mutations
    toggleDone,
    setScheduled,
    setTimeBlock,
    setAssignee,
    setPriority,
    editDisplayTitle,
    addTask,
    deleteTask,
    moveTaskWithinBoard,
    // ui
    setActiveBoard,
    setCursor,
    setActiveZone,
    setZoneVisible,
    cycleActiveZone,
    toggleZoom,
    toggleGrab,
    exitGrab,
    armTimeline,
    setArmMode,
    agendaDate,
    shiftAgendaDay,
    resetAgendaDay,
    setFilter,
    applyBoardFilter,
    setZoomed,
    toggleMark,
    isMarked,
    clearMarks,
    getMarkedRefs,
    applyToMarkedOr,
    archiveTask,
    resetAllOverdueToToday,
    openModal,
    closeModal,
    flashBanner,
    clearBanner,
    // undo
    undo,
    // lifecycle
    dispose,
  };
}

export type TuiStore = ReturnType<typeof createTuiStore>;

// ─── Load helpers ────────────────────────────────────────────────────────────

function loadAll(config: Config): LoadedBoard[] {
  const out: LoadedBoard[] = [];
  for (const b of config.boards) {
    try {
      const content = readFileSync(b.path, "utf-8");
      const { board } = parseBoard(content, { filepath: b.path });
      if (b.name) board.name = b.name;
      out.push({ board, mtimeMs: statMtime(b.path) });
    } catch (e) {
      console.error(`Skipping ${b.path}: ${(e as Error).message}`);
    }
  }
  return out;
}

export function isoToday(): string {
  return isoDate(new Date());
}

export function isoTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/** Add `n` days to an ISO date string (handles month/year/DST rollover). */
export function isoAddDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y!, (m ?? 1) - 1, (d ?? 1) + n));
}

export function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
