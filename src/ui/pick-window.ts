/**
 * The window of a long pick list that the dialog can actually show.
 *
 * The adopt dialog lists every board-like file in a folder, and a vault can
 * hold dozens. Pure functions (no JSX) so the arithmetic is unit-testable: the
 * window is derived from the cursor alone, so the store keeps no scroll state
 * and j/k, Space and Enter keep working on absolute candidate indexes.
 */

import { fit } from "~/ui/block-box";
import { cellWidth } from "~/ui/glyphs";

/** Fewest candidate rows worth showing: below this the list is not a list. */
export const MIN_WINDOW = 3;
/** Most candidate rows in a scrolling window; a longer one is just noise. */
export const MAX_WINDOW = 12;
/**
 * Rows the app keeps for itself around a dialog: one of padding, the top bar,
 * a spacer and the bottom bar (20 rows of dialog inside a 24-row terminal).
 */
export const APP_CHROME_ROWS = 4;
/** The dialog's border, top and bottom. */
const BORDER_ROWS = 2;
/** The "N board file(s) in <dir>" line. */
const HEADER_ROWS = 1;

export interface PickWindow {
  /** Index of the first candidate shown. */
  start: number;
  /** How many candidates are shown. */
  size: number;
  /** Candidates scrolled off above the window. */
  above: number;
  /** Candidates scrolled off below the window. */
  below: number;
  /** True when the list scrolls. */
  scrolls: boolean;
  /** True when the two "more above/below" rows are part of the layout (not in a terminal too small for them). */
  markers: boolean;
}

/** How many terminal rows `text` takes when it wraps at `width` cells. */
export function wrappedRows(text: string, width: number): number {
  if (text === "") return 0;
  return Math.max(1, Math.ceil(cellWidth(text) / Math.max(1, width)));
}

/**
 * Rows left for the candidate list (markers included) inside the dialog.
 *
 * `rows` is the terminal height, `inner` the dialog's usable width. The hint
 * wraps at narrow widths and the error needs a blank row above it, so both are
 * measured rather than guessed.
 */
export function pickListBudget(rows: number, inner: number, hint: string, error: string | undefined): number {
  const hintRows = Math.max(1, wrappedRows(hint, inner));
  const errorRows = error ? 1 + wrappedRows(error, inner) : 0;
  return rows - APP_CHROME_ROWS - BORDER_ROWS - HEADER_ROWS - hintRows - errorRows;
}

/**
 * Which candidates to show for a cursor at `sel`.
 *
 * When everything fits in `budget` rows, everything is shown and there are no
 * markers. Otherwise (and when there is room for them) two rows go to "N more above" / "N more below" (reserved
 * even when empty, so the dialog does not change height as the cursor moves)
 * and the rest to candidates, between MIN_WINDOW and MAX_WINDOW. The window
 * keeps the cursor in the middle until it reaches either end.
 */
export function pickWindow(total: number, sel: number, budget: number): PickWindow {
  if (total <= Math.max(budget, MIN_WINDOW)) {
    return { start: 0, size: total, above: 0, below: 0, scrolls: false, markers: false };
  }
  // With no room for three candidates plus both markers, the markers go: the hint and the
  // border matter more than a count.
  const markers = budget >= MIN_WINDOW + 2;
  const size = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, markers ? budget - 2 : budget, total));
  const cursor = Math.max(0, Math.min(total - 1, sel));
  const start = Math.max(0, Math.min(total - size, cursor - Math.floor(size / 2)));
  return { start, size, above: start, below: total - start - size, scrolls: true, markers };
}

/** Keep the END of `s` within `max` cells, with a leading ellipsis: the tail of a path is the part that tells folders apart. */
export function tailFit(s: string, max: number): string {
  if (max <= 0) return "";
  if (cellWidth(s) <= max) return s;
  const chars = Array.from(s);
  let out = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i]! + out;
    if (cellWidth(next) > max - 1) break;
    out = next;
  }
  return "…" + out;
}

/**
 * One candidate on one row: lead (cursor and tick marks), the name cut to fit,
 * and the task count after it. The name gives way before the count does; the
 * "already open" note is the first thing dropped when the row is tight.
 */
export function pickRow(
  lead: string,
  name: string,
  taskCount: number,
  alreadyInConfig: boolean,
  inner: number,
): { name: string; note: string } {
  const count = "  " + taskCount + (taskCount === 1 ? " task" : " tasks");
  const open = alreadyInConfig ? " · already open" : "";
  const room = (note: string) => inner - cellWidth(lead) - cellWidth(note);
  const note = room(count + open) >= 12 ? count + open : count;
  return { name: fit(name, Math.max(1, room(note))), note };
}
