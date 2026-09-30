/**
 * The keyboard, in every layout.
 *
 * The same keys have to work whether the dashboard is drawn wide, mid-width,
 * narrow (single-pane, one zone at a time) or zoomed with `z`. Each layout is
 * built the way `app.tsx` builds it — `applyResponsiveFits` with the same width
 * thresholds — and keys go through the real `handleKey`, so what is checked is
 * what a keypress does, not what the store could do.
 *
 * This file needs OpenTUI's Solid preload to import `handleKey` (bunfig.toml).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTuiStore, isoAddDays, isoToday } from "~/store/index";
import { handleKey } from "./handleKey";

type Store = ReturnType<typeof createTuiStore>;
type Zone = "board" | "planner" | "timeline" | "agents";

/** The widths `app.tsx` reacts to: <100 single-pane, 100-119 planner, 120-149 + agents, 150+ + agenda. */
const LAYOUTS = {
  wide: { width: 200, zoomed: false },
  mid: { width: 130, zoomed: false },
  narrow: { width: 80, zoomed: false },
  zoomed: { width: 200, zoomed: true },
} as const;
type LayoutName = keyof typeof LAYOUTS;
const LAYOUT_NAMES = Object.keys(LAYOUTS) as LayoutName[];
const ZONES: Zone[] = ["board", "planner", "timeline", "agents"];

let dir: string;
let pathA: string;
let pathB: string;
const stores: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-keys-"));
  pathA = join(dir, "a.md");
  pathB = join(dir, "b.md");
  const today = isoToday();
  writeFileSync(
    pathA,
    `## Todo\n\n- [ ] Alpha ⌚ 09:30-10:30 ⏳ ${today}\n- [ ] Beta ⏳ ${today}\n- [ ] Gamma\n\n## Doing\n\n- [ ] Delta\n`,
  );
  writeFileSync(pathB, "## Todo\n\n- [ ] Other\n");
});

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  rmSync(dir, { recursive: true, force: true });
});

function build(layout: LayoutName, zones: Partial<Record<"planner" | "agenda" | "agents", "on" | "off" | "hidden">> = {}): Store {
  const store = createTuiStore({
    config: {
      root: process.cwd(),
      loaded: false,
      boards: [{ path: pathA }, { path: pathB }],
      assignees: [],
      doneColumn: "Done",
      archiveColumn: "Archive",
      resumeTerminal: "auto",
      resumeShell: "auto",
      statusIndicators: "symbols",
      copyResumeCommand: 'cd "{cwd}" && claude --resume {sessionId}',
      zones: { planner: "on", agenda: "on", agents: "on", ...zones },
    } as any,
  });
  stores.push(store);
  const { width, zoomed } = LAYOUTS[layout];
  store.applyResponsiveFits(
    { planner: width >= 100, timeline: width >= 150, agents: width >= 120 },
    { narrow: width < 100 },
  );
  if (zoomed) store.setZoomed(true);
  return store;
}

function press(store: Store, name: string, mods: { shift?: boolean; ctrl?: boolean } = {}): void {
  handleKey(
    store,
    { name, sequence: name.length === 1 ? name : "", ctrl: !!mods.ctrl, shift: !!mods.shift, meta: false } as any,
    50,
  );
}

const zoneOf = (s: Store) => s.state.ui.activeZone as Zone;
const taskA = (s: Store, i: number, col = 0) => s.getTask({ boardPath: pathA, columnIndex: col, taskIndex: i })!;
const later = () => new Promise((r) => setTimeout(r, 15));

function goTo(store: Store, zone: Zone): void {
  store.setActiveZone(zone);
  store.setCursor(0, 0);
}

describe("layouts are built the way the app builds them", () => {
  it("wide draws every zone, mid drops the Agenda, narrow is single-pane", () => {
    const wide = build("wide");
    expect(ZONES.every((z) => wide.isZoneReachable(z))).toBe(true);
    expect(wide.singlePane()).toBe(false);

    const mid = build("mid");
    expect(mid.isZoneReachable("timeline")).toBe(false);
    expect(mid.isZoneReachable("agents")).toBe(true);

    const narrow = build("narrow");
    expect(narrow.singlePane()).toBe(true);
    // One at a time, but every enabled zone is one Shift-Tab away.
    expect(ZONES.every((z) => narrow.isZoneReachable(z))).toBe(true);

    expect(build("zoomed").singlePane()).toBe(true);
  });
});

