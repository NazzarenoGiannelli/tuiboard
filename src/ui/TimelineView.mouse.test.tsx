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

async function mount(opts: { board?: string; height?: number } = {}) {
  if (opts.board) writeFileSync(path, opts.board);
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
    { width: 60, height: opts.height ?? 60 },
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

describe("dragging never selects text", () => {
  it("dragging an armed block past another block's text leaves no terminal text selection", async () => {
    const { t, find, settle, store } = await mount();
    store.armTimeline(ALPHA());
    await settle();
    const head = find("┤ 09:30-10:30");
    const other = find("┤ 14:00-15:00");
    // From inside Alpha down across the screen, over Gamma's title and time.
    await t.mockMouse.drag(head.x + 2, head.y + 1, other.x + 6, other.y + 1);
    await settle();
    expect(t.renderer.hasSelection).toBe(false);
  });

  it("nor does a plain drag over the grid with nothing armed", async () => {
    const { t, find, settle } = await mount();
    const head = find("┤ 09:30-10:30");
    const other = find("┤ 14:00-15:00");
    await t.mockMouse.drag(head.x + 2, head.y, other.x + 6, other.y + 1);
    await settle();
    expect(t.renderer.hasSelection).toBe(false);
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

  it("two clicks arm it and place nothing: it stays in the tray until you click a slot", async () => {
    const { t, store, find, hourRow, block, settle } = await mount();
    const row = find("Beta");
    await t.mockMouse.doubleClick(row.x + 1, row.y);
    await settle();
    expect(store.state.ui.armedTimelineRef).toMatchObject({ taskIndex: 1 });
    expect(block(BETA())).toBeUndefined(); // nothing moved

    await t.mockMouse.click(row.x + 1, hourRow(12));
    await settle();
    expect(block(BETA())).toEqual({ startMin: hm(12), endMin: hm(12, 30) }); // where you clicked, half an hour
    expect(store.state.ui.armedTimelineRef).toMatchObject({ taskIndex: 1 }); // and still armed
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

describe("the grid follows the selected block, all of it, without jumping", () => {
  const tomorrow = () => isoAddDays(isoToday(), 1);
  const lateBoard = () =>
    `## Todo

- [ ] Mattina ⌚ 08:00-09:00 ⏳ ${tomorrow()}
- [ ] Sera ⌚ 18:00-19:00 ⏳ ${tomorrow()}
- [ ] Tardi ⌚ 20:00-21:00 ⏳ ${tomorrow()}
`;
  const SERA = 1;
  const TARDI = 2;
  const later = () => new Promise((r) => setTimeout(r, 25));

  /** Select a block the way a click does: set the zone (which parks the cursor on row 0), then the row. */
  async function select(m: Awaited<ReturnType<typeof mount>>, taskIndex: number) {
    m.store.setActiveZone("timeline");
    m.store.setCursor(0, m.store.agendaIndexOf({ boardPath: path, columnIndex: 0, taskIndex }) ?? 0);
    await later();
    await m.t.renderOnce();
    await m.t.renderOnce();
  }

  it("a block at the end of the day is shown whole: its start, its title and the rule that closes it", async () => {
    const m = await mount({ board: lateBoard(), height: 26 });
    await select(m, TARDI);
    const lines = m.frame();
    const head = lines.findIndex((l) => l.includes("┤ 20:00-21:00"));
    expect(head).toBeGreaterThan(-1);
    expect(lines[head + 1]).toContain("Tardi");
    expect(lines.slice(head + 1, head + 6).some((l) => l.includes("╰"))).toBe(true);
  });

  it("selecting the block in between does not send the grid to the first block of the day", async () => {
    const m = await mount({ board: lateBoard(), height: 26 });
    await select(m, SERA);
    const lines = m.frame();
    expect(lines.some((l) => l.includes("┤ 18:00-19:00"))).toBe(true);
    expect(lines.some((l) => l.includes("╰"))).toBe(true);
  });

  it("a block already in view does not move the grid", async () => {
    const m = await mount({ board: lateBoard(), height: 60 });
    const before = m.frame().findIndex((l) => l.includes("07 ─"));
    await select(m, SERA);
    await select(m, 0);
    await select(m, SERA);
    expect(m.frame().findIndex((l) => l.includes("07 ─"))).toBe(before);
  });
});

describe("blocks are boxes, on the ruler", () => {
  const tomorrow = () => isoAddDays(isoToday(), 1);

  it("the top edge is on the row of the start, the bottom edge on the row of the end, both with the time set in", async () => {
    const m = await mount();
    const lines = m.frame();
    const head = lines.findIndex((l) => l.includes("╭─┤ 09:30-10:30 ├"));
    expect(head).toBeGreaterThan(-1);
    expect(lines[head + 1]).toContain("│ Alpha");
    expect(lines[head + 4]).toContain("╰"); // 09:30 + four quarters: the rule on the 10:30 row
    // The hour label stays in the gutter of the row a box covers (10:00 is under it).
    expect(lines[head + 2]).toMatch(/^.{1,3}10 /);
  });

  it("the corners land exactly on the lane's edge: the same column as the end of an hour rule", async () => {
    const m = await mount();
    const lines = m.frame();
    const rule = lines.find((l) => l.includes("07 ─"))!;
    const laneEnd = rule.lastIndexOf("─");
    const head = lines.find((l) => l.includes("╭─┤ 09:30-10:30 ├"))!;
    const foot = lines.find((l) => l.includes("╰") && l.includes("╯"))!;
    expect(head.lastIndexOf("╮")).toBe(laneEnd);
    expect(foot.lastIndexOf("╯")).toBe(laneEnd);
  });

  it("a quarter of an hour is one row, the title set into the top edge", async () => {
    const m = await mount({ board: `## Todo\n\n- [ ] Breve ⌚ 08:00-08:15 ⏳ ${tomorrow()}\n` });
    const lines = m.frame();
    const head = lines.findIndex((l) => l.includes("╭─┤ 08:00-08:15 Breve ├"));
    expect(head).toBeGreaterThan(-1);
    expect(lines[head + 1]).toContain("╰"); // and the next row already closes it
  });

  it("two blocks that touch share the line between them", async () => {
    const m = await mount({
      board: `## Todo\n\n- [ ] Uno ⌚ 09:00-09:30 ⏳ ${tomorrow()}\n- [ ] Due ⌚ 09:30-10:00 ⏳ ${tomorrow()}\n`,
    });
    const lines = m.frame();
    const shared = lines.findIndex((l) => l.includes("├─┤ 09:30-10:00 ├"));
    expect(shared).toBeGreaterThan(-1);
    expect(lines[shared - 1]).toContain("│ Uno"); // the first box's body is right above
    // Inside the panel (its own bottom border also has a ╯), only the second box closes.
    expect(lines.filter((l) => l.trimStart().startsWith("│") && l.includes("╯")).length).toBe(1);
  });

  it("overlapping blocks each get a box in their own lane", async () => {
    const m = await mount({
      board: `## Todo\n\n- [ ] Uno ⌚ 09:00-10:00 ⏳ ${tomorrow()}\n- [ ] Due ⌚ 09:30-10:30 ⏳ ${tomorrow()}\n`,
    });
    const text = m.frame().join("\n");
    expect(text).toContain("09:00-10:00");
    expect(text).toContain("09:30-10:30");
    expect(text.match(/╯/g)!.length).toBeGreaterThanOrEqual(2); // each lane closes with its own corner
  });
});
