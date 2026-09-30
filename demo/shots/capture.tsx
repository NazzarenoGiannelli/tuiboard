/**
 * Frames for images and videos: the real app, headless, on the demo boards.
 *
 *   bun --preload ./node_modules/@opentui/solid/scripts/preload.ts demo/shots/capture.tsx [scene ...]
 *
 * Mounts the same tree as app.tsx (top bar, dashboard, bottom bar) in OpenTUI's test
 * renderer, drives it the way a user would (the real key handler, the mock mouse), and
 * writes every frame as JSON — each cell with its real colours — under demo/out/frames/.
 * render.py turns those into pictures and video. The desktop is never touched.
 *
 * The clock is frozen at 09:41 today (freeze.ts) so the "now" line sits between two blocks and every run
 * makes the same pictures. Boards are re-seeded first: the pictures never show anything
 * but the invented demo.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testRender } from "@opentui/solid";

// The clock is frozen by ./freeze, which has to be evaluated before everything below.
import { NOW } from "./freeze";
import { seedDemo } from "../seed";
import { createDemoAgentAdapter } from "./agents";
import { AGENT_ADAPTERS } from "~/store/agent-adapters";
import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";
import { buildPlannerItems } from "~/store/planner-panel";
import { loadConfig } from "~/config/loader";
import { BottomBar, TopBar } from "~/ui/Chrome";
import { T } from "~/ui/glyphs";
import { Dashboard } from "~/views/Dashboard";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out", "frames");

type Store = ReturnType<typeof createTuiStore>;

/** Every hold is in 12 fps ticks, stretched by this so a clip has time to be read. */
const PACE = 1.5;

/** The Agenda needs height: from the tray down to the afternoon, so a block can be carried and stretched in view. */
const AGENDA_ROWS = 46;

/** What a scene needs to drive the app. */
interface Stage {
  store: Store;
  t: Awaited<ReturnType<typeof testRender>>;
  /** Press a key through the real handler. */
  key(name: string, mods?: { shift?: boolean; ctrl?: boolean }): Promise<void>;
  /** The drawn lines, to find where things are. */
  lines(): string[];
  /** Screen position of the first line that contains `text`. */
  find(text: string, from?: number): { x: number; y: number };
  /** Let timers and renders settle. */
  settle(): Promise<void>;
  /** Let timers and renders settle, then save a frame. */
  frame(caption?: string, hold?: number, meta?: Record<string, unknown>): Promise<void>;
}

async function stage(scene: string, cols: number, rows: number, setup: (s: Store) => void): Promise<Stage> {
  seedDemo();
  process.env.TUIBOARD_CONFIG = join(here, "..", "config.yaml");
  const config = loadConfig();
  // The Agents zone is on for the pictures, but fed invented sessions: the real ones on a
  // machine carry client names and unreleased work.
  config.zones.agents = "on";
  AGENT_ADAPTERS.splice(0, AGENT_ADAPTERS.length, createDemoAgentAdapter(NOW));
  const store = createTuiStore({ config });
  store.applyResponsiveFits(
    { planner: cols >= 100, timeline: cols >= 150, agents: cols >= 120 },
    { narrow: cols < 100 },
  );
  setup(store);
  const plannerCount = () => buildPlannerItems(store.state.boards.map((b) => b.board)).length;

  const t = await testRender(
    () => (
      <box
        style={{
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: T.bg,
          paddingTop: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingBottom: 0,
        }}
      >
        <TopBar store={store} />
        <box style={{ height: 1 }} />
        <box style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
          <box style={{ flexDirection: "column", flexGrow: 1 }}>
            <Dashboard store={store} />
          </box>
        </box>
        <BottomBar store={store} />
      </box>
    ),
    { width: cols, height: rows },
  );

  const dir = join(OUT, scene);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;

  const settle = async () => {
    await new Promise((r) => setTimeout(r, 40));
    await t.renderOnce();
    await t.renderOnce();
  };
  await settle();

  const lines = () => t.captureCharFrame().split("\n");
  return {
    store,
    t,
    lines,
    settle,
    async key(name, mods = {}) {
      handleKey(
        store,
        { name, sequence: name.length === 1 ? name : "", ctrl: !!mods.ctrl, shift: !!mods.shift, meta: false } as any,
        plannerCount(),
      );
      await settle();
    },
    find(text, from = 0) {
      const ls = lines();
      const y = ls.findIndex((l, i) => i >= from && l.includes(text));
      if (y < 0) throw new Error(`"${text}" is not on screen in scene ${scene}:\n${ls.join("\n")}`);
      return { x: [...ls[y]!].indexOf([...text][0]!) >= 0 ? ls[y]!.indexOf(text) : 0, y };
    },
    async frame(caption, hold = 1, meta) {
      await settle();
      const f: any = t.captureSpans();
      const col = (c: any) => (c ? Array.from(c.buffer ?? c).map((v: any) => Number(v)) : null);
      const data = {
        cols: f.cols,
        rows: f.rows,
        caption: caption ?? null,
        hold: Math.max(1, Math.round(hold * PACE)),
        ...meta,
        lines: f.lines.map((l: any) =>
          l.spans.map((s: any) => ({ t: s.text, w: s.width, fg: col(s.fg), bg: col(s.bg), a: s.attributes })),
        ),
      };
      writeFileSync(join(dir, String(n++).padStart(3, "0") + ".json"), JSON.stringify(data));
    },
  };
}

