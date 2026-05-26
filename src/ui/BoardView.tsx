/** Kanban board view — masonry-style flex-wrap layout with zoom mode. */

import { For, Show, createEffect, createMemo } from "solid-js";

import { isTask } from "~/parser/markdown";
import { T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import type { TuiStore } from "~/store/index";
import type { Board, Column } from "~/types";

// Minimal structural typing for the scrollbox ref so we don't depend on
// importing OpenTUI's internal Renderable types just to call one method.
interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/** Fixed column dimensions used to lay out the masonry. */
const COL_WIDTH = 42;
/** Gap between columns (also between rows when wrapped). */
const COL_GAP = 1;
/** Min usable column height (avoid postage-stamp columns on tiny terminals). */
const MIN_COL_HEIGHT = 10;

interface BoardViewProps {
  store: TuiStore;
  board: Board;
}

/** Stable id for the column box at original board index `idx`. */
function columnId(boardPath: string, idx: number): string {
  // boardPath is encoded so cross-board column ids don't collide if we
  // ever render multiple boards side-by-side in the future.
  return `tuiboard-col-${boardPath.replace(/[^a-zA-Z0-9]/g, "_")}-${idx}`;
}

export function BoardView(props: BoardViewProps) {
  const ui = () => props.store.state.ui;
  const archiveName = () => props.store.config.archiveColumn;
  let scrollBoxRef: ScrollBoxLike | undefined;

  // Fixed masonry row height — half of a typical 50-row terminal. Two
  // visible rows of columns at once, anything beyond that scrolls
  // vertically. (TODO: react to live terminal dimensions once the
  // useTerminalDimensions integration stops crashing the renderer.)
  const colHeight = createMemo(() => 24);

  // Auto-scroll the masonry so the active column is always visible. Now
  // the scroll is vertical (because we wrap rows) — scrollChildIntoView
  // handles both axes automatically based on where the child sits.
  createEffect(() => {
    const colIdx = ui().col;
    if (ui().inVirtual || ui().zoomed || !scrollBoxRef) return;
    // setTimeout(0) — full event-loop tick — is the only timing that
    // reliably waits for OpenTUI to recompute child layout before
    // requesting a scroll. queueMicrotask was too eager.
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(columnId(props.board.filepath, colIdx));
      } catch {
        // Child not mounted yet on first paint — harmless.
      }
    }, 0);
  });

  /**
   * Columns shown in the view — Archive is filtered out entirely
   * (Python kanban convention: archived tasks are never displayed).
   * The Archive column still exists in the model so tasks can be moved
   * into it; we just don't render it.
   */
  const visibleColumns = createMemo(() =>
    props.board.columns.filter((c) => c.name !== archiveName()),
  );

  /**
   * In zoom mode we render only the column under the cursor, expanded
   * to fill the board area. This is the "focus on one column" mode
   * (Python kanban `z`).
   */
  const renderedColumns = createMemo(() => {
    if (!ui().zoomed || ui().inVirtual) return visibleColumns();
    const cols = visibleColumns();
    const idx = Math.min(ui().col, cols.length - 1);
    return idx >= 0 ? [cols[idx]!] : cols;
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <scrollbox
        ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
        style={{
          width: "100%",
          flexGrow: 1,
          scrollX: false,
          scrollY: true,
          rootOptions: {},
          contentOptions: {
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "flex-start",
          },
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={renderedColumns()}>
          {(col) => {
            const originalIndex = props.board.columns.indexOf(col);
            const isActive = () =>
              !ui().inVirtual && ui().col === originalIndex;
            return (
              <ColumnView
                store={props.store}
                board={props.board}
                column={col}
                columnIndex={originalIndex}
                active={isActive()}
                zoomed={ui().zoomed && isActive()}
                boxId={columnId(props.board.filepath, originalIndex)}
                height={ui().zoomed ? undefined : colHeight()}
              />
            );
          }}
        </For>
      </scrollbox>
    </box>
  );
}

interface ColumnViewProps {
  store: TuiStore;
  board: Board;
  column: Column;
  columnIndex: number;
  active: boolean;
  /**
   * When true, the column was zoomed to full width — done tasks are
   * shown inline because the user has explicitly focused this column.
   */
  zoomed: boolean;
  /** Stable DOM-equivalent id used by `scrollChildIntoView`. */
  boxId: string;
  /**
   * Explicit row height for masonry layout. Undefined when zoomed (the
   * single zoomed column should fill all available vertical space).
   */
  height?: number;
}

function ColumnView(props: ColumnViewProps) {
  const allTasks = createMemo(() => props.column.children.filter(isTask));
  const openTasks = createMemo(() => allTasks().filter((t) => !t.done));
  const doneTasks = createMemo(() => allTasks().filter((t) => t.done));

  // In zoom mode, show open tasks first, then a divider, then done tasks.
  // In normal mode, show only open tasks; done collapse to a counter.
  const visibleTasks = createMemo(() => {
    if (props.zoomed) return [...openTasks(), ...doneTasks()];
    return openTasks();
  });

  const cursorRow = createMemo(() => props.store.state.ui.row);

  const titleText = () => {
    const zoomMark = props.zoomed ? "⤢ " : "";
    let s = `┤ ${zoomMark}${props.column.name}  ${openTasks().length}`;
    if (doneTasks().length > 0) s += ` ✓${doneTasks().length}`;
    return s + " ├";
  };

  return (
    <box
      id={props.boxId}
      style={{
        flexDirection: "column",
        width: props.zoomed ? undefined : COL_WIDTH,
        minWidth: props.zoomed ? undefined : COL_WIDTH,
        flexGrow: props.zoomed ? 1 : 0,
        // Explicit height needed inside a flex-wrap container — otherwise
        // children with flexGrow would inflate the column infinitely.
        height: props.zoomed ? undefined : props.height,
        marginRight: COL_GAP,
        marginBottom: COL_GAP,
        border: true,
        borderStyle: "rounded",
        borderColor: props.active ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={titleText()}
      titleAlignment="left"
    >
      <scrollbox
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={visibleTasks()}>
          {(task, ri) => {
            const ref = {
              boardPath: props.board.filepath,
              columnIndex: props.columnIndex,
              taskIndex: allTasks().indexOf(task),
            };
            return (
              <TaskRow
                task={task}
                cursor={props.active && ri() === cursorRow()}
                marked={props.store.isMarked(ref)}
                titleMaxChars={props.zoomed ? 68 : 28}
                onClick={() => {
                  props.store.setInVirtual(false);
                  props.store.setCursor(props.columnIndex, ri());
                }}
              />
            );
          }}
        </For>

        <Show when={!props.zoomed && doneTasks().length > 0}>
          <box
            style={{
              flexDirection: "row",
              marginTop: 1,
            }}
          >
            <text wrapMode="none" truncate>
              <span style={{ fg: T.textDim }}>
                {"✓ "}{doneTasks().length}{" done  (z to focus)"}
              </span>
            </text>
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}
