/**
 * The keyboard cheat-sheet on the bottom bar, chosen from what the user is
 * doing rather than one line for every moment.
 *
 * The bar truncates rather than wraps, so each line has to say what matters
 * *now* and still be readable at 60 columns: a hint cut to `⏎ don…` is worse
 * than no hint. Pure, so what each state says is testable.
 */

export interface HintContext {
  zone: "planner" | "board" | "timeline" | "agents";
  singlePane: boolean;
  /** A task is armed in the Agenda: its block can be moved, resized, kept, undone. */
  armed: boolean;
  /** The armed task is already on the grid. False: it waits for a click or a key to say where. */
  placed?: boolean;
  /** Arm mode is on with nothing armed yet: waiting for a task, then a slot. */
  armMode: boolean;
  /**
   * A dialog is open: its own keys are on screen, so the bar should not show the dashboard's.
   * "mandatory" is the first-run wizard, which cannot be dismissed (Esc does nothing);
   * "info" is a read-only dialog (Setup), where Enter confirms nothing and Esc closes it.
   */
  modal?: "open" | "mandatory" | "info";
}

/**
 * Curated cheat-sheet: only the keys that keep you unstuck (move, switch
 * zone/board, help, quit) plus the highest-frequency, on-brand actions (done,
 * new, schedule). Everything else — zoom, toggles, multi-select,
 * edit/assign/archive/delete, undo — lives in `?`.
 */
export const HINTS_FULL =
  "hjkl ↑↓←→ move · Tab board · ⇧Tab zone · ⏎ done · n new · t today · b block · c schedule · r refresh · z zoom · ? help · q quit";

/** Single-pane: walking the ring, jumping zones, completing, and the way out. */
export const HINTS_COMPACT = "hl pane · ⇧Tab zone · ⏎ done · ? help · q quit";

/** A block is armed: the four things that apply, and the safe way out. */
export const HINTS_ARMED = "j/k move · +/- length · ⏎ or 2× click keep · esc undo";

/** Armed, but still in the tray: how to choose where it goes. */
export const HINTS_ARMED_NEW = "click a slot, or j/k to place · esc cancel";

/** Arm mode, nothing armed yet. */
export const HINTS_ARM_MODE = "click a task, then a slot · esc off";

/** In the Agenda: place, move by day, add an event, and the way back to the card. */
export const HINTS_AGENDA_FULL =
  "j/k move · c place · b time · n event · g card · [ ] day · \\ today · ⏎ done · ⇧Tab zone · ? help · q quit";

export const HINTS_AGENDA_COMPACT = "c place · n event · [ ] day · ⏎ done · ⇧Tab zone · ? help";

/** One line for every dialog: each one already prints its own specific hint inside the box. */
export const HINTS_MODAL = "Enter confirm · Esc cancel";

/** The first-run wizard has nothing behind it, so there is nothing to cancel back to. */
export const HINTS_MODAL_MANDATORY = "Enter confirm";

/** A read-only dialog: nothing to confirm, only the way out. */
export const HINTS_MODAL_INFO = "Esc close";

export function hintsFor(ctx: HintContext): string {
  if (ctx.modal === "mandatory") return HINTS_MODAL_MANDATORY;
  if (ctx.modal === "info") return HINTS_MODAL_INFO;
  if (ctx.modal) return HINTS_MODAL;
  if (ctx.armed) return ctx.placed === false ? HINTS_ARMED_NEW : HINTS_ARMED;
  if (ctx.armMode) return HINTS_ARM_MODE;
  if (ctx.zone === "timeline") return ctx.singlePane ? HINTS_AGENDA_COMPACT : HINTS_AGENDA_FULL;
  return ctx.singlePane ? HINTS_COMPACT : HINTS_FULL;
}
