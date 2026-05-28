/**
 * Deterministic horizontal scroll geometry for the kanban board.
 *
 * The board renders a single horizontal row of fixed-width columns inside a
 * scrollbox. When the cursor moves to a column that is partly or fully out of
 * view, the scrollbox must scroll so that column becomes visible.
 *
 * We compute the target `scrollLeft` ourselves from the known column geometry
 * (width + gap) instead of relying on OpenTUI's `scrollChildIntoView`, which
 * depends on each child's measured layout being up to date at the exact moment
 * it's called — a timing/culling dependency that proved unreliable for the
 * horizontal axis when columns are scrolled fully off-screen.
 */

export interface ColumnScrollInput {
  /** Position of the active column within the *rendered* (non-archive) list. */
  visibleIndex: number;
  /** Fixed column width in cells (excludes the inter-column gap). */
  colWidth: number;
  /** Gap between adjacent columns in cells. */
  colGap: number;
  /** Currently visible width of the scrollbox viewport in cells. */
  viewportWidth: number;
  /** Current horizontal scroll offset in cells. */
  currentScroll: number;
}

/**
 * Returns the `scrollLeft` value that brings the column at `visibleIndex`
 * fully into view, scrolling the minimum distance needed:
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
  const { visibleIndex, colWidth, colGap, viewportWidth, currentScroll } = input;
  if (visibleIndex < 0 || viewportWidth <= 0) return currentScroll;

  const stride = colWidth + colGap;
  const colStart = visibleIndex * stride;
  // The trailing gap is decorative — only the column body must be visible.
  const colEnd = colStart + colWidth;

  if (colStart < currentScroll) {
    // Scrolled too far right; bring the column's start back into view.
    return Math.max(0, colStart);
  }
  if (colEnd > currentScroll + viewportWidth) {
    // Column runs past the right edge. Align its right edge to the viewport,
    // but never scroll so far that its left edge leaves the viewport (happens
    // when the column is wider than the viewport — then align the left edge).
    return Math.max(0, Math.min(colStart, colEnd - viewportWidth));
  }
  // Already fully visible.
  return currentScroll;
}
