import { describe, expect, it } from "bun:test";

import {
  HINTS_AGENDA_COMPACT,
  HINTS_AGENDA_FULL,
  HINTS_ARMED,
  HINTS_ARM_MODE,
  HINTS_COMPACT,
  HINTS_FULL,
  hintsFor,
  type HintContext,
} from "./hints";

const ctx = (over: Partial<HintContext> = {}): HintContext => ({
  zone: "board",
  singlePane: false,
  armed: false,
  armMode: false,
  ...over,
});

describe("hintsFor", () => {
  it("keeps the general cheat-sheet outside the Agenda, compact in single-pane", () => {
    expect(hintsFor(ctx())).toBe(HINTS_FULL);
    expect(hintsFor(ctx({ zone: "planner" }))).toBe(HINTS_FULL);
    expect(hintsFor(ctx({ singlePane: true }))).toBe(HINTS_COMPACT);
  });

  it("speaks about the Agenda's own keys when it is the active zone", () => {
    expect(hintsFor(ctx({ zone: "timeline" }))).toBe(HINTS_AGENDA_FULL);
    expect(hintsFor(ctx({ zone: "timeline", singlePane: true }))).toBe(HINTS_AGENDA_COMPACT);
    for (const line of [HINTS_AGENDA_FULL, HINTS_AGENDA_COMPACT]) {
      expect(line).toContain("[ ] day");
      expect(line).toContain("c place");
      expect(line).toContain("n event");
    }
  });

  it("an armed block gets the keys that move it, whatever the zone and layout", () => {
    for (const zone of ["board", "planner", "timeline", "agents"] as const) {
      for (const singlePane of [false, true]) {
        expect(hintsFor(ctx({ zone, singlePane, armed: true }))).toBe(HINTS_ARMED);
      }
    }
    expect(HINTS_ARMED).toContain("esc undo");
    expect(HINTS_ARMED).toContain("keep");
    expect(HINTS_ARMED).toContain("2× click"); // the mouse keeps it too
  });

  it("arm mode waiting for a task says what to click; armed beats it", () => {
    expect(hintsFor(ctx({ armMode: true }))).toBe(HINTS_ARM_MODE);
    expect(hintsFor(ctx({ armMode: true, armed: true }))).toBe(HINTS_ARMED);
  });

  it("the compact lines stay readable at 60 columns", () => {
    for (const line of [HINTS_COMPACT, HINTS_AGENDA_COMPACT, HINTS_ARMED, HINTS_ARM_MODE]) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});
