import { describe, expect, it } from "bun:test";

import { clickIntent, createClickTracker } from "./agenda-click";

describe("createClickTracker", () => {
  function tracker() {
    const clock = { t: 1_000 };
    return { clock, tr: createClickTracker(() => clock.t, 350) };
  }

  it("two clicks on the same target inside the window are a double click", () => {
    const { clock, tr } = tracker();
    expect(tr.click("a")).toBe("single");
    clock.t += 200;
    expect(tr.click("a")).toBe("double");
  });

  it("too slow, or on another target, is two single clicks", () => {
    const { clock, tr } = tracker();
    tr.click("a");
    clock.t += 400;
    expect(tr.click("a")).toBe("single");
    clock.t += 100;
    expect(tr.click("b")).toBe("single");
  });

  it("a third click starts over", () => {
    const { clock, tr } = tracker();
    tr.click("a");
    clock.t += 100;
    expect(tr.click("a")).toBe("double");
    clock.t += 100;
    expect(tr.click("a")).toBe("single");
  });
});

describe("clickIntent", () => {
  const ctx = (over = {}) => ({ kind: "single" as const, armMode: false, armed: "none" as const, target: "band" as const, ...over });

  describe("nothing armed: one click selects, two arm", () => {
    it("selects on one click, on the grid and in the tray", () => {
      expect(clickIntent(ctx())).toBe("select");
      expect(clickIntent(ctx({ target: "tray" }))).toBe("select");
    });

    it("arms on two", () => {
      expect(clickIntent(ctx({ kind: "double" }))).toBe("arm");
      expect(clickIntent(ctx({ kind: "double", target: "tray" }))).toBe("arm");
    });

    it("arm mode, chosen on purpose, arms on every click", () => {
      expect(clickIntent(ctx({ armMode: true }))).toBe("arm");
      expect(clickIntent(ctx({ armMode: true, target: "tray" }))).toBe("arm");
    });
  });

  describe("something armed: every click is about it", () => {
    it("one click on the armed block grabs it, so a click can land inside its own body", () => {
      expect(clickIntent(ctx({ armed: "same" }))).toBe("grab");
    });

    it("one click on another block places the armed task at that block's start", () => {
      expect(clickIntent(ctx({ armed: "other" }))).toBe("place");
    });

    it("two clicks keep it where the first put it, on either kind of block", () => {
      expect(clickIntent(ctx({ kind: "double", armed: "same" }))).toBe("keep");
      expect(clickIntent(ctx({ kind: "double", armed: "other" }))).toBe("keep");
    });

    it("arm mode does not change that", () => {
      expect(clickIntent(ctx({ armMode: true, armed: "same" }))).toBe("grab");
      expect(clickIntent(ctx({ armMode: true, armed: "other" }))).toBe("place");
      expect(clickIntent(ctx({ armMode: true, kind: "double", armed: "same" }))).toBe("keep");
    });
  });

  describe("the tray has no time to place at", () => {
    it("with another task armed, one click selects and two switch to this one", () => {
      expect(clickIntent(ctx({ armed: "other", target: "tray" }))).toBe("select");
      expect(clickIntent(ctx({ kind: "double", armed: "other", target: "tray" }))).toBe("arm");
    });

    it("two clicks on the armed tray task keep it", () => {
      expect(clickIntent(ctx({ kind: "double", armed: "same", target: "tray" }))).toBe("keep");
    });

    it("arm mode arms on a single click there", () => {
      expect(clickIntent(ctx({ armMode: true, armed: "other", target: "tray" }))).toBe("arm");
    });
  });
});
