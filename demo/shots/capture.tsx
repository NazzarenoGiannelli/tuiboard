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
 * The clock is frozen at 09:41 today so the "now" line sits between two blocks and every run
 * makes the same pictures. Boards are re-seeded first: the pictures never show anything
 * but the invented demo.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testRender } from "@opentui/solid";

// ── Freeze the clock (before anything reads it) ──────────────────────────────
const RealDate = Date;
const NOW = (() => {
  const d = new RealDate();
  d.setHours(9, 41, 0, 0);
  return d.getTime();
})();
(globalThis as any).Date = class extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [any]));
  }
  static now() {
    return NOW;
  }
};

import { seedDemo } from "../seed";
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
  /** Let timers and renders settle, then save a frame. */
  frame(caption?: string, hold?: number): Promise<void>;
}

async function stage(scene: string, cols: number, rows: number, setup: (s: Store) => void): Promise<Stage> {
  seedDemo();
  process.env.TUIBOARD_CONFIG = join(here, "..", "config.yaml");
  const store = createTuiStore({ config: loadConfig() });
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
    async frame(caption, hold = 1) {
      await settle();
      const f: any = t.captureSpans();
      const col = (c: any) => (c ? Array.from(c.buffer ?? c).map((v: any) => Number(v)) : null);
      const data = {
        cols: f.cols,
        rows: f.rows,
        caption: caption ?? null,
        hold,
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

/** A narrow, vertical terminal: one pane at a time, the Agenda with its tray and boxes. */
const single: Scene = async () => {
  const s = await stage("single", 64, 36, (st) => {
    st.setActiveZone("timeline");
  });
  await s.frame();
};

/** Drag and resize: arm a block with two clicks, carry it, stretch it, let go. */
const drag: Scene = async () => {
  const s = await stage("drag", 64, 36, (st) => st.setActiveZone("timeline"));
  const at = (text: string) => s.find(text);
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
  for (let k = 1; k <= 5; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", body.x + 4, body.y + 1 + k);
    await s.frame("Hold and drag to move it", k === 5 ? 6 : 2);
  }
  await s.t.mockMouse.release(body.x + 4, body.y + 6);
  // Stretch it with the handle.
  const edge = at("━ ↕");
  await s.t.mockMouse.pressDown(edge.x + 4, edge.y);
  for (let k = 1; k <= 4; k++) {
    await s.t.mockMouse.emitMouseEvent("drag", edge.x + 4, edge.y + k);
    await s.frame("Drag the bottom edge to change its length", k === 4 ? 6 : 2);
  }
  await s.t.mockMouse.release(edge.x + 4, edge.y + 4);
  // Two clicks keep it where it is.
  const keep = at("━ ↕");
  await s.t.mockMouse.doubleClick(keep.x + 10, keep.y);
  await s.frame("Double-click again to keep it", 10);
};

/** From the tray to the clock: arm a task that has no hour, choose where it goes, nudge it. */
const tray: Scene = async () => {
  const s = await stage("tray", 64, 36, (st) => st.setActiveZone("timeline"));
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

const SCENES: Record<string, Scene> = { hero, single, drag, tray };

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
