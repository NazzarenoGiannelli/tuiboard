/**
 * Vertical 24h timeline column with mouse drag-to-schedule.
 *
 * Renders today's time-blocked tasks as bands stacked on a per-15-minute
 * grid. Hour rows show their hour label on the left margin; the current
 * time is overlaid as a colored "now" line. Overlapping blocks are
 * rendered side-by-side via a 2-lane split row; a 3rd overlapping block
 * is dropped and reported as overflow via a banner.
 *
 * Interaction:
 *   - hjkl / j-k:  cursor between time blocks (chronological)
 *   - Enter:        bounce kanban cursor to the underlying task
 *   - Click on band: same as Enter (one-tap jump)
 *   - Drag band:    move the block (mouse y delta × 15 min)
 *   - Drag bottom edge of band: resize (extend / shrink duration)
 *
 * Each timeline row is exactly 1 terminal line tall, so the mouse Δy in
 * terminal coords maps 1:1 to row count, which maps 1:1 to MINS_PER_ROW
 * minutes. No snap math needed beyond integer Δy.
 *
 * Scrolling: a scrollbox wraps the grid so all 64 rows can be reached even
 * in a 30-row terminal. On mount we scrollChildIntoView the now-row so the
 * user lands at the current time without scrolling.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { isoToday, type TaskRef } from "~/store/index";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  buildRowMap,
  buildTimelineEntries,
  formatHm,
  type RowMapEntry,
  type RowMapPair,
  type TimelineEntry,
} from "~/store/timeline";
import { ATTR, PRIORITY_COLOR, T, boardColor } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/** Minimal OpenTUI MouseEvent shape we touch. We only need x/y. */
interface MouseEventLike {
  x: number;
  y: number;
}

interface TimelineViewProps {
  store: TuiStore;
  width?: number;
}

type DragMode = "move" | "resize";

interface DragState {
  mode: DragMode;
  entry: TimelineEntry;
  origStartMin: number;
  origEndMin: number;
  startY: number;
  /** Current Y position during drag. Updated by onMouseDrag. */
  currentY: number;
}

const ROW_ID_PREFIX = "tuiboard-tl-row-";
/** Minimum block duration in minutes — prevents zero-length blocks on resize. */
const MIN_BLOCK_MIN = 15;

