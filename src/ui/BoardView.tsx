/**
 * Kanban board view — horizontal scrolling row of full-height columns.
 *
 * Mirrors the Today/Tomorrow virtual panel: each column has a fixed width
 * and stretches vertically to fill the board area. Columns that don't fit
 * the available horizontal space are reached via horizontal scroll. Zoom
 * mode collapses everything down to the single active column at full
 * board width.
 */

import { For, Show, createEffect, createMemo } from "solid-js";

import { isTask } from "~/parser/markdown";
import { computeColumnScrollLeft } from "~/ui/board-scroll";
import { T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import type { TuiStore } from "~/store/index";
import type { Board, Column } from "~/types";

// Minimal structural typing for the scrollbox ref so we don't depend on
// importing OpenTUI's internal Renderable types just to call its methods.
interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/**
 * Horizontal scrollbox: we drive `scrollLeft` directly from known column
 * geometry rather than `scrollChildIntoView`, which relies on per-child
 * layout being measured at call time (unreliable for fully off-screen
 * columns). `viewport.width` is the visible width; `scrollLeft` is r/w.
 */
interface HScrollBoxLike {
  scrollLeft: number;
  readonly viewport: { width: number };
}

/** Fixed column width when not zoomed. Single source of truth for layout. */
const COL_WIDTH = 42;
/** Horizontal gap between adjacent columns. */
const COL_GAP = 1;

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
  let scrollBoxRef: (ScrollBoxLike & Partial<HScrollBoxLike>) | undefined;

  /**
   * Columns shown in the view — Archive is filtered out entirely
   * (Python kanban convention: archived tasks are never displayed).
   * The Archive column still exists in the model so tasks can be moved
   * into it; we just don't render it.
   */
  const visibleColumns = createMemo(() =>
    props.board.columns.filter((c) => c.name !== archiveName()),
  );

  // Auto-scroll horizontally so the active column is always fully visible.
  // We compute the target scrollLeft from the fixed column geometry
  // (COL_WIDTH + COL_GAP) and the active column's position within the
  // *rendered* (non-archive) column list. Driving scrollLeft directly is
  // deterministic — unlike scrollChildIntoView it doesn't depend on each
  // column's measured layout being current, which failed for columns that
  // start fully off-screen.
  createEffect(() => {
    const colIdx = ui().col;
    if (ui().activeZone === "virtual" || ui().zoomed || !scrollBoxRef) return;
    // Map the board-columns index (what ui.col carries, used for task refs)
    // to the index within the rendered, non-archive list the scrollbox lays
    // out. They diverge once the Archive column is skipped.
    const cols = props.board.columns;
    const visibleIndex = visibleColumns().findIndex(
      (c) => cols.indexOf(c) === colIdx,
    );
    if (visibleIndex < 0) return;
    // setTimeout(0) — full event-loop tick — lets OpenTUI commit the current
    // layout (so viewport.width is correct) before we read + set scrollLeft.
    setTimeout(() => {
      const box = scrollBoxRef;
      if (!box || box.viewport === undefined) return;
      try {
        box.scrollLeft = computeColumnScrollLeft({
          visibleIndex,
          colWidth: COL_WIDTH,
          colGap: COL_GAP,
          viewportWidth: box.viewport.width,
          currentScroll: box.scrollLeft ?? 0,
        });
      } catch {
        // Scrollbox not mounted yet on first paint — harmless.
      }
    }, 0);
  });

  /**
   * In zoom mode we render only the column under the cursor, expanded
   * to fill the board area. This is the "focus on one column" mode
   * (Python kanban `z`).
   */
  const renderedColumns = createMemo(() => {
    if (!ui().zoomed || ui().activeZone === "virtual") return visibleColumns();
    const cols = visibleColumns();
    // ui.col is a board.columns index (carries Archive); map it to the
    // rendered list so zoom focuses the column actually under the cursor.
    const boardCols = props.board.columns;
    const visibleIndex = cols.findIndex(
      (c) => boardCols.indexOf(c) === ui().col,
    );
    const idx = visibleIndex >= 0 ? visibleIndex : Math.min(ui().col, cols.length - 1);
    return idx >= 0 ? [cols[idx]!] : cols;
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <scrollbox
        ref={(r: ScrollBoxLike & Partial<HScrollBoxLike>) =>
          (scrollBoxRef = r)
        }
        style={{
          width: "100%",
          flexGrow: 1,
          scrollX: true,
          scrollY: false,
          rootOptions: {},
          contentOptions: {
            flexDirection: "row",
            // alignItems defaults to "stretch" in Yoga, which is exactly
            // what we want: every column auto-fills the row's height,
            // matching the Today/Tomorrow virtual panel.
          },
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={renderedColumns()}>
          {(col) => {
            const originalIndex = props.board.columns.indexOf(col);
            const isActive = () =>
              ui().activeZone === "board" && ui().col === originalIndex;
            return (
              <ColumnView
                store={props.store}
                board={props.board}
                column={col}
                columnIndex={originalIndex}
                active={isActive()}
                zoomed={ui().zoomed && isActive()}
                boxId={columnId(props.board.filepath, originalIndex)}
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
}

/** Stable id for a task row inside a column, used by scrollChildIntoView. */
function taskRowId(boardPath: string, colIdx: number, rowIdx: number): string {
  return `tuiboard-task-${boardPath.replace(/[^a-zA-Z0-9]/g, "_")}-${colIdx}-${rowIdx}`;
}

function ColumnView(props: ColumnViewProps) {
  const allTasks = createMemo(() => props.column.children.filter(isTask));
  const openTasks = createMemo(() =>
    props.store.applyBoardFilter(allTasks().filter((t) => !t.done)),
  );
  const doneTasks = createMemo(() => allTasks().filter((t) => t.done));

  // In zoom mode, show open tasks first, then a divider, then done tasks.
  // In normal mode, show only open tasks; done collapse to a counter.
  const visibleTasks = createMemo(() => {
    if (props.zoomed) return [...openTasks(), ...doneTasks()];
    return openTasks();
  });

  const cursorRow = createMemo(() => props.store.state.ui.row);

  // Auto-scroll the column's inner scrollbox so the cursor row is always in
  // view. Without this, OpenTUI's scrollbox didn't know to follow the
  // cursor — user reported pressing arrow down and seeing the cursor stuck
  // until the visible window happened to catch up. setTimeout(0) waits for
  // OpenTUI to commit layout before the scroll, same pattern as BoardView's
  // column auto-scroll and TimelineView's now-line auto-scroll.
  let innerScrollBoxRef: ScrollBoxLike | undefined;
  createEffect(() => {
    if (!props.active) return;
    const row = cursorRow();
    if (!innerScrollBoxRef) return;
    setTimeout(() => {
      try {
        innerScrollBoxRef?.scrollChildIntoView(
          taskRowId(props.board.filepath, props.columnIndex, row),
        );
      } catch {
        // Child not mounted yet — harmless.
      }
    }, 0);
  });

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
        // Fixed width when not zoomed; the zoomed column grows to fill
        // whatever horizontal space the board zone has been given.
        width: props.zoomed ? undefined : COL_WIDTH,
        minWidth: props.zoomed ? undefined : COL_WIDTH,
        flexGrow: props.zoomed ? 1 : 0,
        flexShrink: 0,
        // No explicit height — Yoga stretches us along the row's cross
        // axis, so the column always fills the full board height. Same
        // contract as the Today/Tomorrow virtual panel next door.
        marginRight: COL_GAP,
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
        ref={(r: ScrollBoxLike) => (innerScrollBoxRef = r)}
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
              <box id={taskRowId(props.board.filepath, props.columnIndex, ri())}>
                <TaskRow
                  task={task}
                  cursor={props.active && ri() === cursorRow()}
                  marked={props.store.isMarked(ref)}
                  grabbed={
                    props.active &&
                    ri() === cursorRow() &&
                    props.store.state.ui.grabbing
                  }
                  // Column inner cell width for a TaskRow: COL_WIDTH 42 −
                  // border 2 − col padding 2 − TaskRow padding 2 = 36 cols
                  // (when not zoomed). Zoomed → column grows to fill, so
                  // ~terminal width − some chrome.
                  availableWidth={props.zoomed ? 100 : 36}
                  onClick={() => {
                    props.store.setActiveZone("board");
                    props.store.setCursor(props.columnIndex, ri());
                  }}
                />
              </box>
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
