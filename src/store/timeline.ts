/**
 * Timeline view — derives a per-day vertical schedule from kanban tasks.
 *
 * The store is "pure": given the current boards + a date string, it returns
 * the list of `TimelineEntry` (one per scheduled+time-blocked task) and a
 * pre-computed `RowMap` ready to be rendered as a 64-row vertical column.
 *
 * Read-only by design — edits (resize, move, drag-to-schedule) go through
 * the kanban store's existing setTimeBlock / setScheduled actions.
 */

import { isTask } from "~/parser/markdown";
import type { Board, Task } from "~/types";
import type { TaskRef } from "~/store/index";

/** First hour rendered in the timeline column (inclusive). */
export const DAY_START_HOUR = 7;
/** Last hour rendered in the timeline column (exclusive). */
export const DAY_END_HOUR = 23;
/** Vertical resolution: each row = N minutes. */
export const MINS_PER_ROW = 15;
/** Total renderable rows. (23-7)*60/15 = 64. */
export const TOTAL_ROWS =
  ((DAY_END_HOUR - DAY_START_HOUR) * 60) / MINS_PER_ROW;
/**
 * Minimum block height in rows. The grid is a ruler: a block starts on the row
 * of its first minute and a closing rule sits on the row of its end, so one body
 * row is a quarter of an hour and the rule below it comes on top.
 */
export const MIN_BLOCK_ROWS = 1;

interface BaseEntry {
  startMin: number;
  endMin: number;
  /** Vertical position in the row grid (clipped to [0, TOTAL_ROWS)). */
  startRow: number;
  /** Exclusive end row. */
  endRow: number;
}

/** A time-blocked task placed on the grid. */
export interface TaskTimelineEntry extends BaseEntry {
  kind: "task";
  ref: TaskRef;
  task: Task;
  boardName: string;
  boardIndex: number;
  columnName: string;
}

/** A read-only calendar event (Google / Microsoft) placed on the grid. */
export interface CalTimelineEntry extends BaseEntry {
  kind: "calendar";
  title: string;
  color: string;
  source: "google" | "microsoft";
  /** Google calendar id (Google events only) — needed to edit/delete. */
  calendarId?: string;
  /** Google event id (Google events only) — needed to edit/delete. */
  eventId?: string;
  /** True when this event can be edited/deleted from tuiboard. */
  editable?: boolean;
}

export type TimelineEntry = TaskTimelineEntry | CalTimelineEntry;

/**
 * Map an event's start/end (minutes since midnight) to grid rows, or null if
 * it falls entirely outside the rendered [DAY_START_HOUR, DAY_END_HOUR] window.
 */
function rowsFor(
  startMin: number,
  endMin: number,
): { startRow: number; endRow: number } | null {
  const windowStart = DAY_START_HOUR * 60;
  const windowEnd = DAY_END_HOUR * 60;
  if (endMin <= windowStart || startMin >= windowEnd) return null;
  const startRow = Math.floor((startMin - windowStart) / MINS_PER_ROW);
  const naturalHeight = Math.max(
    MIN_BLOCK_ROWS,
    Math.round((endMin - startMin) / MINS_PER_ROW),
  );
  const endRow = startRow + naturalHeight;
  return { startRow: Math.max(0, startRow), endRow: Math.min(TOTAL_ROWS, endRow) };
}

/**
 * `edge` is the rule that closes a block, drawn on the row of its end time (the
 * row below its last body row). It is not part of the block's fill.
 */
export type RowKind = "empty" | "hour" | "head" | "body" | "fill" | "edge" | "now";

export interface RowMapEntry {
  kind: RowKind;
  /** Hour 0-23 for "hour" kind. */
  hour?: number;
  /** Source entry for head/body/fill kinds. */
  entry?: TimelineEntry;
  /** Now-marker minute (only for "now"). */
  nowMin?: number;
  /**
   * Head rows only: the block starts on the row where the one above ends in the
   * same lane, so the line between them is shared (drawn with T-junction corners).
   */
  joined?: boolean;
}

