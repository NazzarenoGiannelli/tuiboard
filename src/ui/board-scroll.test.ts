import { describe, expect, test } from "bun:test";

import { computeColumnScrollLeft, snapColumnScrollLeft } from "~/ui/board-scroll";

const COL = 42;
const GAP = 1;
const STRIDE = COL + GAP;

// Helper for the common uniform-width case: column at a given index.
function scroll(index: number, viewportWidth: number, currentScroll: number) {
  return computeColumnScrollLeft({
    colStart: index * STRIDE,
    colWidth: COL,
    viewportWidth,
    currentScroll,
  });
}

describe("computeColumnScrollLeft", () => {
  test("column already fully visible → scroll unchanged", () => {
    expect(scroll(0, 100, 0)).toBe(0);
    expect(scroll(1, 100, 0)).toBe(0);
  });

  test("column off the right edge → align its right edge to viewport", () => {
    // viewport 60, col 1 spans 43..85 → right-align: 85-60 = 25.
    expect(scroll(1, 60, 0)).toBe(25);
  });

  test("column off the left edge → align its left edge to viewport", () => {
    expect(scroll(0, 60, 25)).toBe(0);
  });

  test("far-right hidden column scrolls fully into view", () => {
    // col 5 spans 215..257 → right-align: 257-60 = 197.
    expect(scroll(5, 60, 0)).toBe(197);
  });

  test("column wider than viewport → align left edge (show the start)", () => {
    // viewport 30 < column 42. col 2 starts at 86 → align left edge at 86.
    expect(scroll(2, 30, 0)).toBe(86);
  });

  test("negative start or zero viewport → no change", () => {
    expect(
      computeColumnScrollLeft({ colStart: -1, colWidth: COL, viewportWidth: 60, currentScroll: 17 }),
    ).toBe(17);
    expect(scroll(3, 0, 17)).toBe(17);
  });

  test("never returns a negative scroll offset", () => {
    expect(scroll(0, 200, 0)).toBeGreaterThanOrEqual(0);
    expect(scroll(0, 30, 5)).toBeGreaterThanOrEqual(0);
  });

  test("variable widths: narrow collapsed column to the left shifts offsets", () => {
    // Columns: [42], [18 collapsed], [42]. Third column starts at
    // 43 + 19 = 62, spans 62..104. viewport 50 → right-align 104-50 = 54.
    expect(
      computeColumnScrollLeft({ colStart: 62, colWidth: 42, viewportWidth: 50, currentScroll: 0 }),
    ).toBe(54);
  });
});

describe("snapColumnScrollLeft", () => {
  // viewport 95 fits floor((95+1)/43) = 2 whole columns.
  const snap = (visibleIndex: number, currentScroll: number, viewportWidth = 95) =>
    snapColumnScrollLeft({ visibleIndex, colWidth: COL, colGap: GAP, viewportWidth, currentScroll });

  test("result is always a column-boundary multiple of the stride", () => {
    for (let i = 0; i < 6; i++) {
      expect(snap(i, 0) % STRIDE).toBe(0);
      expect(snap(i, 200) % STRIDE).toBe(0);
    }
  });

  test("active column already in the window → keep (snapped)", () => {
    expect(snap(0, 0)).toBe(0);
    expect(snap(1, 0)).toBe(0); // cols 0,1 both fit at scroll 0
  });

  test("active off the right → it becomes the rightmost full column", () => {
    // col 2 (Company) with 2 fitting → startIdx = 2-2+1 = 1 → scroll 43.
    expect(snap(2, 0)).toBe(STRIDE);
    // left edge is a clean boundary, col 0 fully off-screen (no sliver).
  });

  test("active off the left → it goes to the left edge", () => {
    expect(snap(0, STRIDE)).toBe(0);
  });

  test("an unaligned current scroll is cleaned up to a boundary", () => {
    // currentScroll 30 (mid-column) with active 0 → snaps to 0.
    expect(snap(0, 30)).toBe(0);
  });

  test("wide viewport fits all columns → no scroll", () => {
    expect(snap(2, 0, 200)).toBe(0);
  });

  test("negative index or zero viewport → unchanged", () => {
    expect(snap(-1, 17)).toBe(17);
    expect(snap(2, 17, 0)).toBe(17);
  });
});
