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

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { isoToday, type TaskRef } from "~/store/index";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  TOTAL_ROWS,
  buildRowMap,
  buildTimelineEntries,
  buildUnscheduledToday,
  formatHm,
  type RowMapEntry,
  type RowMapPair,
  type TimelineEntry,
  type UnscheduledItem,
} from "~/store/timeline";
import { ATTR, PRIORITY_COLOR, PRIORITY_GLYPH, T, boardColor } from "~/ui/glyphs";
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
/** Default duration applied when an unscheduled task is dropped on the grid. */
const DEFAULT_BLOCK_MIN = 30;
/** Max rows shown in the sticky unscheduled section before the inner
 *  scrollbox takes over. Kept at 4 because OpenTUI's flex doesn't
 *  strictly clip the grid scrollbox below — beyond ~4 sticky rows the
 *  grid starts bleeding 'hour numbers / dotted lines' into the
 *  sticky's last task rows. The internal scrollbox covers any user
 *  who has more pending tasks (mouse-wheel to scroll the list). */
const UNSCHED_VISIBLE = 4;

export function TimelineView(props: TimelineViewProps) {
  const isActive = () => props.store.state.ui.activeZone === "timeline";
  const cursor = () => props.store.state.ui.row;
  const armedRef = () => props.store.state.ui.armedTimelineRef;

  const entries = createMemo(() =>
    buildTimelineEntries(
      props.store.state.boards.map((b) => b.board),
      isoToday(),
    ),
  );

  /** Today's tasks that don't have a time block yet — sticky list candidates. */
  const unscheduled = createMemo(() =>
    buildUnscheduledToday(
      props.store.state.boards.map((b) => b.board),
      isoToday(),
    ),
  );

  // Recompute the row map every minute so the "now" marker stays current.
  const nowMin = useNowMin();
  const fullRowMap = createMemo(() => buildRowMap(entries(), nowMin()));

  /**
   * Rows the sticky section consumes in the parent's vertical space.
   * Header (1) + scrollbox-of-N (min items, UNSCHED_VISIBLE) + divider (1)
   * + outer marginBottom (1) + 1 row safety buffer (OpenTUI's flex layout
   * in practice leaves us 1 row of grid bleed even with the math nominally
   * matching the visual height). When the sticky isn't rendered, 0.
   */
  const stickyConsumedRows = createMemo(() => {
    const n = unscheduled().length;
    if (n === 0) return 0;
    return Math.min(n, UNSCHED_VISIBLE) + 4;
  });

  /**
   * The visible row map for the grid scrollbox. OpenTUI's flex layout
   * doesn't strictly clip the scrollbox's content to its allocated space,
   * so when the sticky section is present, the grid's first rows would
   * render at the SAME screen rows as the sticky — visible as `07`,
   * `······` bleed-through behind the sticky tasks.
   *
   * Fix: slice off the first `stickyConsumedRows` rows of the rowMap when
   * the sticky is showing. Those rows wouldn't be readable anyway (covered
   * by the sticky), and dropping them lets the grid's remaining content
   * start exactly where the sticky ends — no visual overlap, no need for
   * an opaque sticky background.
   *
   * The trade-off: the earliest few 15-min slots of the day (07:00 ish)
   * disappear from the grid when there are unscheduled tasks. They're
   * empty hours for most workdays, so this is acceptable. If you have a
   * time-blocked task in that range, it stays in the row map (we never
   * drop hours with block content — see the clamp below).
   */
  const rowMap = createMemo(() => {
    const full = fullRowMap();
    let skip = stickyConsumedRows();
    if (skip === 0) return full;
    // Don't drop any row that has block content (head/body/fill on either
    // lane) or is the now marker — only drop pure empty/hour rows.
    let safeSkip = 0;
    for (let i = 0; i < skip && i < full.rows.length; i++) {
      const r = full.rows[i]!;
      const droppable =
        (r.left.kind === "empty" || r.left.kind === "hour") &&
        (r.right.kind === "empty" || r.right.kind === "hour");
      if (!droppable) break;
      safeSkip = i + 1;
    }
    return { rows: full.rows.slice(safeSkip), overflow: full.overflow };
  });

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
   * Click on an unscheduled task in the sticky list. Same arm/disarm
   * toggle semantic as clicking on a band — except the underlying task
   * has no time block (yet). Dropping on an empty row will create one.
   */
  const onUnscheduledClick = (item: UnscheduledItem) => {
    props.store.setActiveZone("timeline");
    const arm = armedRef();
    const same =
      arm &&
      arm.boardPath === item.ref.boardPath &&
      arm.columnIndex === item.ref.columnIndex &&
      arm.taskIndex === item.ref.taskIndex;
    if (same) {
      props.store.armTimeline(undefined);
      props.store.flashBanner("info", "Disarmed");
    } else {
      props.store.armTimeline(item.ref);
      props.store.flashBanner(
        "info",
        `Armed: ${item.task.displayTitle.slice(0, 40)} · click a row to place (${DEFAULT_BLOCK_MIN}min default)`,
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
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Timeline · ${entries().length} ├`}
      titleAlignment="left"
    >
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

      {/* Sticky "unscheduled today" section — tasks scheduled for today
          that don't have a time block yet. Click to arm, then click a
          row in the grid below to drop them at that time (30min default). */}
      <Show when={unscheduled().length > 0}>
        <UnscheduledSticky
          items={unscheduled()}
          armedRef={armedRef()}
          onClick={onUnscheduledClick}
        />
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
          // Ask OpenTUI to skip rendering rows that fall outside the
          // scrollbox viewport. Combined with the rowMap slicing above
          // (when a sticky section is present), this stops the grid
          // from painting `07` / `······` content behind the sticky.
          viewportCulling: true,
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
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
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
              leftIsArmed(),
              leftIsBlock(),
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
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
              rightIsArmed(),
              rightIsBlock(),
            ),
          }}
          onMouseDown={cellMouseDown(right().entry)}
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
    // Hour anchor row: '07  ──────────' — number + horizontal grid line.
    // Gives the eye a strong tick mark to scan against.
    const label = (r.hour ?? 0).toString().padStart(2, "0");
    return (
      <>
        <span style={{ fg: T.textDim }}>{label}{" "}</span>
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
          {/* Bottom edge of the block — clear visual cap. */}
          <span style={{ fg: bColor }}>{"─".repeat(120)}</span>
        </Show>
      </>
    );
  }
  return <span>{" "}</span>;
}

// ─── Unscheduled sticky list ─────────────────────────────────────────────────

interface UnscheduledStickyProps {
  items: UnscheduledItem[];
  armedRef: TaskRef | undefined;
  onClick: (item: UnscheduledItem) => void;
}

function UnscheduledSticky(props: UnscheduledStickyProps) {
  // The whole list goes through a scrollbox capped at UNSCHED_VISIBLE rows
  // tall — when there are more items, the user scrolls the inner box with
  // the mouse wheel. Keeps the timeline grid below visible at all times.
  const scrollableHeight = () =>
    Math.min(props.items.length, UNSCHED_VISIBLE);

  const isArmed = (item: UnscheduledItem): boolean => {
    const a = props.armedRef;
    if (!a) return false;
    return (
      a.boardPath === item.ref.boardPath &&
      a.columnIndex === item.ref.columnIndex &&
      a.taskIndex === item.ref.taskIndex
    );
  };

  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
          <span style={{ fg: T.textDim, attributes: ATTR.bold }}>
            {"◦ Unscheduled · "}{props.items.length}
          </span>
          <Show when={props.items.length > UNSCHED_VISIBLE}>
            <span style={{ fg: T.textDim }}>
              {"  (scroll for more)"}
            </span>
          </Show>
        </text>
      </box>
      <scrollbox
        style={{
          width: "100%",
          height: scrollableHeight(),
          scrollX: false,
          scrollY: true,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: { visible: false },
          viewportCulling: true,
        }}
      >
        <For each={props.items}>
          {(item) => {
            const armed = () => isArmed(item);
            const priorityGlyph =
              item.task.priority !== "none"
                ? PRIORITY_GLYPH[item.task.priority] + " "
                : "";
            return (
              <box
                style={{
                  flexDirection: "row",
                  height: 1,
                  paddingLeft: 1,
                  paddingRight: 1,
                  backgroundColor: armed() ? T.warmDim : undefined,
                }}
                onMouseDown={() => props.onClick(item)}
              >
                <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
                  <span style={{ fg: armed() ? T.warm : T.textDim }}>
                    {armed() ? "⤤ " : "  "}
                  </span>
                  <Show when={priorityGlyph}>
                    <span style={{ fg: PRIORITY_COLOR[item.task.priority] }}>
                      {priorityGlyph}
                    </span>
                  </Show>
                  <span style={{ fg: T.text }}>
                    {tailTruncate(item.task.displayTitle, 36)}
                  </span>
                </text>
              </box>
            );
          }}
        </For>
      </scrollbox>
      <box style={{ flexDirection: "row", height: 1 }}>
        <text wrapMode="none">
          <span style={{ fg: T.border }}>{"─".repeat(120)}</span>
        </text>
      </box>
    </box>
  );
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
): string | undefined {
  if (isArmed) return T.warmDim;
  if (isCursor) return T.cardBgCursor;
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
void TOTAL_ROWS;
