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
      view: "kanban",
      marked: {},
      filter: "all",
    },
    undo: [],
  });

  // ─── Watcher ─────────────────────────────────────────────────────────────
  const watcher: BoardWatcher = createBoardWatcher(
    initialBoards.map((b) => b.board.filepath),
  );

  // Agents store has its own lifecycle (chokidar watcher on ~/.claude).
  // Shared dispose() boundary below so SIGINT cleans both.
  const agentsStore: AgentsStore = createAgentsStore();
  watcher.onChange((filepath) => {
    // External edit. Re-read this board from disk.
    try {
      const content = readFileSync(filepath, "utf-8");
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
    try {
      const content = serializeBoard(lb.board);
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

    let taskIndex = 0;
    setState(
      "boards",
      (b) => b.board.filepath === boardPath,
      "board",
      "columns",
      columnIndex,
      produce((c: Column) => {
        if (insertPos === "top") {
          c.children.unshift(newTask);
          taskIndex = 0;
        } else {
          c.children.push(newTask);
          taskIndex = listTasks(c).length - 1;
        }
      }),
    );

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

  function setZoomed(v: boolean): void {
    setState("ui", "zoomed", v);
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
  }

  function isMarked(ref: TaskRef): boolean {
    return state.ui.marked[markKey(ref)] === true;
  }

  function clearMarks(): void {
    setState("ui", "marked", {});
  }

  /** Decoded list of currently marked refs. */
  function getMarkedRefs(): TaskRef[] {
    return Object.keys(state.ui.marked).map((k) => {
      const [boardPath, ci, ti] = k.split("::");
      return {
        boardPath: boardPath!,
        columnIndex: Number(ci),
        taskIndex: Number(ti),
      };
    });
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
  }

  return {
    state,
    config,
    activeBoard,
    agents: agentsStore,
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

export function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
