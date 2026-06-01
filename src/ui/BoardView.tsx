/**
 * Kanban board view — horizontal scrolling row of full-height columns.
 *
 * Mirrors the Today/Tomorrow planner panel: each column has a fixed width
 * and stretches vertically to fill the board area. Columns that don't fit
 * the available horizontal space are reached via horizontal scroll. Zoom
 * mode collapses everything down to the single active column at full
 * board width.
 */

import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";

import { isHiddenColumn } from "~/config/loader";
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

/** Just enough of a box renderable to read its laid-out width. */
interface SizedBoxLike {
  readonly width: number;
}

/** Fixed column width when not zoomed. Single source of truth for layout. */
const COL_WIDTH = 42;
/**
 * Width of a collapsed column — one with no OPEN tasks (an all-done lane like
 * "Done", or an empty column). It shows just the `✓ N` counter; zoom (`z`)
 * expands it back to full width so the done tasks can be scrolled on demand.
 */
const COL_WIDTH_COLLAPSED = 18;
/** Horizontal gap between adjacent columns. */
const COL_GAP = 1;

/** Open (non-done) task count for a column, honoring the active board filter. */
function openCountOf(store: TuiStore, column: Column): number {
  return store.applyBoardFilter(
    column.children.filter(isTask).filter((t) => !t.done),
  ).length;
}

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
  // Width of the clipping viewport (the board zone), read from layout.
  let viewportRef: SizedBoxLike | undefined;
  // Horizontal scroll offset in cells, applied as a negative left margin on
  // the inner column row. A signal so the shift re-renders reactively.
  const [scrollX, setScrollX] = createSignal(0);
  // Laid-out viewport width, captured alongside the scroll so we can tell
  // which columns are fully visible (and blank the task rows of the ones that
  // are only partly on-screen — keeps a clipped column's title as a "there's
  // more" hint without the chopped-word task text).
  const [viewportW, setViewportW] = createSignal(0);

  /**
   * Columns shown in the view — the Done and Archive columns are filtered
   * out entirely (completed-work logs; never displayed on the board). Their
   * tasks still live in the model so tasks can be moved into them; we just
   * don't render them.
   */
  const visibleColumns = createMemo(() =>
    props.board.columns.filter((c) => !isHiddenColumn(props.store.config, c.name)),
  );

  /**
   * In zoom mode we render only the column under the cursor, expanded
   * to fill the board area. This is the "focus on one column" mode
   * (Python kanban `z`).
   */
  const renderedColumns = createMemo(() => {
    if (!ui().zoomed || ui().activeZone === "planner") return visibleColumns();
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

  // Auto-scroll horizontally so the active column is always fully visible.
  //
  // We do this MANUALLY rather than with OpenTUI's <scrollbox>: on the
  // horizontal axis the scrollbox's content box never grows past the
  // viewport width (scrollWidth stays == viewportWidth), so it reports
  // "nothing to scroll" even when fixed-width columns overflow. Instead we
  // clip with a plain overflow:hidden box and shift an inner row left by a
  // negative margin. The shift amount comes from the same deterministic
  // geometry used everywhere (COL_WIDTH + COL_GAP).
  createEffect(() => {
    const colIdx = ui().col;
    if (ui().zoomed || ui().activeZone === "planner") {
      setScrollX(0);
      return;
    }
    const cols = props.board.columns;
    const visibleIndex = visibleColumns().findIndex(
      (c) => cols.indexOf(c) === colIdx,
    );
    if (visibleIndex < 0) return;
    const colStart = visibleIndex * (COL_WIDTH + COL_GAP);
    // setTimeout(0) lets OpenTUI commit layout so viewportRef.width is current.
    // Minimal scroll (right-align when off-screen) — a partly-cut neighbouring
    // column is left as a "there's more to scroll" hint.
    setTimeout(() => {
      const vw = viewportRef?.width ?? 0;
      if (vw <= 0) return;
      setViewportW(vw);
      setScrollX((prev) =>
        computeColumnScrollLeft({
          colStart,
          colWidth: COL_WIDTH,
          viewportWidth: vw,
          currentScroll: prev,
        }),
      );
    }, 0);
  });

  /**
   * Is the column at rendered index `i` fully inside the viewport? Used to
   * blank the task rows of a column that's only partly on-screen. Defaults to
   * true while the viewport width is still unknown (first paint) and in zoom.
   */
  const columnFullyVisible = (i: number): boolean => {
    const vw = viewportW();
    if (vw <= 0 || ui().zoomed) return true;
    const stride = COL_WIDTH + COL_GAP;
    const start = i * stride;
    return start >= scrollX() && start + COL_WIDTH <= scrollX() + vw;
  };

  // Measure the viewport width once at mount, regardless of the active zone.
  // Otherwise — since tuiboard now starts focused on the planner panel — the
  // scroll effect early-returns and viewportW stays 0, so partly-clipped
  // columns briefly show their task rows until the board is first touched.
  onMount(() => {
    setTimeout(() => {
      const vw = viewportRef?.width ?? 0;
      if (vw > 0) setViewportW(vw);
    }, 0);
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      {/* Clipping viewport: fills the board zone, hides overflow. */}
      <box
        ref={(r: SizedBoxLike) => (viewportRef = r)}
        style={{
          width: "100%",
          flexGrow: 1,
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        {/* Inner row: shifted left by the scroll offset to reveal columns. */}
        <box
          style={{
            flexDirection: "row",
            flexGrow: ui().zoomed ? 1 : 0,
            flexShrink: 0,
            height: "100%",
            alignItems: "stretch",
            marginLeft: ui().zoomed ? 0 : -scrollX(),
          }}
        >
          <For each={renderedColumns()}>
            {(col, i) => {
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
                  fullyVisible={columnFullyVisible(i())}
                  boxId={columnId(props.board.filepath, originalIndex)}
                />
              );
            }}
          </For>
        </box>
      </box>
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
  /**
   * False when the column is only partly on-screen (clipped by horizontal
   * scroll). Its title still renders (clipped) as a "more columns" hint, but
   * the task rows are blanked so no half-cut task text shows.
   */
  fullyVisible?: boolean;
  /** Stable DOM-equivalent id used by `scrollChildIntoView`. */
  boxId: string;
}

/** Stable id for a task row inside a column, used by scrollChildIntoView. */
function taskRowId(boardPath: string, colIdx: number, rowIdx: number): string {
  return `tuiboard-task-${boardPath.replace(/[^a-zA-Z0-9]/g, "_")}-${colIdx}-${rowIdx}`;
}

function ColumnView(props: ColumnViewProps) {
  const allTasks = createMemo(() => {
    // Subscribe to the store's mutation counter so this list recomputes on
    // any board change — fine-grained tracking of a nested children-array
    // edit doesn't reliably re-render an already-mounted <For> here.
    props.store.state.rev;
    return props.column.children.filter(isTask);
  });
  const openTasks = createMemo(() =>
    props.store.applyBoardFilter(allTasks().filter((t) => !t.done)),
  );
  const doneTasks = createMemo(() => allTasks().filter((t) => t.done));

  // In zoom mode, show open tasks first, then a divider, then done tasks.
  // In normal mode, show only open tasks; done collapse to a counter.
  const visibleTasks = createMemo(() =>
    props.zoomed ? [...openTasks(), ...doneTasks()] : openTasks(),
  );

  // Structural signature of the visible task list (id + order). OpenTUI's <For>
  // appends a prepended/inserted item to the END of the rendered container
  // instead of placing it at its array index — so after an add the data is
  // right but the on-screen order is wrong until a full remount. We key a
  // <Show> on this signature: when membership/order changes (add / delete /
  // move) it changes, forcing the list to rebuild fresh in the correct order
  // (the same thing a board switch does). A plain text edit leaves ids/order
  // untouched → no remount → cheap in-place update.
  const taskListKey = createMemo(() => {
    props.store.state.rev; // recompute on any mutation, including mark changes
    const ids = visibleTasks().map((t) => t.id).join("|");
    // Fold the current selection into the key too. OpenTUI doesn't reliably
    // re-render a per-row `marked` prop on a store change, so a selection
    // change (mark / unmark / clear) must rebuild the list to repaint the ●
    // dots — same remount trick the add fix relies on. Without this, cleared
    // marks stayed stuck on whatever task now sits at that position.
    const marks = props.store
      .getMarkedRefs()
      .filter(
        (r) =>
          r.boardPath === props.board.filepath &&
          r.columnIndex === props.columnIndex,
      )
      .map((r) => r.taskIndex)
      .join(",");
    return `${ids}#${marks}`;
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
        // contract as the Today/Tomorrow planner panel next door.
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
        {/* Blank the task rows when the column is only partly on-screen — its
            (clipped) title still shows as a "more columns" hint. */}
        <Show when={props.fullyVisible !== false}>
        {/*
          Keyed on the task-list signature so a structural change (add/delete/
          move) rebuilds the <For> fresh in the correct order, working around
          OpenTUI's <For> appending inserted items to the end. Text-only edits
          keep the same key → no rebuild → in-place update.
        */}
        <Show when={taskListKey()} keyed>
          {() => (
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
                        // In calendar arm mode, a click also arms the task so
                        // the user can immediately drop it on a timeline slot.
                        if (props.store.state.ui.armMode) {
                          props.store.armTimeline(ref);
                          props.store.setZoneVisible("timeline", true);
                        }
                      }}
                    />
                  </box>
                );
              }}
            </For>
          )}
        </Show>

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
        </Show>
      </scrollbox>
    </box>
  );
}
