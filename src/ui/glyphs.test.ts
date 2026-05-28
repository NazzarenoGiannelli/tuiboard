import { describe, expect, test } from "bun:test";

import { cellWidth } from "~/ui/glyphs";

describe("cellWidth", () => {
  test("ASCII counts one cell per char", () => {
    expect(cellWidth("09:00")).toBe(5);
    expect(cellWidth("Costruire routine")).toBe(17);
    expect(cellWidth("")).toBe(0);
  });

  test("the ⌚ time-block glyph is 2 cells (the bug that broke truncation)", () => {
    expect(cellWidth("⌚")).toBe(2);
    // The actual suffix on a time-blocked row: ⌚ + "09:00" = 2 + 5 = 7,
    // not the 6 that String.length reports.
    expect(cellWidth("⌚09:00")).toBe(7);
    expect("⌚09:00".length).toBe(6); // proves the undercount we corrected
  });

  test("priority + clock emoji are 2 cells", () => {
    expect(cellWidth("🔺")).toBe(2); // U+1F53A
    expect(cellWidth("⏰")).toBe(2); // U+23F0
    expect(cellWidth("⏫")).toBe(2); // U+23EB
  });

  test("narrow symbols used in rows stay 1 cell", () => {
    expect(cellWidth("✓")).toBe(1); // done check
    expect(cellWidth("●")).toBe(1); // marked dot
    expect(cellWidth("→")).toBe(1); // tomorrow arrow
  });
});