// ── Scenes ───────────────────────────────────────────────────────────────────

type Scene = () => Promise<void>;

/** The whole dashboard, a busy mid-morning: planner, board and the Agenda with nested and overlapping blocks. */
const hero: Scene = async () => {
  const s = await stage("hero", 182, 42, (st) => {
    st.setActiveZone("timeline");
  });
  // Put the cursor on the block that holds another, so the grid scrolls to the morning.
  const i = s.store.agendaIndexOf(firstRef(s.store, "Design review: onboarding")!) ?? 0;
  s.store.setCursor(0, i);
  await s.frame();
};

/** Single-pane stills: a narrow, vertical terminal shows one zone at a time. */
const pane = (scene: string, zone: "board" | "planner" | "timeline" | "agents", setup?: (s: Stage) => Promise<void>, rows = 36): Scene => async () => {
  const s = await stage(scene, 64, rows, (st) => st.setActiveZone(zone));
  await setup?.(s);
  await s.frame();
};
const agenda = pane("agenda", "timeline", undefined, AGENDA_ROWS);
const board = pane("board", "board", async (s) => {
  await s.key("j");
  await s.key("j");
}, 32);
const today = pane("today", "planner", async (s) => {
  for (let i = 0; i < 4; i++) await s.key("j");
});
const agents = pane("agents", "agents", async (s) => {
  await s.key("j");
}, 32);

/** The four zones in turn, on a wide terminal: Shift-Tab walks the ring. */
const zones: Scene = async () => {
  const s = await stage("zones", 182, 42, (st) => st.setActiveZone("planner"));
  const walk = async (caption: string, keys: string[]) => {
    await s.frame(caption, 8);
    for (const k of keys) {
      await s.key(k);
      await s.frame(caption, 4);
    }
  };
  await walk("Today / Tomorrow: what needs you right now", ["j", "j", "j"]);
  await s.key("tab", { shift: true });
  await walk("Your boards: plain markdown files you own", ["j", "j", "l"]);
  await s.key("tab", { shift: true });
  await walk("The Agenda: your day on a ruler", ["j", "j", "j"]);
  await s.key("tab", { shift: true });
  await walk("Agents: every coding session in one list", ["j", "j", "j"]);
  await s.frame("Claude Code · Codex · OpenCode · Pi", 14);
};

