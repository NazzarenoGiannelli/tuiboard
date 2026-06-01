import { describe, expect, it } from "bun:test";

import type { Config } from "~/config/loader";
import { createTuiStore, isoAddDays, isoToday } from "./index";

describe("test runner smoke", () => {
  it("can run a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});

/** Builds a minimal config with no boards — enough to exercise pure UI actions. */
function emptyConfig(overrides: Partial<Config> = {}): Config {
  return {
    root: process.cwd(),
    loaded: false,
    boards: [],
    assignees: [],
    doneColumn: "Done",
    archiveColumn: "Archive",
    zones: { planner: "on", agenda: "on", agents: "on" },
    ...overrides,
  };
}

describe("UI activeZone", () => {
  it("defaults to 'board' on a fresh store", () => {
    const store = createTuiStore({ config: emptyConfig() });
    expect(store.state.ui.activeZone).toBe("board");
  });

  it("setActiveZone updates the zone", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setActiveZone("planner");
    expect(store.state.ui.activeZone).toBe("planner");
    store.setActiveZone("timeline");
    expect(store.state.ui.activeZone).toBe("timeline");
  });

  it("setActiveZone('planner') resets row to 0", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setCursor(0, 7);
    store.setActiveZone("planner");
    expect(store.state.ui.row).toBe(0);
  });
});

describe("UI visibleZones", () => {
  it("defaults to all four zones visible", () => {
    const store = createTuiStore({ config: emptyConfig() });
    expect(store.state.ui.visibleZones).toEqual({
      planner: true,
      board: true,
      timeline: true,
      agents: true,
    });
  });

  it("setZoneVisible flips one zone without touching others", () => {
    const store = createTuiStore({ config: emptyConfig() });
    store.setZoneVisible("timeline", false);
    expect(store.state.ui.visibleZones.timeline).toBe(false);
    expect(store.state.ui.visibleZones.planner).toBe(true);
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
    store.setActiveZone("planner");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("board");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("timeline");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("agents");
    store.cycleActiveZone();
    expect(store.state.ui.activeZone).toBe("planner"); // wrap
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
    store.setZoneVisible("planner", false);
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

describe("zones config", () => {
  it("enables and shows all zones by default", () => {
    const s = createTuiStore({ config: emptyConfig() });
    expect(s.state.ui.enabledZones).toEqual({ board: true, planner: true, timeline: true, agents: true });
    expect(s.state.ui.visibleZones).toEqual({ board: true, planner: true, timeline: true, agents: true });
  });

  it("disables a zone set to off (never enabled, never visible)", () => {
    const s = createTuiStore({
      config: emptyConfig({ zones: { planner: "on", agenda: "off", agents: "off" } }),
    });
    expect(s.state.ui.enabledZones.timeline).toBe(false);
    expect(s.state.ui.enabledZones.agents).toBe(false);
    expect(s.state.ui.visibleZones.timeline).toBe(false);
    expect(s.state.ui.visibleZones.agents).toBe(false);
  });

  it("a hidden zone is enabled but not visible at start; F-key reveals it", () => {
    const s = createTuiStore({
      config: emptyConfig({ zones: { planner: "hidden", agenda: "on", agents: "on" } }),
    });
    expect(s.state.ui.enabledZones.planner).toBe(true);
    expect(s.state.ui.visibleZones.planner).toBe(false);
    s.toggleZoneDesired("planner");
    expect(s.state.ui.visibleZones.planner).toBe(true);
  });

  it("F-key toggle is a no-op on a disabled zone", () => {
    const s = createTuiStore({
      config: emptyConfig({ zones: { planner: "on", agenda: "off", agents: "on" } }),
    });
    s.toggleZoneDesired("timeline");
    expect(s.state.ui.visibleZones.timeline).toBe(false);
  });

  it("Shift-Tab cycle skips disabled zones", () => {
    const s = createTuiStore({
      config: emptyConfig({ zones: { planner: "on", agenda: "off", agents: "off" } }),
    });
    s.setActiveZone("board");
    s.cycleActiveZone();
    expect(s.state.ui.activeZone).toBe("planner");
    s.cycleActiveZone();
    expect(s.state.ui.activeZone).toBe("board"); // timeline + agents skipped
  });

  it("responsive fits never force-show a disabled zone", () => {
    const s = createTuiStore({
      config: emptyConfig({ zones: { planner: "on", agenda: "off", agents: "on" } }),
    });
    s.applyResponsiveFits({ planner: true, timeline: true, agents: true });
    expect(s.state.ui.visibleZones.timeline).toBe(false); // disabled stays off
    expect(s.state.ui.visibleZones.agents).toBe(true);
  });

  it("responsive hides a zone that doesn't fit; it returns when it fits again", () => {
    const s = createTuiStore({ config: emptyConfig() });
    s.applyResponsiveFits({ planner: true, timeline: false, agents: true });
    expect(s.state.ui.visibleZones.timeline).toBe(false);
    s.applyResponsiveFits({ planner: true, timeline: true, agents: true });
    expect(s.state.ui.visibleZones.timeline).toBe(true);
  });
});