export function TimelineView(props: TimelineViewProps) {
  const isActive = () => props.store.state.ui.activeZone === "timeline";
  const cursor = () => props.store.state.ui.row;

  const entries = createMemo(() =>
    buildTimelineEntries(
      props.store.state.boards.map((b) => b.board),
      isoToday(),
    ),
  );

  // Recompute the row map every minute so the "now" marker stays current.
  const nowMin = useNowMin();
  const rowMap = createMemo(() => buildRowMap(entries(), nowMin()));

  // Drag state.
  const [drag, setDrag] = createSignal<DragState | undefined>();

  // Preview new time block during drag, snapped to 15-min slots.
  const dragPreview = createMemo<{ startMin: number; endMin: number } | undefined>(() => {
    const d = drag();
    if (!d) return undefined;
    const dy = d.currentY - d.startY;
    const dMin = dy * MINS_PER_ROW;
    if (d.mode === "move") {
      return {
        startMin: Math.max(0, d.origStartMin + dMin),
        endMin: Math.min(24 * 60 - 1, d.origEndMin + dMin),
      };
    }
    // resize: pin start, push end
    const newEnd = Math.max(d.origStartMin + MIN_BLOCK_MIN, d.origEndMin + dMin);
    return {
      startMin: d.origStartMin,
      endMin: Math.min(24 * 60 - 1, newEnd),
    };
  });

  let scrollBoxRef: ScrollBoxLike | undefined;

  // Scroll-to-now on mount.
  onMount(() => {
    setTimeout(() => {
      try {
        const target = nowRowId(rowMap().rows);
        if (target) scrollBoxRef?.scrollChildIntoView(target);
      } catch {
        // First-paint races — harmless.
      }
    }, 50);
  });

  // Scroll-to-cursor when navigation moves the cursor entry off-screen.
  createEffect(() => {
    const c = cursor();
    if (!isActive() || !scrollBoxRef) return;
    const entry = entries()[c];
    if (!entry) return;
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(rowIdFor(entry.startRow));
      } catch {
        // Child not yet mounted on first frame — harmless.
      }
    }, 0);
  });

  const cursorEntry = createMemo(() => entries()[cursor()]);

  const onClickEntry = (entry: TimelineEntry) => {
    const idx = entries().indexOf(entry);
    if (idx >= 0) {
      props.store.setActiveZone("timeline");
      props.store.setCursor(0, idx);
    }
    jumpToKanban(props.store, entry.ref);
  };

  const onBlockMouseDown = (
    entry: TimelineEntry,
    rowIndex: number,
    event: MouseEventLike,
  ) => {
    // Resize when the user grabs the BOTTOM row of a multi-row block.
    // Single-row blocks (shouldn't exist post-clip — min is 2 rows) fall
    // back to move.
    const span = entry.endRow - entry.startRow;
    const isLastRow = span >= 2 && rowIndex === entry.endRow - 1;
    setDrag({
      mode: isLastRow ? "resize" : "move",
      entry,
      origStartMin: entry.startMin,
      origEndMin: entry.endMin,
      startY: event.y,
      currentY: event.y,
    });
  };

  const onMouseDragGlobal = (event: MouseEventLike) => {
    setDrag((d) => (d ? { ...d, currentY: event.y } : d));
  };

  const onMouseDragEndGlobal = (event: MouseEventLike) => {
    const d = drag();
    if (!d) return;
    // Use the event's final Y so we don't miss a last-frame movement.
    const dy = event.y - d.startY;
    if (dy === 0) {
      // No real drag — let the click handler do its thing (already fired
      // on mousedown).
      setDrag(undefined);
      return;
    }
    const dMin = dy * MINS_PER_ROW;
    let newStart = d.origStartMin;
    let newEnd = d.origEndMin;
    if (d.mode === "move") {
      newStart = Math.max(0, d.origStartMin + dMin);
      newEnd = Math.min(24 * 60 - 1, d.origEndMin + dMin);
    } else {
      newEnd = Math.max(
        d.origStartMin + MIN_BLOCK_MIN,
        Math.min(24 * 60 - 1, d.origEndMin + dMin),
      );
    }
    props.store.setTimeBlock(d.entry.ref, { startMin: newStart, endMin: newEnd });
    props.store.flashBanner(
      "info",
      d.mode === "move"
        ? `⌚ Moved → ${formatHm(newStart)}-${formatHm(newEnd)}`
        : `↕ Resized → ${formatHm(newStart)}-${formatHm(newEnd)}`,
    );
    setDrag(undefined);
  };

  return (
    <box
      style={{
        flexDirection: "column",
        width: props.width,
        minWidth: props.width,
        flexGrow: props.width ? 0 : 1,
        marginLeft: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Timeline · ${entries().length} ├`}
      titleAlignment="left"
      // Catch drag motion + release at the container level so the events
      // keep flowing even when the cursor moves off the originating row.
      onMouseDrag={onMouseDragGlobal}
      onMouseDragEnd={onMouseDragEndGlobal}
    >
      <Show when={drag()}>
        <text wrapMode="none" truncate>
          <span style={{ fg: T.warm, attributes: ATTR.bold }}>
            {drag()!.mode === "move" ? "✋ " : "↕ "}
            {dragPreview()
              ? `${formatHm(dragPreview()!.startMin)}-${formatHm(dragPreview()!.endMin)}`
              : ""}
          </span>
          <span style={{ fg: T.textDim }}>
            {drag()!.mode === "move" ? "  drag to move · release to commit" : "  drag bottom · release to commit"}
          </span>
        </text>
      </Show>
      <Show when={rowMap().overflow > 0 && !drag()}>
        <text wrapMode="none" truncate>
          <span style={{ fg: T.bannerWarn }}>
            {`⚠ ${rowMap().overflow} block${rowMap().overflow === 1 ? "" : "s"} hidden by 3-way overlap`}
          </span>
        </text>
      </Show>
      <scrollbox
        ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
        style={{
          width: "100%",
          flexGrow: 1,
          scrollX: false,
          scrollY: true,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={rowMap().rows}>
          {(pair, i) => (
            <box id={rowIdFor(i())}>
              <TimelineRow
                pair={pair}
                rowIndex={i()}
                cursorEntry={isActive() ? cursorEntry() : undefined}
                draggingEntry={drag()?.entry}
                onClickEntry={onClickEntry}
                onBlockMouseDown={onBlockMouseDown}
              />
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  );
}

/**
 * Bounce the kanban cursor to a specific task. Used by both the click and
 * the Enter handler in handleKey.
 */
export function jumpToKanban(store: TuiStore, ref: TaskRef): void {
  const boardIdx = store.state.boards.findIndex(
    (b) => b.board.filepath === ref.boardPath,
  );
  if (boardIdx < 0) return;
  store.setActiveBoard(boardIdx);
  // setActiveBoard resets col/row to 0, then we override.
  store.setActiveZone("board");
  // The kanban cursor uses the visible-tasks index, not the all-tasks
  // index. Compute it: visible open-tasks list, find this task's position.
  const board = store.state.boards[boardIdx]!.board;
  const col = board.columns[ref.columnIndex];
  if (!col) return;
  const allTasks = col.children.filter(
    (c): c is import("~/types").Task => !("kind" in c),
  );
  const targetTask = allTasks[ref.taskIndex];
  if (!targetTask) return;
  const openTasks = allTasks.filter((t) => !t.done);
  const visibleRow = openTasks.indexOf(targetTask);
  store.setCursor(ref.columnIndex, Math.max(0, visibleRow));
}

interface TimelineRowProps {
  pair: RowMapPair;
  rowIndex: number;
  /** When set, the cursor task — used to highlight whichever lane owns it. */
  cursorEntry: TimelineEntry | undefined;
  /** When set, the entry currently being dragged — used to tint its rows. */
  draggingEntry: TimelineEntry | undefined;
  onClickEntry: (entry: TimelineEntry) => void;
  onBlockMouseDown: (
    entry: TimelineEntry,
    rowIndex: number,
    event: MouseEventLike,
  ) => void;
}

function TimelineRow(props: TimelineRowProps) {
  const left = () => props.pair.left;
  const right = () => props.pair.right;

  // NOW marker: always full width.
  const isNow = () => left().kind === "now";
  // Right lane occupied → split row horizontally.
  const isSplit = () => right().kind !== "empty";

  const leftIsCursor = () =>
    !!props.cursorEntry &&
    left().entry !== undefined &&
    left().entry === props.cursorEntry;
  const rightIsCursor = () =>
    !!props.cursorEntry &&
    right().entry !== undefined &&
    right().entry === props.cursorEntry;

  const leftIsBlock = () => isBlockKind(left().kind);
  const rightIsBlock = () => isBlockKind(right().kind);

  const leftIsDragging = () =>
    !!props.draggingEntry && left().entry === props.draggingEntry;
  const rightIsDragging = () =>
    !!props.draggingEntry && right().entry === props.draggingEntry;

  return (
    <Show
      when={isSplit() && !isNow()}
      fallback={
        // Full-width single lane (covers empty / hour / now / single-block).
        <box
          style={{
            flexDirection: "row",
            height: 1,
            backgroundColor: laneBg(
              leftIsCursor(),
              leftIsDragging(),
              leftIsBlock(),
            ),
          }}
          onMouseDown={
            left().entry
              ? ((event: MouseEventLike) => {
                  props.onBlockMouseDown(left().entry!, props.rowIndex, event);
                  props.onClickEntry(left().entry!);
                })
              : undefined
          }
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} />
          </text>
        </box>
      }
    >
      {/* Split row: hour prefix + left lane + separator + right lane. */}
      <box
        style={{
          flexDirection: "row",
          height: 1,
        }}
      >
        <box
          style={{
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            backgroundColor: laneBg(
              leftIsCursor(),
              leftIsDragging(),
              leftIsBlock(),
            ),
          }}
          onMouseDown={
            left().entry
              ? ((event: MouseEventLike) => {
                  props.onBlockMouseDown(left().entry!, props.rowIndex, event);
                  props.onClickEntry(left().entry!);
                })
              : undefined
          }
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} />
          </text>
        </box>
        <text style={{ width: 1, flexShrink: 0 }} wrapMode="none">
          <span style={{ fg: T.border }}>{"╎"}</span>
        </text>
        <box
          style={{
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            backgroundColor: laneBg(
              rightIsCursor(),
              rightIsDragging(),
              rightIsBlock(),
            ),
          }}
          onMouseDown={
            right().entry
              ? ((event: MouseEventLike) => {
                  props.onBlockMouseDown(right().entry!, props.rowIndex, event);
                  props.onClickEntry(right().entry!);
                })
              : undefined
          }
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            {/* Right lane skips the 3-char hour prefix that's already on the row. */}
            <RowContent row={right()} rowIndex={props.rowIndex} skipPrefix />
          </text>
        </box>
      </box>
    </Show>
  );
}

interface RowContentProps {
  row: RowMapEntry;
  rowIndex: number;
  /** When true, omit the leading 3-char hour-gutter spacer. */
  skipPrefix?: boolean;
}

function RowContent(props: RowContentProps) {
  const r = props.row;
  const prefix = props.skipPrefix ? "" : "   ";

  if (r.kind === "now") {
    return (
      <>
        <span style={{ fg: T.overdue, attributes: ATTR.bold }}>
          {"━━ "}{formatHm(r.nowMin ?? 0)}{" "}
        </span>
        <span style={{ fg: T.overdue }}>
          {"━".repeat(120)}
        </span>
      </>
    );
  }
  if (r.kind === "hour") {
    const label = (r.hour ?? 0).toString().padStart(2, "0");
    return (
      <>
        <span style={{ fg: T.textDim }}>{label}{" "}</span>
        <span style={{ fg: T.border }}>{"─".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "empty") {
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: T.border }}>{"·".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "head" && r.entry) {
    const e = r.entry;
    const bColor = boardColor(e.boardIndex);
    const priorityGlyph =
      e.task.priority !== "none" ? "🔺 " : "";
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: bColor, attributes: ATTR.bold }}>
          {"┤ "}{formatHm(e.startMin)}{"-"}{formatHm(e.endMin)}{" "}
        </span>
        <Show when={e.task.assignee}>
          <span style={{ fg: T.assignee }}>{"@"}{e.task.assignee}{" "}</span>
        </Show>
        <Show when={priorityGlyph}>
          <span style={{ fg: PRIORITY_COLOR[e.task.priority] }}>
            {priorityGlyph}
          </span>
        </Show>
      </>
    );
  }
  if (r.kind === "body" && r.entry) {
    const e = r.entry;
    const bColor = boardColor(e.boardIndex);
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: bColor }}>{"│ "}</span>
        <span style={{ fg: e.task.done ? T.textDone : T.text }}>
          {e.task.displayTitle}
        </span>
      </>
    );
  }
  if (r.kind === "fill" && r.entry) {
    const e = r.entry;
    const bColor = boardColor(e.boardIndex);
    const isLast = props.rowIndex === e.endRow - 1;
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: bColor }}>{isLast ? "╰" : "│"}</span>
        <Show when={isLast}>
          {/* Bottom edge of the block — visible resize handle. Drag this
              row to extend/shrink the block. */}
          <span style={{ fg: bColor, attributes: ATTR.bold }}>{"═".repeat(120)}</span>
        </Show>
      </>
    );
  }
  return <span>{" "}</span>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowIdFor(rowIndex: number): string {
  return `${ROW_ID_PREFIX}${rowIndex}`;
}

function nowRowId(rows: RowMapPair[]): string | undefined {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.left.kind === "now") return rowIdFor(i);
  }
  return undefined;
}

function isBlockKind(k: RowMapEntry["kind"]): boolean {
  return k === "head" || k === "body" || k === "fill";
}

/**
 * Pick the background color for a lane cell based on its state. Cursor wins
 * over drag, drag wins over plain "is a block row", and a non-block (hour /
 * empty / now) gets the terminal default.
 */
function laneBg(
  isCursor: boolean,
  isDragging: boolean,
  isBlock: boolean,
): string | undefined {
  if (isCursor) return T.cardBgCursor;
  if (isDragging) return T.warmDim;
  if (isBlock) return T.cardBlockBg;
  return undefined;
}

/**
 * Reactive "minutes since midnight". Ticks once per minute via setInterval
 * so the now-line slides down throughout the day without manual refresh.
 */
function useNowMin() {
  const [now, setNow] = createSignal(getNowMin());
  const handle = setInterval(() => setNow(getNowMin()), 60_000);
  onCleanup(() => clearInterval(handle));
  return now;
}

function getNowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Imports used implicitly inside the JSX above (silence dead-import warnings).
void DAY_START_HOUR;
void MINS_PER_ROW;
