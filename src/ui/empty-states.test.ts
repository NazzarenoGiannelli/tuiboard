import { describe, expect, it } from "bun:test";

import { AGENTS_EMPTY, BOARD_EMPTY, CALENDAR_HINT, PLANNER_EMPTY, showCalendarHint } from "./empty-states";

describe("showCalendarHint", () => {
  it("only for someone with no calendar and an empty day", () => {
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: false, dayHasEvents: false })).toBe(true);
  });
  it("never once a calendar is configured", () => {
    expect(showCalendarHint({ calendarsConfigured: true, dayHasTasks: false, dayHasEvents: false })).toBe(false);
  });
  it("it goes away as soon as the day has anything on it", () => {
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: true, dayHasEvents: false })).toBe(false);
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: false, dayHasEvents: true })).toBe(false);
  });
});

describe("the copy", () => {
  it("names the keys it teaches", () => {
    expect(BOARD_EMPTY).toContain("n");
    expect(PLANNER_EMPTY.join(" ")).toContain("s");
    expect(AGENTS_EMPTY.join(" ")).toContain("Claude Code");
    expect(CALENDAR_HINT).toContain("S");
  });
  it("uses plain punctuation", () => {
    const all = [BOARD_EMPTY, ...PLANNER_EMPTY, ...AGENTS_EMPTY, CALENDAR_HINT].join(" ");
    expect(all).not.toMatch(/[–—]/);
  });
});
