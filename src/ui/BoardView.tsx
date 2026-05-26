/** Kanban board view — columns side-by-side, with zoom mode. */

import { For, Show, createMemo } from "solid-js";

import { isTask } from "~/parser/markdown";
import { T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import type { TuiStore } from "~/store/index";
import type { Board, Column } from "~/types";

interface BoardViewProps {
  store: TuiStore;
  board: Board;
}

export function BoardView(props: BoardViewProps) {
  const ui = () => props.store.state.ui;
  const archiveName = () => props.store.config.archiveColumn;

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
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: {},
          contentOptions: { flexDirection: "row" },
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={renderedColumns()}>
          {(col) => {
            // Map back to the original board index so cursor + keyboard
            // operations still target the right column even though we
            // may render fewer here (zoom).
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
      style={{
        flexDirection: "column",
        // In zoom mode, the column takes whatever space the parent gives
        // it (flexGrow: 1). In normal mode, fixed width per column.
        width: props.zoomed ? undefined : 36,
        minWidth: props.zoomed ? undefined : 36,
        flexGrow: props.zoomed ? 1 : 0,
        marginRight: 1,
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
          {(task, ri) => (
            <TaskRow
              task={task}
              cursor={props.active && ri() === cursorRow()}
              // In zoom mode, the column is wide — let titles breathe.
              titleMaxChars={props.zoomed ? 64 : 22}
            />
          )}
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
