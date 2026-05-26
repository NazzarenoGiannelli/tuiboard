/**
 * tuiboard — main app.
 *
 * Composes: cross-board virtual panel (left) + active board view (right).
 * Reactive store drives all rendering; keyboard input mutates the store;
 * mutations write back to disk via the atomic writer.
 */

import { Show, createMemo } from "solid-js";
import { render, useKeyboard } from "@opentui/solid";

import { loadConfig } from "~/config/loader";
import { isTask } from "~/parser/markdown";
import {
  createTuiStore,
  isoToday,
  type TaskRef,
  type TuiStore,
} from "~/store/index";
import {
  buildVirtualItems,
} from "~/store/virtual-panel";
import { ATTR, T } from "~/ui/glyphs";
import { BoardView } from "~/ui/BoardView";
import { ModalLayer } from "~/ui/Modal";
import { VirtualPanel } from "~/ui/VirtualPanel";

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const config = loadConfig();
if (config.boards.length === 0) {
  console.error(
    "No boards found. Create `.tuiboard/config.yaml` with a `boards:` list," +
      " or run from a directory containing markdown files with `- [ ]` tasks.",
  );
  process.exit(1);
}

const store = createTuiStore({ config });

if (store.state.boards.length === 0) {
  console.error("All boards failed to load. Check paths in .tuiboard/config.yaml.");
  process.exit(1);
}

process.on("SIGINT", () => {
  store.dispose().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  store.dispose().finally(() => process.exit(0));
});

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
  const ui = () => store.state.ui;
  const activeBoard = createMemo(() => store.state.boards[ui().activeBoardIndex]?.board);

  // Recompute virtual items count so we can clamp the cursor on row changes.
  const virtualItems = createMemo(() =>
    buildVirtualItems(store.state.boards.map((b) => b.board)),
  );

  useKeyboard((key) => handleKey(store, key, virtualItems().length));

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        padding: 1,
      }}
    >
      <TopBar store={store} />
      <box style={{ height: 1 }} />

      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <VirtualPanel store={store} />
        <Show when={activeBoard()}>
          <BoardView store={store} board={activeBoard()!} />
        </Show>
      </box>

      <ModalLayer store={store} />
      <BottomBar store={store} />
    </box>
  );
}

function TopBar(props: { store: TuiStore }) {
  const boards = () => props.store.state.boards;
  const active = () => props.store.state.ui.activeBoardIndex;
  return (
    <text>
      <span style={{ fg: T.accent, attributes: ATTR.bold }}>tuiboard</span>
      <span style={{ fg: T.textDim }}>{"  "}{isoToday()}</span>
      <span style={{ fg: T.textDim }}>
        {"  ·  "}
        {boards().map((b: { board: { name: string } }, i: number) =>
          i === active()
            ? `[${i + 1}: ${b.board.name}]`
            : ` ${i + 1}: ${b.board.name} `,
        ).join("")}
      </span>
    </text>
  );
}

function BottomBar(props: { store: TuiStore }) {
  const banner = () => props.store.state.ui.banner;
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <Show
          when={banner()}
          fallback={
            <text>
              <span style={{ fg: T.textDim }}>{" "}</span>
            </text>
          }
        >
          {(b: () => NonNullable<ReturnType<typeof banner>>) => (
            <text>
              <span
                style={{
                  fg:
                    b().kind === "error"
                      ? T.bannerError
                      : b().kind === "warn"
                        ? T.bannerWarn
                        : T.bannerInfo,
                }}
              >
                {"⚑ "}{b().text}
              </span>
            </text>
          )}
        </Show>
      </box>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text>
          <span style={{ fg: T.textDim }}>
            {"hjkl move · Tab/1-9 board · v panel · Enter done · n new · e edit · s sched · b time · a assign · d del · z exp · ? help · ⌃Z undo · q quit"}
          </span>
        </text>
      </box>
    </box>
  );
}

// ─── Keyboard ───────────────────────────────────────────────────────────────

function handleKey(
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
    // Confirm-delete uses single-key shortcuts (y/n) instead of <input>.
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
    if (ui.modal.kind === "help" && (key.name === "?" || key.sequence === "?")) {
      store.closeModal();
      return;
    }
    // Other modals: the <input> consumes typing; we don't intercept here.
    return;
  }

  // Quit
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    store.dispose().finally(() => process.exit(0));
    return;
  }

  // Help
  if (key.name === "?" || key.sequence === "?") {
    store.openModal({ kind: "help" });
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
    store.setInVirtual(!ui.inVirtual);
    return;
  }

  // Undo
  if (key.ctrl && key.name === "z") {
    store.undo();
    return;
  }

  // Toggle done counter expand
  if (key.name === "z") {
    if (!ui.inVirtual && board) {
      const col = board.columns[ui.col];
      if (col) store.toggleDoneExpanded(board.filepath, col.name);
    }
    return;
  }

  // Navigation
  if (ui.inVirtual) {
    if (key.name === "j" || key.name === "down") {
      store.setCursor(ui.col, Math.min(virtualCount - 1, ui.row + 1));
    } else if (key.name === "k" || key.name === "up") {
      store.setCursor(ui.col, Math.max(0, ui.row - 1));
    } else if (key.name === "l" || key.name === "right") {
      // jump out into the board's column 0
      store.setInVirtual(false);
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
  const doneExpanded = store.isDoneExpanded(board.filepath, col.name);
  const visibleTasks = doneExpanded ? allTasks : openTasks;

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
      store.setInVirtual(true);
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

  if (key.name === "enter" || key.name === "return") {
    if (cursorRef) store.toggleDone(cursorRef);
    return;
  }

  // Defer modal opens by one macrotask so the OpenTUI <input> mounts after
  // the current key event has been fully dispatched. Without this, the
  // trigger letter (n/e/s/b/a/d) ends up auto-typed into the new input field.
  const openLater = (m: Parameters<typeof store.openModal>[0]) => {
    setTimeout(() => store.openModal(m), 0);
  };

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

// ─── Mount ──────────────────────────────────────────────────────────────────

await render(() => <App />);
