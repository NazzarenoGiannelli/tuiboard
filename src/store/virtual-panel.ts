/**
 * Today/Tomorrow virtual panel — cross-board aggregation.
 *
 * Builds the always-on left column shown in the kanban view. Ported from
 * the Python kanban.py `_virtual_today_items` + `_build_virtual_panel`.
 *
 * Structure:
 *
 *   ● Overdue
 *     ⏰ Agenda      ← time-blocked, chronological
 *     🔺 Priority    ← unscheduled priority, alpha
 *     Altro          ← rest, grouped by [board·col]
 *   ● Today
 *     ⏰ Agenda
 *     🔺 Priority
 *     Altro
 *   → Tomorrow
 *     ⏰ Agenda
 *     🔺 Priority
 *     Altro
 *
 * Items are tagged with their source `[board·col]` so context isn't lost.
 */

import { isoToday, isoTomorrow, type TaskRef } from "~/store/index";
import { isTask } from "~/parser/markdown";
import type { Board, Task } from "~/types";

export type VirtualSection = "overdue" | "today" | "tomorrow";
export type VirtualBucket = "agenda" | "priority" | "rest";

export interface VirtualItem {
  ref: TaskRef;
  task: Task;
  boardName: string;
  columnName: string;
  section: VirtualSection;
  bucket: VirtualBucket;
}

export interface VirtualGroup {
  section: VirtualSection;
  bucket: VirtualBucket;
  items: VirtualItem[];
}

/**
 * Compute the flat list of virtual items across all boards.
 * Order: overdue (agenda → priority → rest) → today (...) → tomorrow (...).
 */
export function buildVirtualItems(boards: Board[]): VirtualItem[] {
  const today = isoToday();
  const tomorrow = isoTomorrow();

  const overdue: VirtualItem[] = [];
  const todayItems: VirtualItem[] = [];
  const tomorrowItems: VirtualItem[] = [];

  for (const board of boards) {
    for (let ci = 0; ci < board.columns.length; ci++) {
      const col = board.columns[ci]!;
      let taskIndex = 0;
      for (const child of col.children) {
        if (!isTask(child)) continue;
        const task = child;
        const date = task.scheduled ?? task.due;
        const idx = taskIndex++;
        if (!date) continue;
        const ref: TaskRef = {
          boardPath: board.filepath,
          columnIndex: ci,
          taskIndex: idx,
        };
        const common = {
          ref,
          task,
          boardName: board.name,
          columnName: col.name,
        };
        if (!task.done && date < today) {
          overdue.push({ ...common, section: "overdue", bucket: bucketOf(task) });
        } else if (date === today) {
          todayItems.push({ ...common, section: "today", bucket: bucketOf(task) });
        } else if (date === tomorrow) {
          tomorrowItems.push({ ...common, section: "tomorrow", bucket: bucketOf(task) });
        }
      }
    }
  }

  return [...reorganize(overdue), ...reorganize(todayItems), ...reorganize(tomorrowItems)];
}

function bucketOf(t: Task): VirtualBucket {
  if (t.timeBlock) return "agenda";
  if (t.priority !== "none") return "priority";
  return "rest";
}

function reorganize(raw: VirtualItem[]): VirtualItem[] {
  const agenda = raw.filter((x) => x.bucket === "agenda");
  const priority = raw.filter((x) => x.bucket === "priority");
  const rest = raw.filter((x) => x.bucket === "rest");
  agenda.sort((a, b) => (a.task.timeBlock!.startMin) - (b.task.timeBlock!.startMin));
  priority.sort((a, b) => a.task.displayTitle.localeCompare(b.task.displayTitle));
  // rest: preserve encounter order (already sorted by board/col iteration)
  return [...agenda, ...priority, ...rest];
}

/**
 * Group consecutive items by (section, bucket) for rendering with sub-headers.
 * Empty buckets are omitted; sections with no items are omitted entirely.
 */
export function groupVirtualItems(items: VirtualItem[]): VirtualGroup[] {
  const groups: VirtualGroup[] = [];
  let current: VirtualGroup | undefined;
  for (const item of items) {
    if (!current || current.section !== item.section || current.bucket !== item.bucket) {
      current = { section: item.section, bucket: item.bucket, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