/**
 * A row of the timeline grid, paired by lane. The left lane carries the
 * primary content (hour labels, single-lane blocks, the now marker); the
 * right lane is set only when two blocks overlap, in which case the
 * renderer splits the row horizontally into two side-by-side cells.
 */
export interface RowMapPair {
  left: RowMapEntry;
  right: RowMapEntry;
  /**
   * The row belongs to a group of overlapping blocks, so it is drawn as two lanes
   * even where only one of them is occupied. A block keeps its lane, and so its
   * width, from its top edge to its bottom edge: without this a box was a full
   * lane wide on the rows where it was alone and half that where a neighbour
   * joined, and could not close properly.
   */
  split?: boolean;
}

export interface BuildRowMapResult {
  rows: RowMapPair[];
  /** Number of entries that couldn't be placed (3rd+ block in an overlap). */
  overflow: number;
}

/**
 * Build the flat list of time-blocked tasks for the given ISO date.
 * Tasks must:
 *   - have task.timeBlock
 *   - have task.scheduled === date (we ignore `due` for now; calendar-style
 *     time-blocking is always scheduled, not due)
 *
 * Completed tasks ARE included (rendered green + checked) so the timeline
 * doubles as a record of what actually got done in each slot, not just what's
 * still pending.
 *
 * Sorted ascending by startMin so head/body/fill rendering can claim rows
 * in chronological order.
 */
export function buildTimelineEntries(
  boards: Board[],
  date: string,
): TaskTimelineEntry[] {
  const out: TaskTimelineEntry[] = [];
  for (let bi = 0; bi < boards.length; bi++) {
    const board = boards[bi]!;
    for (let ci = 0; ci < board.columns.length; ci++) {
      const col = board.columns[ci]!;
      let taskIndex = 0;
      for (const child of col.children) {
        if (!isTask(child)) continue;
        const idx = taskIndex++;
        const t = child;
        // Done tasks stay on the timeline (shown green + checked) — the day's
        // schedule is also a log of what got done.
        if (!t.timeBlock) continue;
        if (t.scheduled !== date) continue;

        const { startMin, endMin } = t.timeBlock;
        const rows = rowsFor(startMin, endMin);
        if (!rows) continue; // entirely outside the rendered window

        out.push({
          kind: "task",
          ref: {
            boardPath: board.filepath,
            columnIndex: ci,
            taskIndex: idx,
          },
          task: t,
          boardName: board.name,
          boardIndex: bi,
          columnName: col.name,
          startMin,
          endMin,
          startRow: rows.startRow,
          endRow: rows.endRow,
        });
      }
    }
  }
  out.sort((a, b) => a.startMin - b.startMin);
  return out;
}

/**
 * Turn read-only calendar events (already mapped to minutes-since-midnight for
 * the target day) into grid entries, clipped to the rendered window.
 */
export function buildCalendarEntries(
  events: Array<{
    title: string;
    startMin: number;
    endMin: number;
    color: string;
    source: "google" | "microsoft";
    calendarId?: string;
    eventId?: string;
    editable?: boolean;
  }>,
): CalTimelineEntry[] {
  const out: CalTimelineEntry[] = [];
  for (const e of events) {
    const rows = rowsFor(e.startMin, e.endMin);
    if (!rows) continue;
    out.push({
      kind: "calendar",
      title: e.title,
      color: e.color,
      source: e.source,
      calendarId: e.calendarId,
      eventId: e.eventId,
      editable: e.editable,
      startMin: e.startMin,
      endMin: e.endMin,
      startRow: rows.startRow,
      endRow: rows.endRow,
    });
  }
  out.sort((a, b) => a.startMin - b.startMin);
  return out;
}

/**
 * Place entries onto the TOTAL_ROWS grid, using up to 2 lanes to render
 * overlapping blocks side-by-side. A third+ overlapping block on the same
 * row is dropped and counted as `overflow` so the renderer can show a
 * banner.
 *
 * Placement strategy (mirrors timeline.py):
 *   - Entries are processed in start-time order (already pre-sorted).
 *   - Each entry tries lane 0 first; if that lane is still occupied by an
 *     earlier block, it tries lane 1; otherwise it counts as overflow.
 *   - The `now` marker always lands on lane 0 and clears lane 1 for that
 *     row — it's the single most important visual cue and shouldn't be
 *     half-hidden behind a block band.
 */
