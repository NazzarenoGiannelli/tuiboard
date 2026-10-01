import { describe, expect, it } from "bun:test";

import { MAX_WINDOW, pickListBudget, pickRow, pickWindow, tailFit } from "./pick-window";

describe("pickWindow", () => {
  it("shows everything, with no markers, when it fits", () => {
    expect(pickWindow(3, 2, 16)).toEqual({ start: 0, size: 3, above: 0, below: 0, scrolls: false, markers: false });
    expect(pickWindow(16, 15, 16)).toMatchObject({ size: 16, scrolls: false });
  });

  it("scrolls with two marker rows reserved when it does not", () => {
    const w = pickWindow(38, 0, 15);
    expect(w).toEqual({ start: 0, size: 12, above: 0, below: 26, scrolls: true, markers: true });
    expect(w.size + 2).toBeLessThanOrEqual(15);
  });

  it("keeps the cursor inside the window at every position", () => {
    for (let sel = 0; sel < 38; sel++) {
      const w = pickWindow(38, sel, 15);
      expect(sel).toBeGreaterThanOrEqual(w.start);
      expect(sel).toBeLessThan(w.start + w.size);
      expect(w.above + w.size + w.below).toBe(38);
    }
  });

  it("ends flush with the last item", () => {
    expect(pickWindow(38, 37, 15)).toMatchObject({ above: 38 - MAX_WINDOW, below: 0 });
  });

  it("never shrinks below three rows, even in a tiny terminal", () => {
    expect(pickWindow(38, 10, 2).size).toBe(3);
  });
});

describe("pickListBudget", () => {
  it("is 15 rows in a 24-row terminal at 40 columns, where the hint wraps to two rows", () => {
    const hint = "j/k move · Space tick · Enter adopt · Esc back";
    expect(pickListBudget(24, 33, hint, undefined)).toBe(15);
    expect(pickListBudget(24, 72, hint, undefined)).toBe(16);
  });

  it("gives up rows to an error, and to its blank line", () => {
    expect(pickListBudget(24, 72, "hint", "nothing to adopt")).toBe(pickListBudget(24, 72, "hint", undefined) - 2);
  });
});

describe("tailFit", () => {
  it("keeps the end of a path, behind a leading ellipsis", () => {
    expect(tailFit("/home/nazza/vault/Tasks", 10)).toBe("…ult/Tasks");
    expect(tailFit("short", 10)).toBe("short");
  });
});

describe("pickRow", () => {
  it("cuts the name, not the count", () => {
    const r = pickRow("▶   ", "x".repeat(80), 12, false, 33);
    expect(r.name.endsWith("…")).toBe(true);
    expect(r.note).toBe("  12 tasks");
    expect(4 + r.name.length + r.note.length).toBeLessThanOrEqual(33);
  });

  it("drops the 'already open' note before it squeezes the name", () => {
    expect(pickRow("▶ · ", "Work", 3, true, 33).note).toBe("  3 tasks");
    expect(pickRow("▶ · ", "Work", 1, true, 72).note).toBe("  1 task · already open");
  });
});

describe("a very small terminal", () => {
  const hint = "j/k move · Space tick · Enter adopt · Esc back";

  it("has almost no room: 2 rows at height 10, 4 at height 12 (80 columns)", () => {
    expect(pickListBudget(10, 72, hint, undefined)).toBe(2);
    expect(pickListBudget(12, 72, hint, undefined)).toBe(4);
  });

  it("drops the marker rows when they would not fit beside three candidates", () => {
    for (const budget of [2, 4]) {
      const w = pickWindow(38, 20, budget);
      expect(w.markers).toBe(false);
      expect(w.size).toBe(Math.max(3, budget));
      expect(20).toBeGreaterThanOrEqual(w.start);
      expect(20).toBeLessThan(w.start + w.size);
    }
    expect(pickWindow(38, 20, 5).markers).toBe(true);
  });
});
