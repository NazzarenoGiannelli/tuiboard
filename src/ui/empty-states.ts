/**
 * What an empty zone says. A new user meets every zone empty, so each one says what
 * to do next instead of "nothing". Kept in one place so the copy is easy to read,
 * review and test.
 */

export const BOARD_EMPTY = "Press n to add your first task";

export const PLANNER_EMPTY = [
  "Nothing scheduled yet.",
  "Give a task a date with s, or press t to bring one to today.",
] as const;

export const AGENTS_EMPTY = [
  "No sessions yet.",
  "tuiboard reads Claude Code, Codex, OpenCode and Pi from disk: start one and it shows up here.",
] as const;

export const CALENDAR_HINT = "Optional: connect a calendar, S for setup";

/** Only while it can still help: no calendar, and nothing yet on the day being looked at. */
export function showCalendarHint(opts: {
  calendarsConfigured: boolean;
  dayHasTasks: boolean;
  dayHasEvents: boolean;
}): boolean {
  return !opts.calendarsConfigured && !opts.dayHasTasks && !opts.dayHasEvents;
}