describe("Agenda day navigation: [ ] \\", () => {
  for (const layout of LAYOUT_NAMES) {
    for (const from of ZONES) {
      it(`${layout}, from ${from}: moves the day when the Agenda is reachable, otherwise leaves everything alone`, () => {
        const store = build(layout);
        if (!store.isZoneReachable(from)) return;
        goTo(store, from);
        const reachable = store.isZoneReachable("timeline");

        press(store, "]");
        expect(store.state.ui.agendaOffset).toBe(reachable ? 1 : 0);
        expect(zoneOf(store)).toBe(reachable ? "timeline" : from);

        press(store, "]");
        press(store, "[");
        expect(store.state.ui.agendaOffset).toBe(reachable ? 1 : 0);

        press(store, "\\");
        expect(store.state.ui.agendaOffset).toBe(0);
      });
    }
  }

  it("shows the tasks of the day it moved to", () => {
    const store = build("narrow");
    goTo(store, "timeline");
    press(store, "]");
    expect(store.agendaDate()).toBe(isoAddDays(isoToday(), 1));
    press(store, "\\");
    expect(store.agendaDate()).toBe(isoToday());
  });

  it("stays out when the Agenda was hidden with F2, in any layout, and comes back with F2", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const store = build(layout);
      goTo(store, "board");
      press(store, "f2");
      press(store, "]");
      expect(store.state.ui.agendaOffset).toBe(0);
      expect(zoneOf(store)).toBe("board");
      press(store, "f2");
      press(store, "]");
      expect(store.state.ui.agendaOffset).toBe(1);
    }
  });
});

describe("Shift-Tab walks every reachable zone and wraps", () => {
  for (const layout of LAYOUT_NAMES) {
    it(layout, () => {
      const store = build(layout);
      const want = ZONES.filter((z) => store.isZoneReachable(z));
      goTo(store, want[0]!);
      const seen: Zone[] = [zoneOf(store)];
      for (let i = 0; i < want.length; i++) {
        press(store, "tab", { shift: true });
        seen.push(zoneOf(store));
      }
      expect(new Set(seen)).toEqual(new Set(want));
      expect(seen[seen.length - 1]).toBe(seen[0]!); // a full lap ends where it began
    });
  }
});

describe("h / l", () => {
  it("narrow: walks the whole ring — planner, columns, agenda, agents — and closes it", () => {
    const store = build("narrow");
    goTo(store, "planner");
    const visited = new Set<string>();
    const label = () => (zoneOf(store) === "board" ? `col${store.state.ui.col}` : zoneOf(store));
    const start = label();
    let laps = 0;
    for (let i = 0; i < 20; i++) {
      press(store, "l");
      visited.add(label());
      if (label() === start) {
        laps = i + 1;
        break;
      }
    }
    expect(visited.has("timeline")).toBe(true);
    expect(visited.has("agents")).toBe(true);
    expect(visited.has("col0")).toBe(true);
    expect(laps).toBeGreaterThan(3);
  });

  it("narrow: h goes the other way round", () => {
    const store = build("narrow");
    goTo(store, "planner");
    press(store, "h");
    expect(zoneOf(store)).toBe("agents");
  });

  it("wide: l inside the board moves along the columns and stays in the board", () => {
    const store = build("wide");
    goTo(store, "board");
    press(store, "l");
    expect(zoneOf(store)).toBe("board");
    expect(store.state.ui.col).toBe(1);
  });
});

describe("z (zoom)", () => {
  it("wide: toggles single-pane on and off", () => {
    const store = build("wide");
    press(store, "z");
    expect(store.singlePane()).toBe(true);
    press(store, "z");
    expect(store.singlePane()).toBe(false);
  });

  it("narrow: there is nothing to zoom out to, so it stays single-pane", () => {
    const store = build("narrow");
    press(store, "z");
    expect(store.singlePane()).toBe(true);
    expect(store.state.ui.zoomed).toBe(false);
  });
});

