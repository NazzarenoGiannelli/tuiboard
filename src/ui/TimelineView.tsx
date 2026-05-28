/**
 * Vertical 24h timeline column with click-to-arm scheduling.
 *
 * Renders today's time-blocked tasks as bands stacked on a per-15-minute
 * grid. Hour rows show their hour label on the left margin; the current
 * time is overlaid as a colored "now" line. Overlapping blocks are
 * rendered side-by-side via a 2-lane split row; a 3rd overlapping block
 * is dropped and reported as overflow via a banner.
 *
 * Mouse interaction (click-to-arm + click-to-place, like Python timeline.py):
 *
 *   Click on a band      → ARM that block (warm highlight)
 *   Click on empty row   → if armed, MOVE the armed block's start there
 *   Shift+click empty    → if armed, RESIZE the armed block's end there
 *   Click again on band  → toggle: re-arms (or disarms if same block)
 *
 * Keyboard interaction (handled in handleKey when activeZone === "timeline"):
 *
 *   j/k                  → cursor between blocks (chronological order)
 *   Enter                → bounce kanban cursor to the underlying task
 *   j/k while armed      → nudge armed block ±15 min (move)
 *   +/- while armed      → resize armed block end ±15 min
 *   Esc                  → disarm
 *
 * Each timeline row is exactly 1 terminal line tall, so row index maps
 * 1:1 to MINS_PER_ROW (15) minute offsets from DAY_START_HOUR.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { isoToday, type TaskRef } from "~/store/index";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  TOTAL_ROWS,
  buildRowMap,
  buildTimelineEntries,
  formatHm,
  type RowMapEntry,
  type RowMapPair,
  type TimelineEntry,
} from "~/store/timeline";
import {
  ATTR,
  PRIORITY_COLOR,
  T,
  boardColor,
} from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";
import type { Task } from "~/types";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/** Minimal OpenTUI MouseEvent shape we touch (x, y, modifiers). */
interface MouseEventLike {
  x: number;
  y: number;
  modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean };
}

interface TimelineViewProps {
  store: TuiStore;
  width?: number;
}

const ROW_ID_PREFIX = "tuiboard-tl-row-";
/** Minimum block duration in minutes — prevents zero-length blocks on resize. */
const MIN_BLOCK_MIN = 15;
/** Default duration applied when an armed (unscheduled) task is dropped. */
const DEFAULT_BLOCK_MIN = 30;

