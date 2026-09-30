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

  it("one click selects, it does not arm", () => {
    expect(clickIntent(ctx())).toBe("select");
    expect(clickIntent(ctx({ target: "tray" }))).toBe("select");
    expect(clickIntent(ctx({ armed: "same" }))).toBe("select"); // an armed block stays armed when clicked once
  });

  it("two clicks arm, and two on the armed one disarm it", () => {
    expect(clickIntent(ctx({ kind: "double" }))).toBe("arm");
    expect(clickIntent(ctx({ kind: "double", target: "tray" }))).toBe("arm");
    expect(clickIntent(ctx({ kind: "double", armed: "same" }))).toBe("disarm");
  });

  it("with another task armed, a click on a block places it there", () => {
    expect(clickIntent(ctx({ armed: "other" }))).toBe("place");
    expect(clickIntent(ctx({ kind: "double", armed: "other" }))).toBe("place");
  });

  it("a tray row has no time to place at: with another task armed it arms this one", () => {
    expect(clickIntent(ctx({ kind: "double", armed: "other", target: "tray" }))).toBe("arm");
    expect(clickIntent(ctx({ armed: "other", target: "tray" }))).toBe("select");
  });

  it("arm mode, chosen on purpose, arms on every click", () => {
    expect(clickIntent(ctx({ armMode: true }))).toBe("arm");
    expect(clickIntent(ctx({ armMode: true, target: "tray" }))).toBe("arm");
    expect(clickIntent(ctx({ armMode: true, armed: "same" }))).toBe("disarm");
    expect(clickIntent(ctx({ armMode: true, armed: "other" }))).toBe("place");
  });
});