/** Walk the cursor (the `▶` mark) down to the task whose line contains `text`, a frame per step. */
async function goTo(s: Stage, text: string, caption: string) {
  for (let i = 0; i < 40; i++) {
    const at = s.lines().find((l) => l.includes("▶"));
    if (at?.includes(text)) return;
    await s.key("j");
    await s.frame(caption, 1);
  }
  throw new Error(`the cursor never reached "${text}"`);
}

/** Today / Tomorrow on a narrow terminal: pull a late task to today, tick one off, push one to tomorrow. */
const planner: Scene = async () => {
  const s = await stage("planner", 64, 36, (st) => st.setActiveZone("planner"));
  await s.frame("Everything that is due, in one list", 12);
  await goTo(s, "Reply to Priya", "j / k walk the list");
  await s.frame("j / k walk the list", 6);
  await s.key("t");
  await s.frame("t pulls a late task into today", 16);
  await goTo(s, "Standup", "j / k walk the list");
  await s.key("return");
  await s.frame("Enter ticks a task off", 16);
  await goTo(s, "Write the release notes", "j / k walk the list");
  await s.frame("j / k walk the list", 6);
  await s.key("m");
  await s.frame("m sends it to tomorrow", 10);
  await goTo(s, "Write the release notes", "…where it waits under Tomorrow");
  await s.frame("…where it waits under Tomorrow", 16);
};

/** Many tasks, one key: mark with Space, act on all of them. */
const multi: Scene = async () => {
  const s = await stage("multi", 64, 36, (st) => st.setActiveZone("planner"));
  await s.frame("Late tasks pile up", 10);
  await s.key("j");
  for (let i = 0; i < 3; i++) {
    await s.key("space");
    await s.frame("Space marks tasks, in any order", 5);
    await s.key("j");
  }
  await s.frame("Space marks tasks, in any order", 8);
  await s.key("t");
  await s.frame("One key acts on all of them: t = today", 14);
};

/** Boards on a narrow terminal: move around, grab a card and carry it to another column. */
const grab: Scene = async () => {
  const s = await stage("grab", 64, 36, (st) => st.setActiveZone("board"));
  await s.frame("Your board, one column at a time", 10);
  await s.key("j");
  await s.key("j");
  await s.frame("j / k pick a card", 6);
  await s.key("g");
  await s.frame("g grabs it", 8);
  await s.key("l");
  await s.frame("h / l carry it across columns", 10);
  await s.key("g");
  await s.frame("g drops it", 14);
};

/** The Agenda's days: next day, the day after, and back to today. */
const days: Scene = async () => {
  const s = await stage("days", 64, AGENDA_ROWS, (st) => st.setActiveZone("timeline"));
  await s.frame("Today", 10);
  await s.key("]");
  await s.frame("] goes to tomorrow", 14);
  await s.key("]");
  await s.frame("…and the day after", 12);
  await s.key("\\");
  await s.frame("\\ jumps back to today", 14);
};

/** The Agents list: four harnesses, one filter key. */
const filter: Scene = async () => {
  const s = await stage("filter", 64, 36, (st) => st.setActiveZone("agents"));
  await s.frame("Every agent session on the machine", 10);
  for (let i = 0; i < 3; i++) {
    await s.key("j");
    await s.frame("j / k move through them", 4);
  }
  for (const [label, n] of [["Claude Code", 1], ["Codex", 1], ["OpenCode", 1], ["Pi", 1]] as const) {
    for (let i = 0; i < n; i++) await s.key("f");
    await s.frame(`f filters by harness: ${label}`, 12);
  }
  await s.key("f");
  await s.frame("…and back to all of them", 10);
};

