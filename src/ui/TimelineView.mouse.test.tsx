/**
 * The Agenda, driven with the mouse.
 *
 * Renders the real TimelineView in OpenTUI's headless renderer and uses its mock
 * mouse, so what is checked is what a click or a drag does on screen: where
 * things are is read back from the drawn frame, never assumed.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { createTuiStore, isoAddDays, isoToday } from "~/store/index";
import { TimelineView } from "~/ui/TimelineView";

type Store = ReturnType<typeof createTuiStore>;

let dir: string;
let path: string;
const stores: Store[] = [];
const renders: Array<{ renderer: { destroy: () => void } }> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-mouse-"));
  path = join(dir, "a.md");
  const tomorrow = isoAddDays(isoToday(), 1);
  writeFileSync(
    path,
    `## Todo\n\n- [ ] Alpha ⌚ 09:30-10:30 ⏳ ${tomorrow}\n- [ ] Beta ⏳ ${tomorrow}\n- [ ] Gamma ⌚ 14:00-15:00 ⏳ ${tomorrow}\n`,
  );
});

afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  for (const s of stores.splice(0)) s.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const ALPHA = () => ({ boardPath: path, columnIndex: 0, taskIndex: 0 });
const BETA = () => ({ boardPath: path, columnIndex: 0, taskIndex: 1 });

async function mount() {
  const store = createTuiStore({
    config: {
      root: process.cwd(),
      loaded: false,
      boards: [{ path }],
      assignees: [],
      doneColumn: "Done",
      archiveColumn: "Archive",
      resumeTerminal: "auto",
      resumeShell: "auto",
      statusIndicators: "symbols",
      copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" },
    } as any,
  });
  stores.push(store);
  store.shiftAgendaDay(1); // tomorrow: no "now" line, the grid starts at 07:00
  store.setActiveZone("timeline");
  // In the app the Agenda sits in a row that stretches it to the full height.
  const t = await testRender(
    () => (
      <box style={{ flexDirection: "row", width: "100%", height: "100%" }}>
        <TimelineView store={store} width={56} />
      </box>
    ),
    { width: 60, height: 60 },
  );
  renders.push(t);
  await t.renderOnce();

  const frame = () => t.captureCharFrame().split("\n");
  /** Screen position of the first line containing `text`. */
  const find = (text: string, from = 0) => {
    const lines = frame();
    const y = lines.findIndex((l, i) => i >= from && l.includes(text));
    if (y < 0) throw new Error(`"${text}" is not on screen:\n${lines.join("\n")}`);
    return { x: lines[y]!.indexOf(text), y };
  };
  /** The row of the grid that starts at HH:00 (its hour label), or a quarter past it. */
  const hourRow = (h: number) => find(`${String(h).padStart(2, "0")} ─`).y;
  const block = (r = ALPHA()) => store.getTask(r)!.timeBlock;
  const settle = async () => {
    await t.renderOnce();
    await t.renderOnce();
  };
  return { t, store, frame, find, hourRow, block, settle };
}

const hm = (h: number, m = 0) => h * 60 + m;

describe("one click selects, two arm", () => {
  it("a single click on a block selects it and arms nothing", async () => {
    const { t, store, find, settle } = await mount();
    const { x, y } = find("┤ 09:30-10:30");
    await t.mockMouse.click(x + 2, y);
    await settle();
    expect(store.state.ui.armedTimelineRef).toBeUndefined();
    expect(store.state.ui.row).toBe(store.agendaIndexOf(ALPHA()) ?? -1);
  });

  it("two clicks arm it, and the bottom edge turns into a handle", async () => {
    const { t, store, find, frame, settle } = await mount();
    const { x, y } = find("┤ 09:30-10:30");
    await t.mockMouse.doubleClick(x + 2, y);
    await settle();
    expect(store.state.ui.armedTimelineRef).toMatchObject({ taskIndex: 0 });
    expect(frame().some((l) => l.includes("━ ↕"))).toBe(true);
  });
});