export function buildRowMap(
  entries: TimelineEntry[],
  nowMin: number,
): BuildRowMapResult {
  const left: RowMapEntry[] = Array.from({ length: TOTAL_ROWS }, () => ({
    kind: "empty",
  }));
  const right: RowMapEntry[] = Array.from({ length: TOTAL_ROWS }, () => ({
    kind: "empty",
  }));

  // Hour labels live on the left lane only.
  for (let r = 0; r < TOTAL_ROWS; r++) {
    if ((r * MINS_PER_ROW) % 60 === 0) {
      left[r] = {
        kind: "hour",
        hour: DAY_START_HOUR + Math.floor((r * MINS_PER_ROW) / 60),
      };
    }
  }

  // Per-lane "next free row" tracker. -1 means the lane has never held a
  // block yet, so any startRow is admissible.
  const laneEndRow: [number, number] = [-1, -1];
  let overflow = 0;
  /** Where each block went, to work out the groups of overlapping ones afterwards. */
  const placed: Array<{ start: number; end: number; lane: 0 | 1 }> = [];

  for (const entry of entries) {
    const start = Math.max(0, entry.startRow);
    const end = Math.min(TOTAL_ROWS, entry.endRow);
    if (end <= start) continue;

    let lane: 0 | 1;
    if (start >= laneEndRow[0]) lane = 0;
    else if (start >= laneEndRow[1]) lane = 1;
    else {
      overflow++;
      continue;
    }

    placed.push({ start, end, lane });
    const target = lane === 0 ? left : right;
    const joined = laneEndRow[lane] === start;
    laneEndRow[lane] = end;
    for (let r = start; r < end; r++) {
      if (r === start) target[r] = { kind: "head", entry, joined };
      else if (r === start + 1) target[r] = { kind: "body", entry };
      else target[r] = { kind: "fill", entry };
    }
    // The closing rule goes on the row of the block's end time — unless that row
    // is taken (the next block starts right there and its first row is the rule).
    if (end < TOTAL_ROWS && (target[end]!.kind === "empty" || target[end]!.kind === "hour")) {
      target[end] = { kind: "edge", entry };
    }
  }

  // Now marker (only when in the visible window). Force both lanes so the
  // renderer can treat it as a full-width row regardless of overlap state.
  const windowStart = DAY_START_HOUR * 60;
  const windowEnd = DAY_END_HOUR * 60;
  if (nowMin >= windowStart && nowMin < windowEnd) {
    const nowRow = Math.floor((nowMin - windowStart) / MINS_PER_ROW);
    if (nowRow >= 0 && nowRow < TOTAL_ROWS) {
      left[nowRow] = { kind: "now", nowMin };
      right[nowRow] = { kind: "empty" };
    }
  }

  // Groups of overlapping blocks: one that starts before the group's last row ends
  // belongs to it, and so does one that starts exactly where it ends when the group
  // is already two lanes wide (it would otherwise start on a half-width row). A
  // group that used the second lane is two lanes wide from its first row to the
  // row of its last closing rule.
  const split: boolean[] = new Array(TOTAL_ROWS).fill(false);
  let gStart = -1;
  let gEnd = -1;
  let gTwoLanes = false;
  const closeGroup = () => {
    if (!gTwoLanes) return;
    for (let r = gStart; r <= Math.min(gEnd, TOTAL_ROWS - 1); r++) split[r] = true;
  };
  for (const p of placed) {
    if (gStart >= 0 && (p.start < gEnd || (p.start === gEnd && gTwoLanes))) {
      gEnd = Math.max(gEnd, p.end);
      if (p.lane === 1) gTwoLanes = true;
    } else {
      closeGroup();
      gStart = p.start;
      gEnd = p.end;
      gTwoLanes = p.lane === 1;
    }
  }
  closeGroup();

  const rows: RowMapPair[] = left.map((l, i) => ({ left: l, right: right[i]!, split: split[i] }));
  return { rows, overflow };
}