/** Drag and resize: arm a block with two clicks, carry it, stretch it, let go. */
const drag: Scene = async () => {
  const s = await stage("drag", 64, AGENDA_ROWS, (st) => st.setActiveZone("timeline"));
  // From the grid down: the armed block is also named on the status line at the top.
  const at = (text: string) => s.find(text, 9);
  // Select, then arm, the deep-work block.
  const head = at("Deep work");
  await s.frame("Click a block to select it");
  await s.t.mockMouse.click(head.x + 4, head.y);
  await s.frame("Click a block to select it");
  await s.t.mockMouse.doubleClick(head.x + 4, head.y);
  await s.frame("Double-click to arm it", 6);
  // Carry it down, row by row.
  const body = at("Deep work");
  await s.t.mockMouse.pressDown(body.x + 4, body.y + 1);
  for (let k = 1; k <= 3; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", body.x + 4, body.y + 1 + k);
    await s.frame("Hold and drag to move it", k === 3 ? 6 : 3);
  }
  await s.t.mockMouse.release(body.x + 4, body.y + 4);
  // Stretch it with the handle.
  const edge = at("━ ↕");
  await s.t.mockMouse.pressDown(edge.x + 4, edge.y);
  for (let k = 1; k <= 3; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", edge.x + 4, edge.y + k);
    await s.frame("Drag the bottom edge to change its length", k === 3 ? 6 : 3);
  }
  await s.t.mockMouse.release(edge.x + 4, edge.y + 3);
  // Two clicks keep it where it is.
  const keep = at("━ ↕");
  await s.t.mockMouse.doubleClick(keep.x + 10, keep.y);
  await s.frame("Double-click again to keep it", 10);
};

/** From the tray to the clock: arm a task that has no hour, choose where it goes, nudge it. */
const tray: Scene = async () => {
  const s = await stage("tray", 64, AGENDA_ROWS, (st) => st.setActiveZone("timeline"));
  await s.frame("Today's tasks that have no hour wait in the tray", 10);
  const row = s.find("Write the release notes");
  await s.t.mockMouse.doubleClick(row.x + 4, row.y);
  await s.frame("Double-click arms a task — nothing moves", 10);
  const slot = s.find("08 ─");
  await s.t.mockMouse.click(slot.x + 10, slot.y);
  await s.frame("Click a slot to put it there", 10);
  for (const k of ["j", "j", "+", "+"]) {
    await s.key(k);
    await s.frame("…or nudge it with j / k and + / -", 3);
  }
  await s.key("return");
  await s.frame("Enter keeps it", 10);
};


// ── The launch film ──────────────────────────────────────────────────────────
// One session of the real app, resized the way a person drags a window edge. Every frame carries
// `at`, a position in beats (120 BPM, one bar = 4 beats); demo/promo/build.py turns beats into
// seconds against the music, so the same frames fit any track whose tempo it can measure.

const SINGLE = { cols: 64, rows: 44 };
const wide = { cols: 182, rows: 42 };

/** Resize the terminal and let the app refit its zones, as app.tsx does on a resize. */
async function resizeTo(s: Stage, cols: number, rows: number) {
  s.store.applyResponsiveFits({ planner: cols >= 100, timeline: cols >= 150, agents: cols >= 120 }, { narrow: cols < 100 });
  s.t.resize(cols, rows);
  await new Promise((r) => setTimeout(r, 30));
  await s.t.renderOnce();
  await s.t.renderOnce();
}

