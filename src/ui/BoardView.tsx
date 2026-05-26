/** Kanban board view — columns side-by-side with cursor. */

import { For, Show, createMemo } from "solid-js";

import { isTask } from "~/parser/markdown";
import { ATTR, T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import type { TuiStore } from "~/store/index";
import type { Board, Column } from "~/types";

interface BoardViewProps {
  store: TuiStore;
  board: Board;
}

export function BoardView(props: BoardViewProps) {
  const ui = () => props.store.state.ui;

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <scrollbox
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: {},
          contentOptions: {
            flexDirection: "row",
          },
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: T.accent,
              backgroundColor: T.border,
            },
          },
        }}
      >
        <For each={props.board.columns}>
          {(col, ci) => (
            <ColumnView
              store={props.store}
              board={props.board}
              column={col}
              columnIndex={ci()}
              active={!ui().inVirtual && ui().col === ci()}
            />
          )}
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
}

function ColumnView(props: ColumnViewProps) {
  const allTasks = createMemo(() => props.column.children.filter(isTask));
  const openTasks = createMemo(() => allTasks().filter((t) => !t.done));
  const doneTasks = createMemo(() => allTasks().filter((t) => t.done));
  const doneExpanded = createMemo(() =>
    props.store.isDoneExpanded(props.board.filepath, props.column.name),
  );

  const visibleTasks = createMemo(() => {
    if (doneExpanded()) return allTasks();
    return openTasks();
  });

  const cursorRow = createMemo(() => props.store.state.ui.row);

  return (
    <box
      style={{
        flexDirection: "column",
        width: 34,
        minWidth: 34,
        marginRight: 2,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text wrapMode="none" truncate>
          <span style={{ fg: props.active ? T.accent : T.textDim }}>
            {props.active ? "▎" : " "}
          </span>
          <span style={{ fg: props.active ? T.accent : T.text, attributes: ATTR.bold }}>
            {props.column.name}
          </span>
          <span style={{ fg: T.textDim }}>{"  "}{openTasks().length}</span>
          <Show when={doneTasks().length > 0}>
            <span style={{ fg: T.textDone }}>{"  ✓"}{doneTasks().length}</span>
          </Show>
        </text>
      </box>

      <scrollbox
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: T.accent,
              backgroundColor: T.border,
            },
          },
        }}
      >
        <For each={visibleTasks()}>
          {(task, ri) => (
            <TaskRow
              task={task}
              cursor={props.active && ri() === cursorRow()}
            />
          )}
        </For>

        <Show when={!doneExpanded() && doneTasks().length > 0}>
          <box
            style={{
              flexDirection: "row",
              paddingLeft: 1,
              paddingRight: 1,
              marginTop: 1,
            }}
          >
            <text wrapMode="none" truncate>
              <span style={{ fg: T.textDim }}>
                {"▸ Done ["}{doneTasks().length}{"]  z to expand"}
              </span>
            </text>
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}

function summarize(b: Board): string {
  let total = 0;
  let done = 0;
  for (const c of b.columns) {
    for (const child of c.children) {
      if (isTask(child)) {
        total++;
        if (child.done) done++;
      }
    }
  }
  return `${total - done} open · ${done} done · ${b.columns.length} columns`;
}
