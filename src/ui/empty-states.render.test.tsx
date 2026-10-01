import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { createTuiStore, isoToday } from "~/store/index";
import { AgentsBar } from "~/ui/AgentsBar";
import { BoardView } from "~/ui/BoardView";
import { PlannerPanel } from "~/ui/PlannerPanel";
import { TimelineView } from "~/ui/TimelineView";
import { AGENTS_EMPTY, BOARD_EMPTY, CALENDAR_HINT, PLANNER_EMPTY } from "~/ui/empty-states";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
const stores: Array<{ dispose: () => unknown }> = [];
let dir: string;
let prevXdg: string | undefined;
const prevColumns = process.stdout.columns;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-empty-"));
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  for (const s of stores.splice(0)) s.dispose();
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

// The agents zone is "off": its store is a no-op, so no real session on this
// machine can leak into the frame.
function store(board?: string, narrow = false) {
  let boards: Array<{ path: string }> = [];
  if (board !== undefined) {
    const path = join(dir, "a.md");
    writeFileSync(path, board);
    boards = [{ path }];
  }
  const s = createTuiStore({
    config: {
      root: dir, loaded: false, boards, assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
  stores.push(s);
  // A 40-column terminal is single-pane in the app (the responsive layer sets this).
  if (narrow) s.setNarrow(true);
  return s;
}

async function frame(node: () => any, width: number, height: number) {
  const t = await testRender(node, { width, height });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return t.captureCharFrame();
}

/** Wrapped copy read as one run of words, the box drawing taken out. */
const flatten = (f: string) => f.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ");

describe("empty states on screen", () => {
  it("the planner says how a task gets here", async () => {
    const s = store();
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><PlannerPanel store={s} /></box>, 60, 12);
    expect(f).toContain(PLANNER_EMPTY[0]!);
    expect(f).toContain("Give a task a date");
  });

  it("the agents strip says what it reads", async () => {
    const s = store();
    expect(s.agentSessions()).toHaveLength(0);
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><AgentsBar store={s} height={7} /></box>, 100, 9);
    expect(f).toContain(AGENTS_EMPTY[0]!);
    expect(f).toContain("Claude Code, Codex, OpenCode and Pi");
  });

  it("a 40-column planner wraps the copy inside its border", async () => {
    // Single-pane, as the app is at 40 columns: the planner fills the screen.
    const s = store(undefined, true);
    s.setActiveZone("planner");
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><PlannerPanel store={s} /></box>, 40, 12);
    const flat = flatten(f);
    expect(flat).toContain(PLANNER_EMPTY[0]!);
    expect(flat).toContain(PLANNER_EMPTY[1]!);
    // The right border is still there on every row that carries copy.
    for (const line of f.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
      if (/Nothing|Give a|bring|today/.test(line)) expect(line.trimEnd().endsWith("│")).toBe(true);
    }
  });

  it("a 40-column agents strip wraps the copy inside its border", async () => {
    const s = store();
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><AgentsBar store={s} height={9} /></box>, 40, 10);
    const flat = flatten(f);
    expect(flat).toContain(AGENTS_EMPTY[0]!);
    expect(flat).toContain("start one and it shows up here.");
    for (const line of f.split("\n")) {
      if (/sessions|tuiboard|Claude|start one|shows up/.test(line)) expect(line.trimEnd().endsWith("│")).toBe(true);
    }
  });
});

describe("the board", () => {
  const boardFrame = async (md: string, width = 100) => {
    process.stdout.columns = width;
    const s = store(md, width < 60);
    return frame(
      () => <box style={{ width: "100%", height: "100%" }}><BoardView store={s} board={s.state.boards[0]!.board} /></box>,
      width, 14,
    );
  };

  it("an empty board says how to add the first task, once", async () => {
    const f = await boardFrame("## Todo\n\n## Doing\n");
    expect(f).toContain(BOARD_EMPTY);
    expect(f.split(BOARD_EMPTY).length - 1).toBe(1);
  });

  it("goes away once there is a task", async () => {
    const f = await boardFrame("## Todo\n\n- [ ] Write the thing\n\n## Doing\n");
    expect(f).toContain("Write the thing");
    expect(f).not.toContain(BOARD_EMPTY);
  });

  it("stays visible in a 40-column pane", async () => {
    const f = await boardFrame("## Todo\n\n## Doing\n", 40);
    expect(flatten(f)).toContain(BOARD_EMPTY);
    for (const line of f.split("\n")) {
      if (/Press|first task/.test(line)) expect(line.trimEnd().endsWith("│")).toBe(true);
    }
  });
});

describe("the agenda calendar hint", () => {
  const agenda = async (md: string) => {
    const s = store(md);
    return frame(
      () => (
        <box style={{ flexDirection: "row", width: "100%", height: "100%" }}>
          <TimelineView store={s} width={56} />
        </box>
      ),
      60, 30,
    );
  };

  it("shows while no calendar is set up and the day is empty", async () => {
    const f = await agenda("## Todo\n\n");
    expect(f).toContain(CALENDAR_HINT);
  });

  it("is gone once the day has a task", async () => {
    const f = await agenda(`## Todo\n\n- [ ] Alpha ⏳ ${isoToday()}\n`);
    expect(f).toContain("Alpha");
    expect(f).not.toContain(CALENDAR_HINT);
  });
});