describe("v (planner focus)", () => {
  for (const layout of LAYOUT_NAMES) {
    it(`${layout}: board -> planner -> board`, () => {
      const store = build(layout);
      goTo(store, "board");
      press(store, "v");
      expect(zoneOf(store)).toBe("planner");
      press(store, "v");
      expect(zoneOf(store)).toBe("board");
    });
  }
});

describe("F1 / F2 / F3", () => {
  it("wide: hide and show each optional zone", () => {
    const store = build("wide");
    for (const [key, zone] of [["f1", "planner"], ["f2", "timeline"], ["f3", "agents"]] as const) {
      press(store, key);
      expect(store.isZoneReachable(zone)).toBe(false);
      press(store, key);
      expect(store.isZoneReachable(zone)).toBe(true);
    }
  });

  it("narrow: a hidden zone drops out of the walk, and comes back", () => {
    const store = build("narrow");
    press(store, "f3");
    expect(store.isZoneReachable("agents")).toBe(false);
    goTo(store, "board");
    const seen = new Set<Zone>();
    for (let i = 0; i < 5; i++) {
      press(store, "tab", { shift: true });
      seen.add(zoneOf(store));
    }
    expect(seen.has("agents")).toBe(false);
    press(store, "f3");
    expect(store.isZoneReachable("agents")).toBe(true);
  });
});

describe("task actions reach the task under the cursor, in every zone and layout", () => {
  for (const layout of LAYOUT_NAMES) {
    for (const zone of ["board", "planner", "timeline"] as const) {
      it(`${layout}, ${zone}: m sends one task to tomorrow`, () => {
        const store = build(layout);
        if (!store.isZoneReachable(zone)) return;
        goTo(store, zone);
        press(store, "m");
        const moved = [0, 1, 2].filter((i) => taskA(store, i).scheduled === isoAddDays(isoToday(), 1));
        expect(moved).toHaveLength(1);
      });

      it(`${layout}, ${zone}: Enter finishes one`, () => {
        const store = build(layout);
        if (!store.isZoneReachable(zone)) return;
        goTo(store, zone);
        press(store, "return");
        expect([0, 1, 2].filter((i) => taskA(store, i).done)).toHaveLength(1);
      });
    }
  }

  it("a task that moves day takes its time block with it, from the Agenda too", () => {
    const store = build("narrow");
    goTo(store, "timeline");
    press(store, "m");
    expect(taskA(store, 0).scheduled).toBe(isoAddDays(isoToday(), 1));
    expect(taskA(store, 0).timeBlock).toBeUndefined();
  });

  it("g in the Agenda jumps to the card, Enter does not", () => {
    const store = build("narrow");
    goTo(store, "timeline");
    press(store, "g");
    expect(zoneOf(store)).toBe("board");

    goTo(store, "timeline");
    press(store, "return");
    expect(zoneOf(store)).toBe("timeline");
    expect(taskA(store, 0).done).toBe(true);
  });
});

describe("c (arm mode) from any zone", () => {
  for (const layout of LAYOUT_NAMES) {
    for (const from of ["board", "planner"] as const) {
      it(`${layout}, from ${from}: arms the task, leaves focus somewhere the user can see`, () => {
        const store = build(layout);
        goTo(store, from);
        press(store, "c");
        expect(store.state.ui.armMode).toBe(true);
        expect(store.isZoneReachable(zoneOf(store))).toBe(true);
      });
    }
  }
});

