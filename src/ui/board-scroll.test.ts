import { describe, expect, test } from "bun:test";

import { computeColumnScrollLeft } from "~/ui/board-scroll";

// Geometry matching BoardView: 42-wide columns, 1-cell gap (stride 43).
const COL = 42;
const GAP = 1;

function scroll(visibleIndex: number, viewportWidth: number, currentScroll: number) {
  return computeColumnScrollLeft({
    visibleIndex,
    colWidth: COL,
    colGap: GAP,
    viewportWidth,
    currentScroll,
  });
}

describe("computeColumnScrollLeft", () => {
  test("column already fully visible → scroll unchanged", () => {
    // viewport 100 wide shows cols 0 (0..42) and 1 (43..85) fully at scroll 0.
    expect(scroll(0, 100, 0)).toBe(0);
    expect(scroll(1, 100, 0)).toBe(0);
  });

  test("column off the right edge → align its right edge to viewport", () => {
    // Narrow viewport (60) at scroll 0 shows only col 0 fully. Selecting col 1
    // (43..85) must scroll so its right edge (85) meets viewport right.
    expect(scroll(1, 60, 0)).toBe(85 - 60); // 25
  });

  test("column off the left edge → align its left edge to viewport", () => {
    // Scrolled to 25 (showing col 1). Going back to col 0 (start 0) must
    // scroll back to 0 so col 0's left edge is visible.
    expect(scroll(0, 60, 25)).toBe(0);
  });

  test("far-right hidden column scrolls fully into view", () => {
    // 7 columns, viewport 60, currently at scroll 0. Column 5 starts at
    // 5*43=215, ends at 257. Right-align: 257-60 = 197.
    expect(scroll(5, 60, 0)).toBe(197);
  });

  test("column wider than viewport → align left edge (show the start)", () => {
    // viewport 30 < column 42. Column 2 starts at 86. Right-align would push
    // the start off-screen; instead align the left edge at 86.
    expect(scroll(2, 30, 0)).toBe(86);
  });

  test("negative index or zero viewport → no change", () => {
    expect(scroll(-1, 60, 17)).toBe(17);
    expect(scroll(3, 0, 17)).toBe(17);
  });

  test("never returns a negative scroll offset", () => {
    expect(scroll(0, 200, 0)).toBeGreaterThanOrEqual(0);
    expect(scroll(0, 30, 5)).toBeGreaterThanOrEqual(0);
  });
});
