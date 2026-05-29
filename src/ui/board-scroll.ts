/**
 * Deterministic horizontal scroll geometry for the kanban board.
 *
 * The board renders a horizontal row of columns inside a clipping viewport.
 * When the cursor moves to a column that is partly or fully out of view, the
 * row is shifted (via negative margin) so that column becomes visible.
 *
 * Columns are NOT uniform width (a collapsed all-done column is narrower), so
 * the caller passes the active column's actual laid-out start offset and width
 * rather than an index + stride.
 */

export interface ColumnScrollInput {
  /** Left offset of the active column within the column row, in cells. */
  colStart: number;
  /** Width of the active column in cells. */
  colWidth: number;
  /** Currently visible width of the viewport in cells. */
  viewportWidth: number;
  /** Current horizontal scroll offset in cells. */
  currentScroll: number;
}

/**
 * Returns the scroll offset that brings the active column fully into view,
 * scrolling the minimum distance needed:
 *
 *   - already fully visible        → unchanged
 *   - off the left edge            → align column's left edge to viewport left
 *   - off the right edge           → align column's right edge to viewport right
 *   - wider than the viewport      → align left edge (show as much from the
 *                                     start of the column as possible)
 *
 * Pure and side-effect free so it can be unit-tested without a terminal.
 */
export function computeColumnScrollLeft(input: ColumnScrollInput): number {
  const { colStart, colWidth, viewportWidth, currentScroll } = input;
  if (colStart < 0 || viewportWidth <= 0) return currentScroll;

  const colEnd = colStart + colWidth;

  if (colStart < currentScroll) {
    return Math.max(0, colStart);
  }
  if (colEnd > currentScroll + viewportWidth) {
    return Math.max(0, Math.min(colStart, colEnd - viewportWidth));
  }
  return currentScroll;
}

export interface ColumnSnapInput {
  /** Active column index within the rendered (non-hidden) column list. */
  visibleIndex: number;
  /** Uniform column width in cells. */
  colWidth: number;
  /** Gap between columns in cells. */
  colGap: number;
  /** Currently visible width of the viewport in cells. */
  viewportWidth: number;
  /** Current horizontal scroll offset in cells. */
  currentScroll: number;
}

/**
 * Like computeColumnScrollLeft, but the result always lands on a column
 * boundary (a multiple of the column stride). That keeps the LEFT edge of the
 * viewport at the start of a whole column — no half-column "chopped word"
 * sliver — while the rightmost visible column may still be cut off as a
 * natural "more columns →" hint. Assumes uniform column widths (the rendered
 * kanban columns are all COL_WIDTH; hidden/collapsed columns aren't drawn).
 *
 * Pure and side-effect free.
 */
export function snapColumnScrollLeft(input: ColumnSnapInput): number {
  const { visibleIndex, colWidth, colGap, viewportWidth, currentScroll } = input;
  if (visibleIndex < 0 || viewportWidth <= 0) return currentScroll;
  const stride = colWidth + colGap;
  if (stride <= 0) return currentScroll;

  // Whole columns that fit (the last one needs no trailing gap).
  const nfit = Math.max(1, Math.floor((viewportWidth + colGap) / stride));
  // Reason in whole-column terms by snapping the current offset to a boundary.
  const curStartIdx = Math.max(0, Math.round(currentScroll / stride));

  // Active column already inside the current window → keep (snapped to a
  // boundary, so a previously-unaligned scroll gets cleaned up too).
  if (visibleIndex >= curStartIdx && visibleIndex <= curStartIdx + nfit - 1) {
    return curStartIdx * stride;
  }
  // Scroll the minimum: active to the left edge if it's off the left, or make
  // it the rightmost fully-visible column if it's off the right.
  const startIdx =
    visibleIndex < curStartIdx
      ? visibleIndex
      : Math.max(0, visibleIndex - nfit + 1);
  return startIdx * stride;
}
