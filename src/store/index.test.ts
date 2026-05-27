import { describe, expect, it } from "bun:test";

import type { Config } from "~/config/loader";
import { createTuiStore } from "./index";

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
