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
