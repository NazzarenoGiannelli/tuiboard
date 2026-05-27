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