export function TimelineView(props: TimelineViewProps) {
  const isActive = () => props.store.state.ui.activeZone === "timeline";
  const cursor = () => props.store.state.ui.row;
  const armedRef = () => props.store.state.ui.armedTimelineRef;
  const armMode = () => props.store.state.ui.armMode;

  const entries = createMemo(() =>
    buildTimelineEntries(
      props.store.state.boards.map((b) => b.board),
      isoToday(),
    ),
  );

  // Recompute the row map every minute so the "now" marker stays current.
  // No more sticky-unscheduled trimming — the unscheduled list lived at the
  // top of the timeline and caused unsolvable flex-overlap with the grid
  // scrollbox below it. Replaced by the global `C` (calendar-arm) shortcut:
  // arm a task from the board / virtual panel, then click a timeline slot
  // to place it. The grid now owns the whole panel, clean and simple.
  const nowMin = useNowMin();
  const rowMap = createMemo(() => buildRowMap(entries(), nowMin()));

  /** Find the armed entry in the current entries list (if still present). */
  const armedEntry = createMemo<TimelineEntry | undefined>(() => {
    const ref = armedRef();
    if (!ref) return undefined;
    return entries().find(
      (e) =>
        e.ref.boardPath === ref.boardPath &&
        e.ref.columnIndex === ref.columnIndex &&
        e.ref.taskIndex === ref.taskIndex,
    );
  });

  /** The armed task itself, whether it's a scheduled block or an unscheduled. */
  const armedTask = createMemo<Task | undefined>(() => {
    const ref = armedRef();
    if (!ref) return undefined;
    return props.store.getTask(ref);
  });

  /** True when arming an unscheduled-today task (drop = create new block). */
  const armedIsUnscheduled = createMemo(() => {
    const t = armedTask();
    return !!t && !t.timeBlock;
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

  /**
   * Click on a block band. Three behaviors, in priority order:
   *   1. DIFFERENT task already armed → PLACE armed task at this band's
   *      startMin (lets the user stack two blocks at the same start time
   *      by clicking on an existing band).
   *   2. SAME block already armed → DISARM.
   *   3. Nothing armed → ARM this band.
   */
  const onBlockClick = (entry: TimelineEntry, event: MouseEventLike) => {
    props.store.setActiveZone("timeline");

    const arm = armedRef();
    const armedSame =
      !!arm &&
      arm.boardPath === entry.ref.boardPath &&
      arm.columnIndex === entry.ref.columnIndex &&
      arm.taskIndex === entry.ref.taskIndex;
    const armedDifferent = !!arm && !armedSame;

    if (armedDifferent) {
      // Delegate to onEmptyRowClick using the band's startRow — places
      // (move or create) the armed task at this band's start time. Lets
      // the user pile two blocks at the same minute (e.g. both at 9:00).
      onEmptyRowClick(entry.startRow, event);
      return;
    }

    const idx = entries().indexOf(entry);
    if (idx >= 0) props.store.setCursor(0, idx);

    if (armedSame) {
      props.store.armTimeline(undefined);
      props.store.flashBanner("info", "Disarmed");
    } else {
      props.store.armTimeline(entry.ref);
      props.store.flashBanner(
        "info",
        `Armed ⌚${formatHm(entry.startMin)}-${formatHm(entry.endMin)} · click empty row to move, shift+click to resize, Esc to cancel`,
      );
    }
  };

  /**
   * Click on an empty / hour row when a task is armed. Behavior depends
   * on whether the armed task already has a time block:
   *   - Has block + plain click  → MOVE start to clicked row (keep duration)
   *   - Has block + shift+click  → RESIZE end to clicked row
   *   - No block (unscheduled)   → CREATE block at clicked row, 30min default
   */
  const onEmptyRowClick = (rowIndex: number, event: MouseEventLike) => {
    const armed = armedTask();
    const ref = armedRef();
    if (!armed || !ref) return;
    const targetMin = DAY_START_HOUR * 60 + rowIndex * MINS_PER_ROW;

    // Unscheduled task → create a fresh block at the clicked row.
    if (!armed.timeBlock) {
      const startMin = Math.max(0, targetMin);
      const endMin = Math.min(24 * 60 - 1, startMin + DEFAULT_BLOCK_MIN);
      // A time block only renders on the timeline when the task is also
      // scheduled for today — so arming a task from ANY board and dropping it
      // here pins it to today (otherwise it'd vanish: block set, wrong date).
      props.store.setScheduled(ref, isoToday());
      props.store.setTimeBlock(ref, { startMin, endMin });
      props.store.flashBanner(
        "info",
        `⌚ Scheduled → ${formatHm(startMin)}-${formatHm(endMin)}`,
      );
      // Auto-disarm: the task now has a block and will appear as a band;
      // the user can re-click on that band to keep adjusting.
      props.store.armTimeline(undefined);
      return;
    }

    // Existing block: move (plain click) or resize (shift+click).
    const block = armed.timeBlock;
    const shift = !!event.modifiers?.shift;
    if (shift) {
      const newEnd = Math.max(block.startMin + MIN_BLOCK_MIN, targetMin);
      props.store.setTimeBlock(ref, {
        startMin: block.startMin,
        endMin: Math.min(24 * 60 - 1, newEnd),
      });
      props.store.flashBanner(
        "info",
        `↕ Resized → ${formatHm(block.startMin)}-${formatHm(newEnd)}`,
      );
    } else {
      const duration = block.endMin - block.startMin;
      const newStart = Math.max(0, targetMin);
      const newEnd = Math.min(24 * 60 - 1, newStart + duration);
      props.store.setTimeBlock(ref, { startMin: newStart, endMin: newEnd });
      props.store.flashBanner(
        "info",
        `✋ Moved → ${formatHm(newStart)}-${formatHm(newEnd)}`,
      );
    }
    // Keep armed so the user can chain adjustments. Esc to release.
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
        // Arm mode paints the border warm so the special scheduling mode is
        // unmistakable, even when the keyboard focus is elsewhere.
        borderColor: armMode()
          ? T.warmActive
          : isActive()
            ? T.borderActive
            : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Timeline · ${entries().length}${armMode() ? "  ◉ ARM" : ""} ├`}
      titleAlignment="left"
    >
      <Show when={armMode()}>
        <text wrapMode="none">
          <span style={{ fg: T.warmActive, attributes: ATTR.bold }}>
            {"◉ ARM MODE "}
          </span>
          <span style={{ fg: T.textDim }}>
            {"click a task → click a slot · Esc to exit"}
          </span>
        </text>
      </Show>
      <Show when={armedTask()}>
        <text wrapMode="none">
          <span style={{ fg: T.warm, attributes: ATTR.bold }}>
            {armedIsUnscheduled() ? "⤤ Armed (new): " : "⤤ Armed: "}
            {armedIsUnscheduled()
              ? tailTruncate(armedTask()!.displayTitle, 32)
              : `${formatHm(armedEntry()!.startMin)}-${formatHm(armedEntry()!.endMin)}`}
          </span>
          <span style={{ fg: T.textDim }}>
            {armedIsUnscheduled()
              ? "  click row to place · Esc to cancel"
              : "  click row to move · shift+click to resize · Esc"}
          </span>
        </text>
      </Show>
      <Show when={!armedTask() && rowMap().overflow > 0}>
        <text wrapMode="none">
          <span style={{ fg: T.bannerWarn }}>
            {`⚠ ${rowMap().overflow} block${rowMap().overflow === 1 ? "" : "s"} hidden by 3-way overlap`}
          </span>
        </text>
      </Show>

      {/* The 24h grid now owns the whole panel — no sticky section above
          it. Tasks are armed for scheduling from the board / virtual panel
          via the `C` shortcut, then placed by clicking a slot here. */}
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
                armedEntry={armedEntry()}
                innerWidth={props.width ? props.width - 4 : undefined}
                onBlockClick={onBlockClick}
                onEmptyRowClick={onEmptyRowClick}
              />
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  );
}

/**
 * Bounce the kanban cursor to a specific task. Called from handleKey when
 * Enter is pressed in the timeline zone — moved out of the click handler
 * so single-click stays inside the timeline (arm only).
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
  /** When set, the armed entry — used to tint its rows warm. */
  armedEntry: TimelineEntry | undefined;
  /** Panel content width (border+padding already removed). Undefined = fullscreen. */
  innerWidth?: number;
  onBlockClick: (entry: TimelineEntry, event: MouseEventLike) => void;
  onEmptyRowClick: (rowIndex: number, event: MouseEventLike) => void;
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

  const leftIsArmed = () =>
    !!props.armedEntry && left().entry === props.armedEntry;
  const rightIsArmed = () =>
    !!props.armedEntry && right().entry === props.armedEntry;

  const leftIsDone = () => !!left().entry?.task.done;
  const rightIsDone = () => !!right().entry?.task.done;

  // Cell budget per lane, so RowContent can tail-truncate the title (keeping
  // the head readable) instead of leaning on OpenTUI's middle-ellipsis.
  const innerW = () => props.innerWidth ?? 200;
  const splitLeftW = () => Math.floor((innerW() - 1) / 2);
  const splitRightW = () => innerW() - 1 - splitLeftW();

  /** Mouse handler factory for a lane cell. */
  const cellMouseDown = (cellEntry: TimelineEntry | undefined) => {
    return (event: MouseEventLike) => {
      if (cellEntry) {
        props.onBlockClick(cellEntry, event);
      } else {
        // Empty / hour / now row — placement target when armed.
        props.onEmptyRowClick(props.rowIndex, event);
      }
    };
  };

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
              leftIsArmed(),
              leftIsBlock(),
              leftIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} laneWidth={innerW()} />
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
              leftIsArmed(),
              leftIsBlock(),
              leftIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} laneWidth={splitLeftW()} />
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
              rightIsArmed(),
              rightIsBlock(),
              rightIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(right().entry)}
        >
          <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
            {/* Right lane skips the 3-char hour prefix that's already on the row. */}
            <RowContent row={right()} rowIndex={props.rowIndex} laneWidth={splitRightW()} skipPrefix />
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
  /** Cell budget for this lane — used to tail-truncate the block title. */
  laneWidth?: number;
}

function RowContent(props: RowContentProps) {
  const r = props.row;
  const prefix = props.skipPrefix ? "" : "   ";

  if (r.kind === "now") {
    return (
      <>
        <span style={{ fg: T.overdue, attributes: ATTR.bold }}>
          {"━━ "}
          {formatHm(r.nowMin ?? 0)}{" "}
        </span>
        <span style={{ fg: T.overdue }}>{"━".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "hour") {
    // Hour anchor row: '07  ──────────' — number + horizontal grid line.
    // Gives the eye a strong tick mark to scan against.
    const label = (r.hour ?? 0).toString().padStart(2, "0");
    return (
      <>
        <span style={{ fg: T.textDim }}>{label} </span>
        <span style={{ fg: T.border }}>{"─".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "empty") {
    // 15-min sub-row: dotted '···' fill so the grid is visually
    // continuous. Reads as 'tick mark every 15 min' without competing
    // with block content (which paints on top with a solid bg color).
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
    const priorityGlyph = e.task.priority !== "none" ? "🔺 " : "";
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: bColor, attributes: ATTR.bold }}>
          {"┤ "}
          {formatHm(e.startMin)}
          {"-"}
          {formatHm(e.endMin)}{" "}
        </span>
        <Show when={e.task.assignee}>
          <span style={{ fg: T.assignee }}>
            {"@"}
            {e.task.assignee}{" "}
          </span>
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
    // Tail-truncate so the START of the title stays readable (the head/tail
    // ellipsis OpenTUI does otherwise chops the middle). Budget = lane width
    // minus the prefix, the "│ " gutter, and the done check.
    const avail = props.laneWidth ?? 200;
    const budget = Math.max(
      6,
      avail - (props.skipPrefix ? 0 : 3) - 2 - (e.task.done ? 2 : 0),
    );
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: bColor }}>{"│ "}</span>
        <Show when={e.task.done}>
          <span style={{ fg: T.done }}>{"✓ "}</span>
        </Show>
        <span style={{ fg: e.task.done ? T.done : T.text }}>
          {tailTruncate(e.task.displayTitle, budget)}
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
          {/* Bottom edge of the block — clear visual cap. */}
          <span style={{ fg: bColor }}>{"─".repeat(120)}</span>
        </Show>
      </>
    );
  }
  return <span> </span>;
}

/** Local tail-truncate helper (mirrors TaskRow's). Keeps the head + `…`. */
function tailTruncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max < 2) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
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
 * over armed, armed wins over plain "is a block row", and a non-block (hour
 * / empty / now) gets the terminal default.
 */
function laneBg(
  isCursor: boolean,
  isArmed: boolean,
  isBlock: boolean,
  isDone: boolean,
): string | undefined {
  if (isArmed) return T.warmDim;
  if (isCursor) return T.cardBgCursor;
  if (isBlock) return isDone ? T.cardBlockBgDone : T.cardBlockBg;
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
void TOTAL_ROWS;