describe("an armed block goes where you click, even inside its own body", () => {
  async function armed() {
    const m = await mount();
    m.store.armTimeline(ALPHA());
    await m.settle();
    return m;
  }

  it("a click on an empty row below moves it there, keeping its length", async () => {
    const { t, block, hourRow, find, settle } = await armed();
    const { x } = find("┤ 09:30-10:30");
    await t.mockMouse.click(x + 2, hourRow(12));
    await settle();
    expect(block()).toEqual({ startMin: hm(12), endMin: hm(13) });
  });

  it("a click on a row of its own body puts the start there (a quarter-hour nudge by mouse)", async () => {
    const { t, block, find, settle } = await armed();
    const head = find("┤ 09:30-10:30");
    // head = 09:30, then 09:45, then 10:00: click the row of 10:00, inside the block.
    await t.mockMouse.click(head.x + 2, head.y + 2);
    await settle();
    expect(block()).toEqual({ startMin: hm(10), endMin: hm(11) });
  });

  it("shift+click sets the end instead of the start", async () => {
    const { t, block, hourRow, find, settle } = await armed();
    const { x } = find("┤ 09:30-10:30");
    await t.mockMouse.click(x + 2, hourRow(12), undefined, { modifiers: { shift: true } });
    await settle();
    expect(block()!.startMin).toBe(hm(9, 30));
    expect(block()!.endMin).toBe(hm(12));
  });

  it("two clicks on the same row put it there and keep it: the task is let go", async () => {
    const { t, store, block, hourRow, find, settle } = await armed();
    const { x } = find("┤ 09:30-10:30");
    await t.mockMouse.doubleClick(x + 2, hourRow(12));
    await settle();
    expect(block()).toEqual({ startMin: hm(12), endMin: hm(13) });
    expect(store.state.ui.armedTimelineRef).toBeUndefined();
    expect(store.state.ui.armMode).toBe(false);
  });

  it("clicking another block places the armed one at that block's start", async () => {
    const { t, block, find, settle } = await armed();
    const other = find("┤ 14:00-15:00");
    await t.mockMouse.click(other.x + 2, other.y);
    await settle();
    expect(block()).toEqual({ startMin: hm(14), endMin: hm(15) });
  });
});

describe("dragging", () => {
  async function armed() {
    const m = await mount();
    m.store.armTimeline(ALPHA());
    await m.settle();
    return m;
  }

  it("dragging the bottom edge resizes: two rows down is half an hour longer", async () => {
    const { t, block, find, settle } = await armed();
    const edge = find("━ ↕");
    await t.mockMouse.drag(edge.x + 4, edge.y, edge.x + 4, edge.y + 2);
    await settle();
    expect(block()).toEqual({ startMin: hm(9, 30), endMin: hm(11) });
  });

  it("dragging the edge up shortens it, never below a quarter of an hour", async () => {
    const { t, block, find, settle } = await armed();
    const edge = find("━ ↕");
    await t.mockMouse.drag(edge.x + 4, edge.y, edge.x + 4, edge.y - 3);
    await settle();
    expect(block()!.startMin).toBe(hm(9, 30));
    expect(block()!.endMin - block()!.startMin).toBeGreaterThanOrEqual(15);
  });

  it("dragging the body moves the block, keeping its length", async () => {
    const { t, block, find, settle } = await armed();
    const head = find("┤ 09:30-10:30");
    await t.mockMouse.drag(head.x + 2, head.y + 1, head.x + 2, head.y + 3);
    await settle();
    expect(block()).toEqual({ startMin: hm(10), endMin: hm(11) });
  });

  it("a drag that goes nowhere is not a click: the block stays", async () => {
    const { t, block, find, settle } = await armed();
    const head = find("┤ 09:30-10:30");
    await t.mockMouse.drag(head.x + 2, head.y + 1, head.x + 2, head.y + 1);
    await settle();
    // Pressing and releasing on the same row is a click there: the start is that row's.
    expect(block()!.endMin - block()!.startMin).toBe(60);
  });
});

describe("the tray", () => {
  it("one click on a tray row selects it and arms nothing", async () => {
    const { t, store, find, settle } = await mount();
    const row = find("Beta");
    await t.mockMouse.click(row.x + 1, row.y);
    await settle();
    expect(store.state.ui.armedTimelineRef).toBeUndefined();
    expect(store.state.ui.row).toBe(0);
  });

  it("two clicks arm it and put it in the first free half hour", async () => {
    const { t, store, find, block, settle } = await mount();
    const row = find("Beta");
    await t.mockMouse.doubleClick(row.x + 1, row.y);
    await settle();
    expect(store.state.ui.armedTimelineRef).toMatchObject({ taskIndex: 1 });
    // Tomorrow the search starts at 09:00 and Alpha holds 09:30-10:30: 09:00-09:30 fits.
    expect(block(BETA())).toEqual({ startMin: hm(9), endMin: hm(9, 30) });
  });
});

describe("a click on an empty slot with nothing armed", () => {
  it("does not arm or place anything, and says what to press", async () => {
    const { t, store, hourRow, find, block, settle } = await mount();
    const { x } = find("┤ 09:30-10:30");
    await t.mockMouse.click(x + 2, hourRow(12));
    await settle();
    expect(store.state.ui.armedTimelineRef).toBeUndefined();
    expect(store.state.ui.modal).toBeUndefined();
    expect(block()).toEqual({ startMin: hm(9, 30), endMin: hm(10, 30) });
    expect(store.state.ui.banner?.text).toContain("n adds an event");
  });
});
