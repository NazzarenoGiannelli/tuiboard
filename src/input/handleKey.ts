/**
 * Centralized keyboard input handler. Dispatches based on:
 *   1. modal state (modal eats most keys)
 *   2. global keys (quit, help, undo, board switch, escape, zone cycle)
 *   3. active zone (virtual / board / timeline / agents)
 *
 * Task-level actions (`t`/`m`/`s`/`b`/`a`/`o`/`Space`/`X`/`d`/`p`/`.`/`Enter`)
 * all route through `dispatchTaskAction`, so they work identically on a
 * cursor task whether you reach it via the kanban board, the virtual
 * panel, or a timeline block.
 *
 * Extracted from app.tsx so every root view (Dashboard, BoardOnly, etc.)
 * shares the same input contract.
 */

import { isHiddenColumn } from "~/config/loader";
import { isTask } from "~/parser/markdown";
import {
  isoToday,
  isoTomorrow,
  type ModalKind,
  type TaskRef,
  type TuiStore,
} from "~/store/index";
import type { Board, PriorityLevel } from "~/types";
import { buildTimelineEntries } from "~/store/timeline";
import { buildVirtualItems } from "~/store/virtual-panel";
import { jumpToKanban } from "~/ui/TimelineView";

interface KeyEvent {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  sequence?: string;
}

export function handleKey(
  store: TuiStore,
  key: KeyEvent,
  virtualCount: number,
): void {
  const ui = store.state.ui;
  const board = store.state.boards[ui.activeBoardIndex]?.board;

  // Modal dispatcher first — most keys go to the modal's <input>.
  if (ui.modal) {
    if (key.name === "escape") {
      store.closeModal();
      return;
    }
    if (ui.modal.kind === "confirm-delete") {
      if (key.name === "y") {
        // Delete the whole multi-selection if any, else just the cursor task.
        const n = store.applyToMarkedOr(ui.modal.ref, (r) => store.deleteTask(r));
        store.closeModal();
        if (n > 1) store.flashBanner("info", `Deleted ${n} tasks`);
      } else if (key.name === "n") {
        store.closeModal();
      }
      return;
    }
    if ((ui.modal.kind === "help" ||
         ui.modal.kind === "detail" ||
         ui.modal.kind === "agent-detail") &&
        (key.name === "?" || key.sequence === "?" || key.name === "o")) {
      store.closeModal();
      return;
    }
    return;
  }

  // Quit
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    store.dispose().finally(() => process.exit(0));
    return;
  }

  // Escape priority: arm mode / timeline arm → grab mode → marks. Most
  // disruptive first.
  if (key.name === "escape") {
    if (ui.armMode || ui.armedTimelineRef) {
      const wasMode = ui.armMode;
      store.setArmMode(false);
      store.armTimeline(undefined);
      store.flashBanner("info", wasMode ? "Arm mode off" : "Disarmed");
      return;
    }
    if (ui.grabbing) {
      store.exitGrab();
      store.flashBanner("info", "Grab released");
      return;
    }
    if (Object.keys(ui.marked).length > 0) {
      store.clearMarks();
      store.flashBanner("info", "Selection cleared");
    }
    return;
  }

  // Help
  if (key.name === "?" || key.sequence === "?") {
    store.openModal({ kind: "help" });
    return;
  }

  // Search — opens a modal that jumps the kanban cursor to the first
  // matching open task. Available globally so users can `/` from any
  // zone. OpenTUI may name the key `slash` or pass `/` as sequence,
  // depending on terminal — accept all common variants.
  if (key.name === "slash" || key.name === "/" || key.sequence === "/") {
    setTimeout(() => store.openModal({ kind: "search" }), 0);
    return;
  }

  // Bulk: reset all overdue across all boards → today (Shift+T).
  if (key.name === "t" && key.shift) {
    const n = store.resetAllOverdueToToday();
    store.flashBanner("info", n > 0 ? `Reset ${n} overdue → today` : "No overdue tasks");
    return;
  }

  // Shift+Tab cycles the active dashboard zone (skips hidden zones).
  if (key.name === "tab" && key.shift) {
    store.cycleActiveZone();
    return;
  }

  // F1/F2/F3 toggle zone visibility. Board cannot be hidden.
  if (key.name === "f1") {
    store.setZoneVisible("virtual", !ui.visibleZones.virtual);
    return;
  }
  if (key.name === "f2") {
    store.setZoneVisible("timeline", !ui.visibleZones.timeline);
    return;
  }
  if (key.name === "f3") {
    store.setZoneVisible("agents", !ui.visibleZones.agents);
    return;
  }

  // Cycle boards
  if (key.name === "tab") {
    store.setActiveBoard(ui.activeBoardIndex + 1);
    return;
  }
  if (/^[1-9]$/.test(key.name)) {
    const i = parseInt(key.name, 10) - 1;
    if (i < store.state.boards.length) store.setActiveBoard(i);
    return;
  }

  // Switch in/out of virtual panel with `v`
  if (key.name === "v") {
    store.setActiveZone(ui.activeZone === "virtual" ? "board" : "virtual");
    return;
  }

  // Cycle the board filter — affects which open tasks show up in board
  // columns. Mirrors Python kanban `action_cycle_filter`. Cycle order:
  // all → today → overdue → tomorrow → followup → all.
  if (key.name === "f") {
    const cycle = ["all", "today", "overdue", "tomorrow", "followup"] as const;
    const idx = cycle.indexOf(ui.filter);
    const next = cycle[(idx + 1) % cycle.length]!;
    store.setFilter(next);
    store.flashBanner("info", `Filter: ${next}`);
    return;
  }

  // Undo
  if (key.ctrl && key.name === "z") {
    store.undo();
    return;
  }

  // Zoom toggle: focus the active panel (board column or virtual panel)
  // at full width.
  if (key.name === "z") {
    store.toggleZoom();
    return;
  }

  // Defer modal opens by one macrotask so the OpenTUI <input> mounts after
  // the current key event has been fully dispatched.
  const openLater = (m: ModalKind) => {
    setTimeout(() => store.openModal(m), 0);
  };

  // ─── Per-zone dispatching ───────────────────────────────────────────────

  if (ui.activeZone === "virtual") {
    handleVirtualZone(store, key, virtualCount, openLater);
    return;
  }

  if (ui.activeZone === "timeline") {
    handleTimelineZone(store, key, openLater);
    return;
  }

  if (ui.activeZone === "agents") {
    handleAgentsZone(store, key);
    return;
  }

  // Inside a board
  if (!board) return;
  handleBoardZone(store, key, openLater);
}