describe("global keys", () => {
  it("Tab and 1-9 switch boards", () => {
    const store = build("narrow");
    press(store, "tab");
    expect(store.state.ui.activeBoardIndex).toBe(1);
    press(store, "1");
    expect(store.state.ui.activeBoardIndex).toBe(0);
    press(store, "2");
    expect(store.state.ui.activeBoardIndex).toBe(1);
    press(store, "9"); // no ninth board: stays
    expect(store.state.ui.activeBoardIndex).toBe(1);
  });

  it("f cycles the board filter, and the harness filter in the Agents zone", () => {
    const store = build("wide");
    goTo(store, "board");
    press(store, "f");
    expect(store.state.ui.filter).toBe("today");
    goTo(store, "agents");
    press(store, "f");
    expect(store.state.ui.agentsFilter).not.toBe("all");
    expect(store.state.ui.filter).toBe("today"); // untouched
  });

  it("Ctrl-Z undoes the last change", () => {
    const store = build("wide");
    goTo(store, "board");
    press(store, "return");
    expect(taskA(store, 0).done).toBe(true);
    press(store, "z", { ctrl: true });
    expect(taskA(store, 0).done).toBe(false);
  });

  for (const layout of LAYOUT_NAMES) {
    it(`${layout}: ? opens help and i opens the status file`, () => {
      const store = build(layout);
      press(store, "?");
      expect(store.state.ui.modal?.kind).toBe("help");
      store.closeModal();
      press(store, "i");
      expect(store.state.ui.modal?.kind).toBe("status-file");
    });
  }

  it("/ opens search and + opens the new-board dialog, in single-pane", async () => {
    const store = build("narrow");
    press(store, "/");
    await later();
    expect(store.state.ui.modal?.kind).toBe("search");
    store.closeModal();
    press(store, "+");
    expect(store.state.ui.modal).toBeDefined();
  });

  it("task dialogs (s e o b a d) open from the Agenda in single-pane", async () => {
    const store = build("narrow");
    for (const [key, kind] of [["s", "schedule"], ["e", "edit"], ["o", "detail"], ["b", "timeblock"], ["a", "assign"], ["d", "confirm-delete"]] as const) {
      goTo(store, "timeline");
      press(store, key);
      await later();
      expect(store.state.ui.modal?.kind).toBe(kind);
      store.closeModal();
    }
  });
});

describe("arm mode where the Agenda has no room of its own", () => {
  it("mid: shows the Agenda alone for the placement, and gives the screen back afterwards", () => {
    for (const leave of ["escape", "return", "c"]) {
      const store = build("mid");
      goTo(store, "board");
      press(store, "c");
      expect(store.singlePane()).toBe(true);
      expect(zoneOf(store)).toBe("timeline");
      press(store, leave);
      expect(store.state.ui.armMode).toBe(false);
      expect(store.singlePane()).toBe(false);
      expect(zoneOf(store)).toBe("board");
    }
  });

  it("does not undo a zoom the user chose with z", () => {
    const store = build("wide");
    press(store, "z");
    goTo(store, "board");
    press(store, "c");
    press(store, "escape");
    expect(store.singlePane()).toBe(true);
  });

  it("says so, and arms nothing, when the Agenda is switched off", () => {
    const store = build("wide", { agenda: "off" });
    goTo(store, "board");
    press(store, "c");
    expect(store.state.ui.armMode).toBe(false);
    expect(zoneOf(store)).toBe("board");
  });
});

describe("a zone that is switched off is never entered", () => {
  it("v does not go to a planner that is off", () => {
    for (const layout of LAYOUT_NAMES) {
      const store = build(layout, { planner: "off" });
      goTo(store, "board");
      press(store, "v");
      expect(zoneOf(store)).toBe("board");
    }
  });

  it("Shift-Tab and the ring skip it too", () => {
    const store = build("narrow", { agents: "off" });
    goTo(store, "board");
    const seen = new Set<Zone>();
    for (let i = 0; i < 6; i++) {
      press(store, "tab", { shift: true });
      seen.add(zoneOf(store));
    }
    expect(seen.has("agents")).toBe(false);
  });
});

describe("selecting several tasks", () => {
  for (const layout of LAYOUT_NAMES) {
    it(`${layout}: Space marks, m moves them all, Esc clears the marks`, () => {
      const store = build(layout);
      goTo(store, "board");
      press(store, "space");
      press(store, "j");
      press(store, "space");
      expect(Object.keys(store.state.ui.marked)).toHaveLength(2);
      press(store, "m");
      const tomorrow = isoAddDays(isoToday(), 1);
      expect([0, 1, 2].filter((i) => taskA(store, i).scheduled === tomorrow)).toHaveLength(2);

      press(store, "space");
      expect(Object.keys(store.state.ui.marked).length).toBeGreaterThan(0);
      press(store, "escape");
      expect(Object.keys(store.state.ui.marked)).toHaveLength(0);
    });
  }
});

describe("n (new task)", () => {
  for (const layout of LAYOUT_NAMES) {
    it(`${layout}: opens the quick-add in the board`, async () => {
      const store = build(layout);
      goTo(store, "board");
      press(store, "n");
      await later();
      expect(store.state.ui.modal?.kind).toBe("add");
    });
  }
});
