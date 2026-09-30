import { describe, expect, it } from "bun:test";

import { boxBody, boxBottom, boxTop, fit, segsWidth } from "./block-box";

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

describe("every row of the box is exactly as wide as its lane", () => {
  for (const width of [12, 24, 46, 74]) {
    it(`width ${width}`, () => {
      expect(segsWidth(boxTop("09:00-09:30", width, false))).toBe(width);
      expect(segsWidth(boxTop("09:00-09:30", width, true))).toBe(width);
      expect(segsWidth(boxTop("08:00-08:15 @nazz 🔺 Rispondere a Twinbru", width, false))).toBe(width);
      expect(segsWidth(boxBody("Rispondere a Twinbru", width))).toBe(width);
      expect(segsWidth(boxBody("", width))).toBe(width);
      expect(segsWidth(boxBody("Finita", width, "✓ "))).toBe(width);
      expect(segsWidth(boxBody("🔺 un titolo con emoji 🔺 lunghissimo lunghissimo lunghissimo", width))).toBe(width);
      expect(segsWidth(boxBottom(width, false))).toBe(width);
      expect(segsWidth(boxBottom(width, true))).toBe(width);
    });
  }
});

describe("the shape", () => {
  it("the time is set into the top edge", () => {
    expect(text(boxTop("09:00-09:30", 30, false))).toBe("╭─┤ 09:00-09:30 ├" + "─".repeat(12) + "╮");
  });

  it("a block that touches the one above shares its line, with the T-junction corners", () => {
    const t = text(boxTop("09:30-10:00", 30, true));
    expect(t.startsWith("├─┤ ")).toBe(true);
    expect(t.endsWith("┤")).toBe(true);
  });

  it("the body has a wall on each side and the text after a space", () => {
    expect(text(boxBody("Titolo", 16))).toBe("│ Titolo" + " ".repeat(7) + "│");
  });

  it("the bottom edge closes the box; armed, it carries the handle", () => {
    expect(text(boxBottom(10, false))).toBe("╰────────╯");
    const armed = text(boxBottom(14, true));
    expect(armed.startsWith("╰━ ↕ ")).toBe(true);
    expect(armed.endsWith("╯")).toBe(true);
  });

  it("a label or title too long is cut with an ellipsis and never breaks the width", () => {
    expect(text(boxTop("x".repeat(80), 20, false))).toContain("…");
    expect(text(boxBody("y".repeat(80), 20))).toContain("…");
    expect(fit("abcdef", 4)).toBe("abc…");
    expect(fit("abc", 4)).toBe("abc");
  });

  it("does not fall over on a lane too narrow to draw a box", () => {
    for (const w of [0, 1, 3, 6]) {
      expect(() => boxTop("09:00-09:30", w, false)).not.toThrow();
      expect(() => boxBody("x", w)).not.toThrow();
      expect(() => boxBottom(w, true)).not.toThrow();
    }
  });
});