/**
 * Count time-block overlaps in the entry list. Used to surface a banner so
 * the user knows their schedule has conflicts (the MVP last-writer-wins
 * render would otherwise just silently hide some blocks).
 */
export function countOverlaps(entries: TimelineEntry[]): number {
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (a.startMin < b.endMin && b.startMin < a.endMin) count++;
    }
  }
  return count;
}

export interface UnscheduledItem {
  ref: TaskRef;
  task: Task;
  boardName: string;
  boardIndex: number;
  columnName: string;
}

/**
 * Tasks scheduled for the given date but without a time block — the ones
 * shown in the "To place" tray at the top of the Agenda, which is also the top
 * of its cursor: rows 0..n-1 are these, the time-blocked entries follow.
 * Sorted by board declaration order, then by encounter in the column
 * (preserves the user's manual ordering inside each kanban column).
 */
export function buildUnscheduledToday(
  boards: Board[],
  date: string,
): UnscheduledItem[] {
  const out: UnscheduledItem[] = [];
  for (let bi = 0; bi < boards.length; bi++) {
    const board = boards[bi]!;
    for (let ci = 0; ci < board.columns.length; ci++) {
      const col = board.columns[ci]!;
      let taskIndex = 0;
      for (const child of col.children) {
        if (!isTask(child)) continue;
        const idx = taskIndex++;
        const t = child;
        if (t.done) continue;
        if (t.timeBlock) continue;
        if (t.scheduled !== date) continue;
        out.push({
          ref: { boardPath: board.filepath, columnIndex: ci, taskIndex: idx },
          task: t,
          boardName: board.name,
          boardIndex: bi,
          columnName: col.name,
        });
      }
    }
  }
  return out;
}

/** Length of a block placed without one: half an hour. */
export const DEFAULT_BLOCK_MIN = 30;

/** Where a placement starts on a day that has no clock, i.e. any day but today. */
export const PLACE_FROM_HOUR = 9;

/**
 * The first free stretch of `durationMin` at or after `fromMin`, on the grid's
 * 15-minute steps and inside the rendered day. "Free" means clear of every
 * `busy` span: blocks already placed and calendar events.
 *
 * Nothing free after `fromMin` (late evening, a full day) falls back to the
 * first free stretch from the start of the day, and failing that to where it
 * was asked to start: the caller gets a slot to nudge either way, never nothing.
 */
export function findFreeSlot(
  busy: ReadonlyArray<{ startMin: number; endMin: number }>,
  fromMin: number,
  durationMin: number = DEFAULT_BLOCK_MIN,
): { startMin: number; endMin: number } {
  const dayStart = DAY_START_HOUR * 60;
  const dayEnd = DAY_END_HOUR * 60;
  const step = MINS_PER_ROW;
  const firstFree = (from: number) => {
    for (let start = Math.ceil(Math.max(from, dayStart) / step) * step; start + durationMin <= dayEnd; start += step) {
      const end = start + durationMin;
      if (!busy.some((b) => start < b.endMin && b.startMin < end)) return { startMin: start, endMin: end };
    }
    return undefined;
  };
  const slot = firstFree(fromMin) ?? firstFree(dayStart);
  if (slot) return slot;
  const startMin = Math.min(Math.max(fromMin, dayStart), dayEnd - durationMin);
  return { startMin, endMin: startMin + durationMin };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Human label for the Agenda's viewed day. Relative words for the near days
 * (Today / Tomorrow / Yesterday), else a "Mon 02 Jun" stamp. `dateIso` is the
 * already-resolved date so this stays pure (no clock access).
 */
export function formatAgendaDay(offset: number, dateIso: string): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return `${WEEKDAYS[dt.getDay()]} ${String(d).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]}`;
}

/** Format minutes since midnight as "HH:MM". */
export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