// ─── Zone handlers ──────────────────────────────────────────────────────────

function handleVirtualZone(
  store: TuiStore,
  key: KeyEvent,
  virtualCount: number,
  openLater: (m: ModalKind) => void,
): void {
  const ui = store.state.ui;
  const items = buildVirtualItems(store.state.boards.map((b) => b.board));
  const target = items[ui.row];

  // Navigation
  if (key.name === "j" || key.name === "down") {
    store.setCursor(ui.col, Math.min(virtualCount - 1, ui.row + 1));
    return;
  }
  if (key.name === "k" || key.name === "up") {
    store.setCursor(ui.col, Math.max(0, ui.row - 1));
    return;
  }
  if (key.name === "l" || key.name === "right") {
    store.setActiveZone("board");
    return;
  }

  // Task actions on the virtual cursor's target (works cross-board).
  if (target) {
    dispatchTaskAction(store, key, target.ref, openLater, () =>
      store.setCursor(ui.col, Math.min(virtualCount - 1, ui.row + 1)),
    );
  }
}

function handleTimelineZone(
  store: TuiStore,
  key: KeyEvent,
  openLater: (m: ModalKind) => void,
): void {
  const ui = store.state.ui;
  const entries = buildTimelineEntries(
    store.state.boards.map((b) => b.board),
    isoToday(),
  );
  const target = entries[ui.row];

  // Armed-block adjustments take priority over navigation. While a block
  // is armed, j/k nudge its start time and +/- nudge its end.
  const armedRef = ui.armedTimelineRef;
  const armed = armedRef
    ? entries.find(
        (e) =>
          e.ref.boardPath === armedRef.boardPath &&
          e.ref.columnIndex === armedRef.columnIndex &&
          e.ref.taskIndex === armedRef.taskIndex,
      )
    : undefined;

  if (armed) {
    const NUDGE = 15; // minutes
    if (key.name === "j" || key.name === "down") {
      const newStart = Math.min(24 * 60 - 1 - (armed.endMin - armed.startMin), armed.startMin + NUDGE);
      const newEnd = newStart + (armed.endMin - armed.startMin);
      store.setTimeBlock(armed.ref, { startMin: newStart, endMin: newEnd });
      store.flashBanner("info", `✋ ${fmtHm(newStart)}-${fmtHm(newEnd)}`);
      return;
    }
    if (key.name === "k" || key.name === "up") {
      const newStart = Math.max(0, armed.startMin - NUDGE);
      const newEnd = newStart + (armed.endMin - armed.startMin);
      store.setTimeBlock(armed.ref, { startMin: newStart, endMin: newEnd });
      store.flashBanner("info", `✋ ${fmtHm(newStart)}-${fmtHm(newEnd)}`);
      return;
    }
    if (key.name === "+" || key.name === "=" || key.sequence === "+") {
      const newEnd = Math.min(24 * 60 - 1, armed.endMin + NUDGE);
      store.setTimeBlock(armed.ref, { startMin: armed.startMin, endMin: newEnd });
      store.flashBanner("info", `↕ ${fmtHm(armed.startMin)}-${fmtHm(newEnd)}`);
      return;
    }
    if (key.name === "-" || key.name === "_" || key.sequence === "-") {
      const newEnd = Math.max(armed.startMin + 15, armed.endMin - NUDGE);
      store.setTimeBlock(armed.ref, { startMin: armed.startMin, endMin: newEnd });
      store.flashBanner("info", `↕ ${fmtHm(armed.startMin)}-${fmtHm(newEnd)}`);
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      // Commit + jump to kanban + disarm.
      store.armTimeline(undefined);
      jumpToKanban(store, armed.ref);
      return;
    }
    // Fall through for other keys (Esc handled globally, task actions below).
  }

  // Plain navigation (no armed block, or non-adjustment key while armed).
  if (key.name === "j" || key.name === "down") {
    store.setCursor(0, Math.min(entries.length - 1, ui.row + 1));
    return;
  }
  if (key.name === "k" || key.name === "up") {
    store.setCursor(0, Math.max(0, ui.row - 1));
    return;
  }
  if (key.name === "h" || key.name === "left") {
    store.setActiveZone("board");
    return;
  }
  // Enter on a timeline block bounces the kanban cursor to its source task.
  if ((key.name === "enter" || key.name === "return") && target) {
    jumpToKanban(store, target.ref);
    return;
  }

  // All other task actions operate on the timeline entry's task.
  if (target) {
    dispatchTaskAction(store, key, target.ref, openLater);
  }
}

