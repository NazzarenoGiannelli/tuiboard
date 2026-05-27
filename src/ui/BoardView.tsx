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
import { T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import type { TuiStore } from "~/store/index";
import type { Board, Column } from "~/types";

// Minimal structural typing for the scrollbox ref so we don't depend on
// importing OpenTUI's internal Renderable types just to call one method.
interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
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
  let scrollBoxRef: ScrollBoxLike | undefined;

  // Auto-scroll horizontally so the active column is always visible.
  // scrollChildIntoView handles the axis automatically based on the
  // scroll direction declared on the scrollbox.
  createEffect(() => {
    const colIdx = ui().col;
    if (ui().activeZone === "virtual" || ui().zoomed || !scrollBoxRef) return;
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
    if (!ui().zoomed || ui().activeZone === "virtual") return visibleColumns();
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
                  props.store.setActiveZone("board");
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
