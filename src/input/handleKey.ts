/**
 * Centralized keyboard input handler. Dispatches based on:
 *   1. modal state (modal eats most keys)
 *   2. global keys (quit, help, undo, board switch, escape)
 *   3. active zone (virtual / board)
 *
 * Extracted from app.tsx so every root view (Dashboard, BoardOnly, etc.)
 * shares the same input contract.
 */

import { isTask } from "~/parser/markdown";
import {
  isoToday,
  isoTomorrow,
  type TaskRef,
  type TuiStore,
} from "~/store/index";
import { buildVirtualItems } from "~/store/virtual-panel";

export function handleKey(
  store: TuiStore,
  key: { name: string; ctrl?: boolean; shift?: boolean; sequence?: string },
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
        const ref = ui.modal.ref;
        store.deleteTask(ref);
        store.closeModal();
      } else if (key.name === "n") {
        store.closeModal();
      }
      return;
    }
    if ((ui.modal.kind === "help" || ui.modal.kind === "detail") &&
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

  // Escape clears marks when nothing else handles it.
  if (key.name === "escape") {
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

  // Bulk: reset all overdue across all boards → today (Shift+T).
  // We rely on `key.shift` being set so plain `t` still works as
  // "set today on cursor/marked".
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

  // Navigation
  if (ui.activeZone === "virtual") {
    if (key.name === "j" || key.name === "down") {
      store.setCursor(ui.col, Math.min(virtualCount - 1, ui.row + 1));
    } else if (key.name === "k" || key.name === "up") {
      store.setCursor(ui.col, Math.max(0, ui.row - 1));
    } else if (key.name === "l" || key.name === "right") {
      // jump out into the board's column 0
      store.setActiveZone("board");
    } else if (key.name === "enter" || key.name === "return") {
      // Toggle done on the virtual cursor's target (cross-board).
      const items = buildVirtualItems(
        store.state.boards.map((b) => b.board),
      );
      const target = items[ui.row];
      if (target) store.toggleDone(target.ref);
    }
    return;
  }

  // Inside a board
  if (!board) return;
  const col = board.columns[ui.col];
  if (!col) return;

  const allTasks = col.children.filter(isTask);
  const openTasks = allTasks.filter((t) => !t.done);
  // Visible task list mirrors what the column renders: in zoom mode the
  // user can navigate into done tasks too; otherwise only open.
  const visibleTasks = ui.zoomed
    ? [...openTasks, ...allTasks.filter((t) => t.done)]
    : openTasks;

  if (key.name === "j" || key.name === "down") {
    store.setCursor(ui.col, Math.min(visibleTasks.length - 1, ui.row + 1));
    return;
  }
  if (key.name === "k" || key.name === "up") {
    store.setCursor(ui.col, Math.max(0, ui.row - 1));
    return;
  }
  if (key.name === "h" || key.name === "left") {
    if (ui.col === 0) {
      store.setActiveZone("virtual");
    } else {
      store.setCursor(ui.col - 1, 0);
    }
    return;
  }
  if (key.name === "l" || key.name === "right") {
    if (ui.col < board.columns.length - 1) {
      store.setCursor(ui.col + 1, 0);
    }
    return;
  }

  // Task-level actions need a task under the cursor.
  const cursorTask = visibleTasks[ui.row];
  const cursorRef: TaskRef | undefined = cursorTask
    ? {
        boardPath: board.filepath,
        columnIndex: ui.col,
        taskIndex: allTasks.indexOf(cursorTask),
      }
    : undefined;

  // Defer modal opens by one macrotask so the OpenTUI <input> mounts after
  // the current key event has been fully dispatched.
  const openLater = (m: Parameters<typeof store.openModal>[0]) => {
    setTimeout(() => store.openModal(m), 0);
  };

  if (key.name === "enter" || key.name === "return") {
    if (cursorRef) {
      const n = store.applyToMarkedOr(cursorRef, (r) => store.toggleDone(r));
      if (n > 1) store.flashBanner("info", `Toggled done on ${n} tasks`);
    }
    return;
  }

  // Multi-select toggle
  if (key.name === "space" && cursorRef) {
    store.toggleMark(cursorRef);
    return;
  }

  // Detail
  if (key.name === "o" && cursorRef) {
    openLater({ kind: "detail", ref: cursorRef });
    return;
  }

  // Quick set scheduled = today / tomorrow on cursor or all marked
  if (key.name === "t" && !key.shift) {
    if (cursorRef) {
      const n = store.applyToMarkedOr(cursorRef, (r) => store.setScheduled(r, isoToday()));
      if (n > 1) store.flashBanner("info", `${n} tasks → today`);
    }
    return;
  }
  if (key.name === "m") {
    if (cursorRef) {
      const n = store.applyToMarkedOr(cursorRef, (r) => store.setScheduled(r, isoTomorrow()));
      if (n > 1) store.flashBanner("info", `${n} tasks → tomorrow`);
    }
    return;
  }

  // Archive (Shift+X) — move to Archive column (creates it if absent).
  if (key.name === "x" && key.shift) {
    if (cursorRef) {
      const n = store.applyToMarkedOr(cursorRef, (r) => { store.archiveTask(r); });
      store.flashBanner("info", n > 1 ? `Archived ${n} tasks` : "Archived");
    }
    return;
  }

  // Modals
  if (key.name === "n") {
    openLater({ kind: "add", targetColumnIndex: ui.col });
    return;
  }
  if (key.name === "e" && cursorRef) {
    openLater({ kind: "edit", ref: cursorRef });
    return;
  }
  if (key.name === "s" && cursorRef) {
    openLater({ kind: "schedule", ref: cursorRef });
    return;
  }
  if (key.name === "b" && cursorRef) {
    openLater({ kind: "timeblock", ref: cursorRef });
    return;
  }
  if (key.name === "a" && cursorRef) {
    openLater({ kind: "assign", ref: cursorRef });
    return;
  }
  if (key.name === "d" && cursorRef) {
    openLater({ kind: "confirm-delete", ref: cursorRef });
    return;
  }
}