function handleAgentsZone(store: TuiStore, key: KeyEvent): void {
  const ui = store.state.ui;
  const sessions = store.agents.sessions();
  if (key.name === "j" || key.name === "down") {
    store.setCursor(0, Math.min(sessions.length - 1, ui.row + 1));
  } else if (key.name === "k" || key.name === "up") {
    store.setCursor(0, Math.max(0, ui.row - 1));
  } else if (key.name === "enter" || key.name === "return") {
    // Open (resume) the selected session in a new WezTerm tab.
    const target = sessions[ui.row];
    if (target) void openSessionInWezterm(store, target.cwd, target.sessionId);
  } else if (key.name === "o") {
    // Inspect the session in the detail modal.
    const target = sessions[ui.row];
    if (target) {
      setTimeout(
        () => store.openModal({ kind: "agent-detail", sessionId: target.sessionId }),
        0,
      );
    }
  } else if (key.name === "h" || key.name === "left") {
    store.setActiveZone("board");
  }
}

/**
 * Find the next/previous *rendered* column index moving in `dir` (+1 right,
 * -1 left) from `fromCol`, skipping hidden columns (Done / Archive) that
 * BoardView never displays. Returns a `board.columns` index, or undefined
 * when there is no further visible column in that direction.
 */
function adjacentVisibleColumn(
  store: TuiStore,
  board: Board,
  fromCol: number,
  dir: 1 | -1,
): number | undefined {
  for (let i = fromCol + dir; i >= 0 && i < board.columns.length; i += dir) {
    const name = board.columns[i]?.name;
    if (name !== undefined && !isHiddenColumn(store.config, name)) return i;
  }
  return undefined;
}

