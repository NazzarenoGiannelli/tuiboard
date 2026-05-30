import { describe, expect, it } from "bun:test";

import type { Config } from "~/config/loader";
import { createTuiStore, isoAddDays, isoToday } from "./index";

describe("test runner smoke", () => {
  it("can run a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});

/** Builds a minimal config with no boards — enough to exercise pure UI actions. */
function emptyConfig(): Config {
  return {
    root: process.cwd(),
    loaded: false,
    boards: [],
    assignees: [],
    doneColumn: "Done",
    archiveColumn: "Archive",
  };
}

describe("UI activeZone", () => {
  it("defaults to 'board' on a fresh store", () => {
    const store = createTuiStore({ config: emptyConfig() });
    expect(store.state.ui.activeZone).toBe("board");
  });

  it("setActiveZone updates the zone", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setActiveZone("virtual");
    expect(store.state.ui.activeZone).toBe("virtual");
    store.setActiveZone("timeline");
    expect(store.state.ui.activeZone).toBe("timeline");
  });

  it("setActiveZone('virtual') resets row to 0", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setCursor(0, 7);
    store.setActiveZone("virtual");
    expect(store.state.ui.row).toBe(0);
  });
});

describe("UI visibleZones", () => {
  it("defaults to all four zones visible", () => {
    const store = createTuiStore({ config: emptyConfig() });
    expect(store.state.ui.visibleZones).toEqual({
      virtual: true,
      board: true,
      timeline: true,
      agents: true,
    });
  });

  it("setZoneVisible flips one zone without touching others", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setZoneVisible("timeline", false);
    expect(store.state.ui.visibleZones.timeline).toBe(false);
    expect(store.state.ui.visibleZones.virtual).toBe(true);
    expect(store.state.ui.visibleZones.board).toBe(true);
    expect(store.state.ui.visibleZones.agents).toBe(true);
  });

  it("setZoneVisible('board', false) is ignored — board is load-bearing", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setZoneVisible("board", false);
    expect(store.state.ui.visibleZones.board).toBe(true);
  });

  it("hiding the active zone moves activeZone to 'board'", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setActiveZone("timeline");
    store.setZoneVisible("timeline", false);
    expect(store.state.ui.activeZone).toBe("board");
  });
});

describe("UI cycleActiveZone", () => {
  it("cycles through all visible zones in fixed order", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setActiveZone("virtual");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("board");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("timeline");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("agents");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("virtual"); // wrap
  });

  it("skips hidden zones", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setZoneVisible("timeline", false);
    store.setActiveZone("board");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("agents"); // timeline skipped
  });

  it("is a no-op when only one zone is visible (board only)", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setZoneVisible("virtual", false);
    store.setZoneVisible("timeline", false);
    store.setZoneVisible("agents", false);
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("board");
  });
});

describe("isoAddDays", () => {
  it("adds and subtracts days", () => {
    expect(isoAddDays("2026-05-30", 1)).toBe("2026-05-31");
    expect(isoAddDays("2026-05-30", -1)).toBe("2026-05-29");
    expect(isoAddDays("2026-05-30", 0)).toBe("2026-05-30");
  });

  it("rolls over month and year boundaries", () => {
    expect(isoAddDays("2026-05-31", 1)).toBe("2026-06-01");
    expect(isoAddDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoAddDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("Agenda day navigation", () => {
  it("defaults to today (offset 0)", () => {
    const store = createTuiStore({ config: emptyConfig() });
    expect(store.state.ui.agendaOffset).toBe(0);
    expect(store.agendaDate()).toBe(isoToday());
  });

  it("shifts the viewed day and reflects it in agendaDate()", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.shiftAgendaDay(1);
    expect(store.state.ui.agendaOffset).toBe(1);
    expect(store.agendaDate()).toBe(isoAddDays(isoToday(), 1));
    store.shiftAgendaDay(-3);
    expect(store.state.ui.agendaOffset).toBe(-2);
  });

  it("resets to today and clamps to ±365", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.shiftAgendaDay(1000);
    expect(store.state.ui.agendaOffset).toBe(365);
    store.resetAgendaDay();
    expect(store.state.ui.agendaOffset).toBe(0);
    store.shiftAgendaDay(-1000);
    expect(store.state.ui.agendaOffset).toBe(-365);
  });

  it("resets the timeline cursor when changing day", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setCursor(0, 5);
    store.shiftAgendaDay(1);
    expect(store.state.ui.row).toBe(0);
  });
});
