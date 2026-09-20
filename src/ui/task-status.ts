/**
 * What a task *is* right now (done, overdue, today…) and what color says so.
 *
 * Pulled out of TaskRow.tsx so the rules can be tested directly: they encode
 * every precedence decision the board and planner rows rely on, and a
 * component is an awkward place to assert them from.
 */

import { isoToday, isoTomorrow } from "~/store/index";
import { T } from "~/ui/glyphs";
import type { Task } from "~/types";

export type TaskStatus =
  | "done"
  | "overdue"
  | "today"
  | "tomorrow"
  | "future"
  | "unscheduled";

/**
 * Calendar days from `from` to `to` (both `YYYY-MM-DD`). UTC arithmetic, so
 * a DST change can't turn a day into 23 or 25 hours and round the wrong way.
 */
export function daysBetweenIso(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/**
 * How late is late. Nazz resets most tasks to Today each morning, so being a
 * day or two past is ordinary drift — a Friday task looked at again on Monday
 * is already 3 days old without anyone ignoring it. Five days means the task
 * has survived a weekend *and* working days of deliberate skipping, which is
 * the thing worth seeing from across the board.
 *
 * Measured against the real boards when this landed (117 open tasks, 13
 * overdue): 3 days would have painted 8 of the 13 — the whole weekend —
 * while the spec's placeholder of 7 would have painted none.
 */
export const OVERDUE_HEAVY_AFTER_DAYS = 5;

/** Two bands, not a gradient: "a little" vs "a lot". */
export function overdueBand(scheduled: string, today: string): "light" | "heavy" {
  return daysBetweenIso(scheduled, today) >= OVERDUE_HEAVY_AFTER_DAYS ? "heavy" : "light";
}

export function statusOf(t: Task, today = isoToday(), tomorrow = isoTomorrow()): TaskStatus {
  if (t.done) return "done";
  const d = t.scheduled ?? t.due;
  if (!d) return "unscheduled";
  if (d < today) return "overdue";
  if (d === today) return "today";
  if (d === tomorrow) return "tomorrow";
  return "future";
}

/** The overdue color for this task: louder once it's been late a while. */
function overdueColor(task: Task, today: string): string {
  const d = task.scheduled ?? task.due;
  return d && overdueBand(d, today) === "heavy" ? T.overdueHeavy : T.overdue;
}

export function titleColorFor(
  task: Task,
  status: TaskStatus,
  today = isoToday(),
): string | undefined {
  // Precedence: done (green) > overdue (red) > priority (orange) > today
  // (pale yellow) > tomorrow (grey) > default. The orange now *means*
  // "priority flag" — only tasks with a priority get it; everything scheduled
  // today is the calm pale yellow instead.
  if (status === "done") return T.done;
  if (status === "overdue") return overdueColor(task, today);
  // Tomorrow is uniformly grey — even priority tasks — so everything set for
  // tomorrow reads consistently as "later, de-emphasized".
  if (status === "tomorrow") return T.textDim;
  if (task.priority !== "none") return T.today;
  if (status === "today") return T.todayPale;
  // future / unscheduled: terminal default fg (looks right on any theme).
  return T.text;
}

export function suffixColorFor(
  task: Task,
  status: TaskStatus,
  today = isoToday(),
): string | undefined {
  if (status === "done") return T.textDone;
  // The date suffix carries the same band as the title, so a row doesn't read
  // as two different degrees of late at once.
  if (status === "overdue") return overdueColor(task, today);
  if (status === "today") return T.todayPale;
  if (status === "tomorrow") return T.textDim;
  if (status === "future") return T.scheduled;
  return T.textDim;
}