function handleBoardZone(
  store: TuiStore,
  key: KeyEvent,
  openLater: (m: ModalKind) => void,
): void {
  const ui = store.state.ui;
  const board = store.state.boards[ui.activeBoardIndex]?.board;
  if (!board) return;
  const col = board.columns[ui.col];
  if (!col) return;

  const allTasks = col.children.filter(isTask);
  // Open tasks pass through the same filter the board view applies — so
  // the cursor row index always lines up with the rendered list, even
  // when `f` has narrowed it to today/overdue/etc.
  const openTasks = store.applyBoardFilter(allTasks.filter((t) => !t.done));
  // Visible task list mirrors what the column renders: in zoom mode the
  // user can navigate into done tasks too; otherwise only open.
  const visibleTasks = ui.zoomed
    ? [...openTasks, ...allTasks.filter((t) => t.done)]
    : openTasks;

  // Navigation
  if (key.name === "j" || key.name === "down") {
    store.setCursor(ui.col, Math.min(visibleTasks.length - 1, ui.row + 1));
    return;
  }
  if (key.name === "k" || key.name === "up") {
    store.setCursor(ui.col, Math.max(0, ui.row - 1));
    return;
  }
  // Cursor task (computed early so grab mode can use it for h/l moves).
  const cursorTaskForGrab = visibleTasks[ui.row];
  const cursorRefForGrab: TaskRef | undefined = cursorTaskForGrab
    ? {
        boardPath: board.filepath,
        columnIndex: ui.col,
        taskIndex: allTasks.indexOf(cursorTaskForGrab),
      }
    : undefined;

  // Grab mode: h/l physically MOVES the task to the adjacent column.
  // Cursor follows the moved task. Other navigation keys behave normally
  // (j/k still scrolls cursor within column; user releases grab with `g`
  // or Esc).
  if (ui.grabbing && cursorRefForGrab) {
    if (key.name === "h" || key.name === "left") {
      if (ui.col > 0) {
        const newRef = store.moveTaskWithinBoard(cursorRefForGrab, ui.col - 1, "top");
        if (newRef) {
          // Cursor goes to the moved task's new visible-row position in
          // the destination column.
          const destCol = board.columns[newRef.columnIndex];
          if (destCol) {
            const opens = store.applyBoardFilter(
              destCol.children.filter(isTask).filter((t) => !t.done),
            );
            const moved = destCol.children.filter(isTask)[newRef.taskIndex];
            const newRow = moved ? opens.indexOf(moved) : 0;
            store.setCursor(newRef.columnIndex, Math.max(0, newRow));
          }
        }
      }
      return;
    }
    if (key.name === "l" || key.name === "right") {
      if (ui.col < board.columns.length - 1) {
        const newRef = store.moveTaskWithinBoard(cursorRefForGrab, ui.col + 1, "top");
        if (newRef) {
          const destCol = board.columns[newRef.columnIndex];
          if (destCol) {
            const opens = store.applyBoardFilter(
              destCol.children.filter(isTask).filter((t) => !t.done),
            );
            const moved = destCol.children.filter(isTask)[newRef.taskIndex];
            const newRow = moved ? opens.indexOf(moved) : 0;
            store.setCursor(newRef.columnIndex, Math.max(0, newRow));
          }
        }
      }
      return;
    }
  }

  if (key.name === "h" || key.name === "left") {
    // Step left over rendered columns. Hidden columns (Done / Archive) are
    // never displayed, so navigating onto one would strand the cursor on an
    // unrendered, unscrollable column.
    const prev = adjacentVisibleColumn(store, board, ui.col, -1);
    if (prev === undefined) {
      store.setActiveZone("virtual");
    } else {
      store.setCursor(prev, 0);
    }
    return;
  }
  if (key.name === "l" || key.name === "right") {
    const next = adjacentVisibleColumn(store, board, ui.col, +1);
    if (next !== undefined) {
      store.setCursor(next, 0);
    }
    return;
  }

  // `g` toggles grab mode. Only meaningful in board zone with a task under
  // the cursor.
  if (key.name === "g") {
    if (ui.grabbing) {
      store.exitGrab();
      store.flashBanner("info", "Grab released");
    } else if (cursorRefForGrab) {
      store.toggleGrab();
      store.flashBanner("info", "Grabbed — h/l moves between columns, Esc to release");
    }
    return;
  }

  // `n` adds a new task in the current column — this needs a column context
  // which only the board zone has, so it lives outside dispatchTaskAction.
  if (key.name === "n") {
    openLater({ kind: "add", targetColumnIndex: ui.col });
    return;
  }

  // Task-level actions need a task under the cursor.
  const cursorTask = visibleTasks[ui.row];
  if (!cursorTask) return;
  const cursorRef: TaskRef = {
    boardPath: board.filepath,
    columnIndex: ui.col,
    taskIndex: allTasks.indexOf(cursorTask),
  };

  dispatchTaskAction(store, key, cursorRef, openLater, () =>
    store.setCursor(ui.col, Math.min(visibleTasks.length - 1, ui.row + 1)),
  );
}

