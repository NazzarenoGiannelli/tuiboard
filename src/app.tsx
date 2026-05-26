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
    <box style={{ flexDirection: "column" }}>
      <Show when={banner()}>
        {(b) => (
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
      <text>
        <span style={{ fg: T.textDim }}>
          {"hjkl/arrows: move · Tab/1-9: board · Enter: toggle done · z: expand done · v ↔ panel · Ctrl-Z: undo · q: quit"}
        </span>
      </text>
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

  // Quit
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    store.dispose().finally(() => process.exit(0));
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

  if (key.name === "enter" || key.name === "return") {
    const task = visibleTasks[ui.row];
    if (!task) return;
    // We need the task index *within all Task children*, not the visible list.
    const taskIndex = allTasks.indexOf(task);
    const ref: TaskRef = {
      boardPath: board.filepath,
      columnIndex: ui.col,
      taskIndex,
    };
    store.toggleDone(ref);
    return;
  }
}

// ─── Mount ──────────────────────────────────────────────────────────────────

await render(() => <App />);
