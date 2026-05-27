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
/** Minimum block height in rows — single-row blocks are unreadable. */
export const MIN_BLOCK_ROWS = 2;

export interface TimelineEntry {
  ref: TaskRef;
  task: Task;
  boardName: string;
  boardIndex: number;
  columnName: string;
  startMin: number;
  endMin: number;
  /** Vertical position in the row grid (clipped to [0, TOTAL_ROWS)). */
  startRow: number;
  /** Exclusive end row. */
  endRow: number;
}

export type RowKind = "empty" | "hour" | "head" | "body" | "fill" | "now";

export interface RowMapEntry {
  kind: RowKind;
  /** Hour 0-23 for "hour" kind. */
  hour?: number;
  /** Source entry for head/body/fill kinds. */
  entry?: TimelineEntry;
  /** Now-marker minute (only for "now"). */
  nowMin?: number;
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
}

export interface BuildRowMapResult {
  rows: RowMapPair[];
  /** Number of entries that couldn't be placed (3rd+ block in an overlap). */
  overflow: number;
}

/**
 * Build the flat list of time-blocked tasks for the given ISO date.
 * Tasks must be:
 *   - non-done
 *   - have task.timeBlock
 *   - have task.scheduled === date (we ignore `due` for now; calendar-style
 *     time-blocking is always scheduled, not due)
 *
 * Sorted ascending by startMin so head/body/fill rendering can claim rows
 * in chronological order.
 */
export function buildTimelineEntries(
  boards: Board[],
  date: string,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
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
        if (!t.timeBlock) continue;
        if (t.scheduled !== date) continue;

        const { startMin, endMin } = t.timeBlock;
        const windowStart = DAY_START_HOUR * 60;
        const windowEnd = DAY_END_HOUR * 60;
        // Skip blocks that fall entirely outside the rendered window.
        if (endMin <= windowStart || startMin >= windowEnd) continue;

        const startRow = Math.floor((startMin - windowStart) / MINS_PER_ROW);
        const naturalHeight = Math.max(
          MIN_BLOCK_ROWS,
          Math.floor((endMin - startMin) / MINS_PER_ROW),
        );
        const endRow = startRow + naturalHeight;

        out.push({
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
          startRow: Math.max(0, startRow),
          endRow: Math.min(TOTAL_ROWS, endRow),
        });
      }
    }
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

    const target = lane === 0 ? left : right;
    laneEndRow[lane] = end;
    for (let r = start; r < end; r++) {
      if (r === start) target[r] = { kind: "head", entry };
      else if (r === start + 1) target[r] = { kind: "body", entry };
      else target[r] = { kind: "fill", entry };
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

  const rows: RowMapPair[] = left.map((l, i) => ({ left: l, right: right[i]! }));
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

/** Format minutes since midnight as "HH:MM". */
export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