// ─── Shared task-level action dispatcher ────────────────────────────────────

/**
 * Apply a task-level action to the given cursorRef. Used by every zone
 * (board / virtual / timeline) so the keys feel identical wherever the
 * cursor lives. Multi-select aware: when there are marked tasks, the
 * action operates on all of them via `applyToMarkedOr`.
 *
 * Returns true when the key was recognized as a task action (whether or
 * not it produced a visible change). Callers can ignore the return value
 * — this is mostly a contract for future composition.
 */
function dispatchTaskAction(
  store: TuiStore,
  key: KeyEvent,
  ref: TaskRef,
  openLater: (m: ModalKind) => void,
  advanceCursor?: () => void,
): boolean {
  // Toggle done (Enter). Only meaningful for board/virtual; timeline has
  // its own Enter behavior (jump to kanban) which is handled earlier.
  if (key.name === "enter" || key.name === "return") {
    const n = store.applyToMarkedOr(ref, (r) => store.toggleDone(r));
    if (n > 1) store.flashBanner("info", `Toggled done on ${n} tasks`);
    return true;
  }

  // Multi-select toggle. After marking, advance the cursor to the next task
  // so you can sweep a contiguous range with repeated Space presses (the
  // advance no-ops at the last row). Zone-specific, supplied by the caller.
  if (key.name === "space") {
    store.toggleMark(ref);
    advanceCursor?.();
    return true;
  }

  // Detail
  if (key.name === "o") {
    openLater({ kind: "detail", ref });
    return true;
  }

  // Quick set scheduled = today / tomorrow
  if (key.name === "t" && !key.shift) {
    const n = store.applyToMarkedOr(ref, (r) => store.setScheduled(r, isoToday()));
    if (n > 1) store.flashBanner("info", `${n} tasks → today`);
    return true;
  }
  if (key.name === "m") {
    const n = store.applyToMarkedOr(ref, (r) => store.setScheduled(r, isoTomorrow()));
    if (n > 1) store.flashBanner("info", `${n} tasks → tomorrow`);
    return true;
  }

  // Archive (Shift+X) — move to Archive column (creates it if absent).
  if (key.name === "x" && key.shift) {
    const n = store.applyToMarkedOr(ref, (r) => { store.archiveTask(r); });
    store.flashBanner("info", n > 1 ? `Archived ${n} tasks` : "Archived");
    return true;
  }

  // Copy task as a markdown line to the system clipboard (Shift+C). Mirrors
  // Python kanban `action_copy_context`. Single-task only. Moved to Shift+C so
  // lowercase `c` is free for calendar arm mode (below); Ctrl+C can't be used
  // (it quits / is terminal-reserved), so Shift+C is the copy combo.
  if (key.name === "C" || (key.name === "c" && key.shift)) {
    const t = store.getTask(ref);
    if (t) {
      copyToClipboard(t.rawLine).then(
        () => store.flashBanner("info", "📋 Copied task"),
        (err) => store.flashBanner("error", `Copy failed: ${err}`),
      );
    }
    return true;
  }

  // Calendar arm mode (lowercase c): toggle a persistent mode for batch
  // scheduling onto the timeline. Entering also arms the cursor task and
  // focuses the timeline so you can immediately click a slot. While the mode
  // is on, clicking ANY task (board / virtual) arms it — click a task, click a
  // slot, repeat. `c` again or `Esc` exits. Works from any zone.
  if (key.name === "c" && !key.shift) {
    if (store.state.ui.armMode) {
      store.setArmMode(false);
      store.armTimeline(undefined);
      store.flashBanner("info", "Arm mode off");
      return true;
    }
    store.setArmMode(true);
    store.armTimeline(ref);
    store.setZoneVisible("timeline", true);
    store.setActiveZone("timeline");
    const t = store.getTask(ref);
    store.flashBanner(
      "info",
      t
        ? `◉ Arm mode — armed "${t.displayTitle.slice(0, 28)}". Click a task, then a slot. Esc to exit.`
        : "◉ Arm mode — click a task, then a slot. Esc to exit.",
    );
    return true;
  }

  // Toggle priority — cycle: none → highest → high → medium → low → lowest → none.
  // Mirrors Python kanban `action_toggle_priority`.
  if (key.name === "p") {
    const n = store.applyToMarkedOr(ref, (r) => {
      const t = store.getTask(r);
      if (!t) return;
      store.setPriority(r, nextPriority(t.priority));
    });
    if (n > 1) store.flashBanner("info", `Priority cycled on ${n} tasks`);
    return true;
  }

  // Schedule now: time block at the next 15-min slot, 30min default duration.
  // Mirrors Python kanban `action_schedule_now`. Also forces scheduled=today
  // since a time block without a date is meaningless to Day Planner.
  if (key.name === "." || key.sequence === ".") {
    const { startMin, endMin } = nextNowBlock();
    const n = store.applyToMarkedOr(ref, (r) => {
      store.setScheduled(r, isoToday());
      store.setTimeBlock(r, { startMin, endMin });
    });
    const label = `${fmtHm(startMin)}-${fmtHm(endMin)}`;
    store.flashBanner("info", n > 1 ? `${n} tasks ⌚${label}` : `⌚${label}`);
    return true;
  }

  // Modals
  if (key.name === "e") {
    openLater({ kind: "edit", ref });
    return true;
  }
  if (key.name === "s") {
    openLater({ kind: "schedule", ref });
    return true;
  }
  if (key.name === "b") {
    openLater({ kind: "timeblock", ref });
    return true;
  }
  if (key.name === "a") {
    openLater({ kind: "assign", ref });
    return true;
  }
  if (key.name === "d") {
    openLater({ kind: "confirm-delete", ref });
    return true;
  }

  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_CYCLE: PriorityLevel[] = [
  "none",
  "highest",
  "high",
  "medium",
  "low",
  "lowest",
];

function nextPriority(p: PriorityLevel): PriorityLevel {
  const i = PRIORITY_CYCLE.indexOf(p);
  if (i < 0) return "highest";
  return PRIORITY_CYCLE[(i + 1) % PRIORITY_CYCLE.length]!;
}

/**
 * Round the current minute up to the nearest 15-minute slot, return a
 * 30-minute time block starting there.
 *
 *   12:03 → 12:15-12:45
 *   12:14 → 12:15-12:45
 *   12:16 → 12:30-13:00
 */
function nextNowBlock(): { startMin: number; endMin: number } {
  const d = new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  const slot = Math.ceil(minutes / 15) * 15;
  return { startMin: slot, endMin: Math.min(slot + 30, 24 * 60 - 1) };
}

function fmtHm(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

/**
 * Open (resume) a Claude Code session in a new WezTerm tab.
 *
 * Two steps:
 *   1. `wezterm cli spawn --cwd <cwd>` opens a new tab running your DEFAULT
 *      shell in the session's directory (prints the new pane id).
 *   2. `wezterm cli send-text` types `claude --resume <id>` + Enter into it.
 *
 * Running it through the interactive shell (rather than `spawn -- claude …`
 * directly) means `claude` gets your full shell environment — PATH, env vars,
 * any wrapper — which is why the direct form exited 1. And if `claude` still
 * errors, you're left at a live prompt that shows it instead of a vanishing
 * tab. Failures (not inside WezTerm, `wezterm` off PATH) surface as a banner.
 */
async function openSessionInWezterm(
  store: TuiStore,
  cwd: string,
  sessionId: string,
): Promise<void> {
  const { spawn, spawnSync } = await import("node:child_process");

  // Custom override (config `resume_command`): an argv array with {cwd} /
  // {sessionId} placeholders, spawned directly (no shell). Lets you launch a
  // personal terminal layout without baking it into the distributed tool.
  const custom = store.config.resumeCommand;
  if (custom && custom.length > 0) {
    const argv = custom.map((arg) =>
      arg.replaceAll("{cwd}", cwd).replaceAll("{sessionId}", sessionId),
    );
    const [cmd, ...rest] = argv;
    try {
      // windowsHide suppresses the transient console window the orchestrator
      // process would otherwise flash on Windows (the equivalent of Python's
      // CREATE_NO_WINDOW).
      const child = spawn(cmd!, rest, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (e: NodeJS.ErrnoException) =>
        store.flashBanner("error", `resume_command failed: ${e.message}`),
      );
      child.unref();
      store.flashBanner("info", `↗ Opening session (${sessionId.slice(0, 8)})`);
    } catch (e) {
      store.flashBanner("error", `resume_command failed: ${String(e)}`);
    }
    return;
  }

  try {
    const spawned = spawnSync("wezterm", ["cli", "spawn", "--cwd", cwd], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (spawned.error) {
      store.flashBanner("error", `WezTerm launch failed: ${spawned.error.message}`);
      return;
    }
    if (spawned.status !== 0) {
      store.flashBanner(
        "error",
        `WezTerm spawn failed: ${(spawned.stderr || "").trim() || `exit ${spawned.status}`}`,
      );
      return;
    }
    const paneId = spawned.stdout.trim();
    // Type the resume command into the fresh pane (\r submits, like Enter).
    spawnSync(
      "wezterm",
      ["cli", "send-text", "--pane-id", paneId, "--no-paste"],
      { input: `claude --resume ${sessionId}\r`, encoding: "utf8", windowsHide: true },
    );
    store.flashBanner("info", `↗ Opened session in WezTerm (${sessionId.slice(0, 8)})`);
  } catch (e) {
    store.flashBanner("error", `WezTerm launch failed: ${String(e)}`);
  }
}

/**
 * Cross-platform clipboard copy. Picks the host's native cli tool:
 *   Windows  → clip
 *   macOS    → pbcopy
 *   Linux    → wl-copy (Wayland) with xclip fallback (X11)
 *
 * Returns a Promise that resolves on success and rejects with the stderr
 * output of the failing command. We swallow ENOENT (tool not installed) and
 * surface the same banner message either way.
 */
async function copyToClipboard(text: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  const candidates: Array<{ cmd: string; args: string[] }> =
    platform === "win32"
      ? [{ cmd: "clip", args: [] }]
      : platform === "darwin"
        ? [{ cmd: "pbcopy", args: [] }]
        : [
            { cmd: "wl-copy", args: [] },
            { cmd: "xclip", args: ["-selection", "clipboard"] },
            { cmd: "xsel", args: ["--clipboard", "--input"] },
          ];

  let lastError: string = "no clipboard tool found";
  for (const { cmd, args } of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (e: NodeJS.ErrnoException) => reject(e.message));
        child.on("close", (code: number) => {
          if (code === 0) resolve();
          else reject(stderr || `${cmd} exited ${code}`);
        });
        child.stdin?.write(text);
        child.stdin?.end();
      });
      return; // Success — done.
    } catch (e) {
      lastError = String(e);
      // Try next candidate.
    }
  }
  throw new Error(lastError);
}
