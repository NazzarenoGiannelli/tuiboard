/**
 * What a mouse click does on a task in the Agenda.
 *
 * A click used to arm whatever it touched, so merely pointing at a block made
 * it the armed one: Enter then meant "keep the placement" instead of "done", and
 * the thing that had to be selected to be completed was always already armed.
 * Now one click selects, two arm: selecting is how you look at a task, arming
 * is how you decide to move it.
 *
 * Pure (the clock is a parameter), so the rules are testable without a terminal.
 */

export type ClickKind = "single" | "double";

/**
 * Tell a double click from two single ones: the same target twice within
 * `windowMs`. A double click resets the tracker, so a third click starts over as
 * a single one. The terminal reports each press separately, with no click count.
 */
export function createClickTracker(now: () => number = Date.now, windowMs: number = 350) {
  let last: { key: string; at: number } | undefined;
  return {
    click(key: string): ClickKind {
      const at = now();
      const double = !!last && last.key === key && at - last.at <= windowMs;
      last = double ? undefined : { key, at };
      return double ? "double" : "single";
    },
  };
}

export type ClickIntent = "select" | "arm" | "disarm" | "place";

export interface ClickContext {
  kind: ClickKind;
  /** Arm mode is on: a deliberate "every click arms" mode the user asked for. */
  armMode: boolean;
  /** Is a task armed, and is it the one clicked? */
  armed: "none" | "same" | "other";
  /** A block on the grid, or a row of the "To place" tray. */
  target: "band" | "tray";
}

export function clickIntent(ctx: ClickContext): ClickIntent {
  // With another task armed, a click on a block places it at that block's start
  // (stacking two blocks at the same minute). The tray has no time to place at.
  if (ctx.target === "band" && ctx.armed === "other") return "place";
  const arms = ctx.kind === "double" || ctx.armMode;
  if (!arms) return "select";
  return ctx.armed === "same" ? "disarm" : "arm";
}
