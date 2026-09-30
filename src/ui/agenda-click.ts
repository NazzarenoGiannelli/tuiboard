/**
 * What a mouse click does on a task in the Agenda.
 *
 * A click used to arm whatever it touched, so merely pointing at a block made
 * it the armed one: Enter then meant "keep the placement" instead of "done", and
 * the thing that had to be selected to be completed was always already armed.
 *
 * Now there are two phases. With nothing armed, one click selects and two arm:
 * selecting is how you look at a task, arming is how you decide to move it. Once
 * something is armed every click is about it: one click puts it where you
 * clicked (even inside its own body), two keep it there and let go.
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

/**
 * - `select`  move the cursor to it
 * - `arm`     arm it (a tray task is also placed, like `c`)
 * - `place`   put the armed task where this block starts
 * - `grab`    a press on the armed block itself: what it does (move to the row
 *             clicked, or follow a drag) depends on what happens next, so the
 *             view decides on release
 * - `keep`    leave the armed task where it is and let go, like Enter
 */
export type ClickIntent = "select" | "arm" | "place" | "grab" | "keep";

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
  if (ctx.armed === "none") {
    return ctx.kind === "double" || ctx.armMode ? "arm" : "select";
  }
  if (ctx.target === "tray") {
    // A tray row has no time to place at, so a click there is about the tray
    // task: two arm it (switching from the armed one), two on the armed one keep.
    if (ctx.kind === "double") return ctx.armed === "same" ? "keep" : "arm";
    return ctx.armMode ? "arm" : "select";
  }
  // On the grid: two clicks keep the armed task where the first one put it.
  if (ctx.kind === "double") return "keep";
  return ctx.armed === "same" ? "grab" : "place";
}