const promo: Scene = async () => {
  const s = await stage("promo", wide.cols, wide.rows, (st) => st.setActiveZone("planner"));
  const at = (beat: number) => s.frame(undefined, 1, { at: beat });
  const press = async (beat: number, key: string, mods: { shift?: boolean } = {}) => {
    await s.key(key, mods);
    await at(beat);
  };
  const zone = (z: "planner" | "board" | "timeline" | "agents") => s.store.setActiveZone(z);

  // 8-12 the dashboard, on the planner
  await at(8);
  for (const b of [9, 10, 11]) await press(b, "j");
  // 12-16 the board
  await press(12, "tab", { shift: true });
  for (const b of [13, 14]) await press(b, "j");
  await press(15, "l");
  // 16-20 the Agenda
  await press(16, "tab", { shift: true });
  for (const b of [17, 18, 19]) await press(b, "j");
  // 20-24 the agents
  await press(20, "tab", { shift: true });
  for (const b of [21, 22, 23]) await press(b, "j");
  // 24-32 zoom the agents list to a full screen of cards
  await press(24, "z");
  for (const b of [25, 26, 27, 28, 29, 30]) await press(b, "j");
  await press(31, "z"); // back to the four zones
  zone("timeline");
  await s.settle();
  await at(31.5);

  // 32-38 the window shrinks, frame by frame: what the app really does at each width
  const steps = 25;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
    const cols = Math.round(wide.cols + (SINGLE.cols - wide.cols) * e);
    const rows = Math.round(wide.rows + (SINGLE.rows - wide.rows) * e);
    await resizeTo(s, cols, rows);
    await at(32 + p * 6);
  }
  await resizeTo(s, SINGLE.cols, SINGLE.rows);
  await at(38);
  await press(39, "j");

  // 40-48 one pane at a time: Shift-Tab around the ring, a beat each
  zone("timeline");
  for (let b = 40; b < 48; b++) await press(b, "tab", { shift: true });

  // 48-56 drag: select, arm, carry, stretch, keep
  zone("timeline");
  await s.settle();
  await at(48);
  const grid = (text: string) => s.find(text, 9);
  const head = grid("Deep work");
  await s.t.mockMouse.click(head.x + 4, head.y);
  await at(48.5);
  await s.t.mockMouse.doubleClick(head.x + 4, head.y);
  await at(49.5);
  const body = grid("Deep work");
  await s.t.mockMouse.pressDown(body.x + 4, body.y + 1);
  for (let k = 1; k <= 3; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", body.x + 4, body.y + 1 + k);
    await at(49.5 + k * 0.8);
  }
  await s.t.mockMouse.release(body.x + 4, body.y + 4);
  await at(52.4);
  const edge = grid("━ ↕");
  await s.t.mockMouse.pressDown(edge.x + 4, edge.y);
  for (let k = 1; k <= 2; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", edge.x + 4, edge.y + k);
    await at(52.4 + k * 0.8);
  }
  await s.t.mockMouse.release(edge.x + 4, edge.y + 2);
  await at(54.2);
  const keep = grid("━ ↕");
  await s.t.mockMouse.doubleClick(keep.x + 10, keep.y);
  await at(55);

  // 56-62 the tray: arm a task with no hour, click a slot, nudge, keep
  const row = s.find("Write the release notes");
  await s.t.mockMouse.doubleClick(row.x + 4, row.y);
  await at(57);
  const slot = s.find("08 ─");
  await s.t.mockMouse.click(slot.x + 10, slot.y);
  await at(58.2);
  await press(59, "j");
  await press(59.6, "j");
  await press(60.2, "+");
  await press(60.8, "return");

  // 62-70 every harness in one list
  zone("agents");
  await s.settle();
  await at(62);
  await press(63, "j");
  await press(64, "f");
  await press(65.5, "f");
  await press(67, "f");
  await press(68.5, "f");
  await press(70, "f");
};

function firstRef(store: Store, title: string) {
  for (let bi = 0; bi < store.state.boards.length; bi++) {
    const b = store.state.boards[bi]!.board;
    for (let ci = 0; ci < b.columns.length; ci++) {
      let ti = 0;
      for (const ch of b.columns[ci]!.children as any[]) {
        if (!("rawLine" in ch)) continue;
        if (ch.displayTitle === title) return { boardPath: b.filepath, columnIndex: ci, taskIndex: ti };
        ti++;
      }
    }
  }
  return undefined;
}

const SCENES: Record<string, Scene> = { hero, agenda, board, today, agents, zones, planner, multi, grab, days, filter, drag, tray, promo };

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const name of names) {
  if (!SCENES[name]) {
    console.error(`unknown scene "${name}" (have: ${Object.keys(SCENES).join(", ")})`);
    process.exit(1);
  }
  try {
    await SCENES[name]!();
  } catch (e) {
    // The renderer keeps the process alive: die loudly instead of hanging.
    console.error(`scene "${name}" failed:`, e);
    process.exit(1);
  }
  console.log(`captured ${name}`);
}
process.exit(0);
