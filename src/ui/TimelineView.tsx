/**
 * Vertical 24h timeline column.
 *
 * Renders today's time-blocked tasks as bands stacked on a per-15-minute
 * grid. Hour rows show their hour label on the left margin; the current
 * time is overlaid as a colored "now" line.
 *
 * The cursor (j/k navigation) walks the entry list in chronological order.
 * Pressing Enter on a block bounces the kanban cursor to its source task.
 * Mouse click on a band does the same in one tap.
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
  countOverlaps,
  formatHm,
  type RowMapEntry,
  type TimelineEntry,
} from "~/store/timeline";
import { ATTR, PRIORITY_COLOR, T, boardColor } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

interface TimelineViewProps {
  store: TuiStore;
  width?: number;
}

const ROW_ID_PREFIX = "tuiboard-tl-row-";

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
  // We watch a signal that ticks every 60s.
  const nowMin = useNowMin();
  const rowMap = createMemo(() => buildRowMap(entries(), nowMin()));
  const overlaps = createMemo(() => countOverlaps(entries()));

  let scrollBoxRef: ScrollBoxLike | undefined;

  // Scroll-to-now on mount AND when the cursor moves to a row outside the
  // viewport. setTimeout(0) waits for OpenTUI to commit layout before the
  // scroll call (same pattern as BoardView).
  onMount(() => {
    setTimeout(() => {
      try {
        const target = nowRowId(rowMap());
        if (target) scrollBoxRef?.scrollChildIntoView(target);
      } catch {
        // First-paint races — harmless.
      }
    }, 50);
  });

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
      <Show when={overlaps() > 0}>
        <text wrapMode="none" truncate>
          <span style={{ fg: T.bannerWarn }}>
            {`⚠ ${overlaps()} time-block overlap${overlaps() === 1 ? "" : "s"}`}
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
        <For each={rowMap()}>
          {(row, i) => (
            <box id={rowIdFor(i())}>
              <TimelineRow
                row={row}
                rowIndex={i()}
                isCursor={
                  isActive() &&
                  row.entry !== undefined &&
                  entries().indexOf(row.entry) === cursor()
                }
                onClickEntry={(entry) => {
                  const idx = entries().indexOf(entry);
                  if (idx >= 0) {
                    props.store.setActiveZone("timeline");
                    props.store.setCursor(0, idx);
                  }
                  jumpToKanban(props.store, entry.ref);
                }}
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
  row: RowMapEntry;
  rowIndex: number;
  isCursor: boolean;
  onClickEntry: (entry: TimelineEntry) => void;
}

function TimelineRow(props: TimelineRowProps) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        backgroundColor: props.isCursor ? T.cardBgCursor : undefined,
      }}
      onMouseDown={
        props.row.entry
          ? (() => props.onClickEntry(props.row.entry!))
          : undefined
      }
    >
      <text wrapMode="none" truncate style={{ flexGrow: 1 }}>
        <RowContent row={props.row} />
      </text>
    </box>
  );
}

function RowContent(props: { row: RowMapEntry }) {
  const r = props.row;
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
        <span style={{ fg: T.textDim }}>{"   "}</span>
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
        <span style={{ fg: T.textDim }}>{"   "}</span>
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
        <span style={{ fg: T.textDim }}>{"   "}</span>
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
    return (
      <>
        <span style={{ fg: T.textDim }}>{"   "}</span>
        <span style={{ fg: bColor }}>{"│"}</span>
      </>
    );
  }
  return <span>{" "}</span>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowIdFor(rowIndex: number): string {
  return `${ROW_ID_PREFIX}${rowIndex}`;
}

function nowRowId(rowMap: RowMapEntry[]): string | undefined {
  for (let i = 0; i < rowMap.length; i++) {
    if (rowMap[i]!.kind === "now") return rowIdFor(i);
  }
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
