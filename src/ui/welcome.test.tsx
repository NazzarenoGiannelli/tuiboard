import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { createTuiStore } from "~/store/index";
import { ModalLayer } from "~/ui/Modal";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
let dir: string;
let prevXdg: string | undefined;
const prevColumns = process.stdout.columns;

beforeEach(() => {
  // The wizard proposes a folder from XDG_DATA_HOME: never the real HOME.
  dir = mkdtempSync(join(tmpdir(), "tb-welcome-"));
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

async function welcome(width: number) {
  const store = createTuiStore({
    config: {
      root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
  // Single-pane dialogs size from the real terminal width (process.stdout.columns), which is not the test renderer's.
  process.stdout.columns = width;
  // A 40-column terminal is single-pane in the app (the responsive layer sets this).
  if (width < 60) store.setNarrow(true);
  store.openBoardNew(true);
  const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width, height: 24 });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return t.captureCharFrame();
}

describe("the welcome dialog", () => {
  it("says what tuiboard is and that only the board is required", async () => {
    const frame = await welcome(100);
    // The paragraph wraps inside the box: read it as one run of words.
    const flat = frame.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ");
    expect(frame).toContain("Welcome to tuiboard");
    expect(flat).toContain("planner");
    expect(flat).toContain("Only the board is required");
  });

  it("fits a 40-column pane: no line is cut off the right edge", async () => {
    const frame = await welcome(40);
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    expect(frame.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ")).toContain("Only the board");
  });
});

describe("the name step", () => {
  const flat = (frame: string) => frame.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ");

  async function nameStep(width: number, failFirst: boolean) {
    const store = createTuiStore({
      config: {
        root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
        resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
        zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
      } as any,
    });
    process.stdout.columns = width;
    if (width < 60) store.setNarrow(true);
    store.openBoardNew(true);
    store.boardNewChooseMode("create");
    if (failFirst) {
      writeFileSync(join(dir, "tuiboard"), "in the way"); // the proposed folder cannot be made
      store.boardNewSubmitText("Work");
      store.boardNewSubmitText("");
      store.boardNewAnswerExamples(true);
    }
    const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width, height: 24 });
    renders.push(t as any);
    await t.renderOnce(); await t.renderOnce();
    return t.captureCharFrame();
  }

  it("tells the user the folder and that a path can be typed", async () => {
    const f = flat(await nameStep(100, false));
    expect(f).toContain("It will live in");
    expect(f).toContain("Or type a path");
  });

  it("fits 40 columns, folder line and path hint included", async () => {
    const frame = await nameStep(40, false);
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    expect(flat(frame)).toContain("Or type a path");
  });

  it("after a failed write, the error and the new folder are on screen and fit 40 columns", async () => {
    const frame = await nameStep(40, true);
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    const f = flat(frame);
    expect(f).toContain("Could not write to");
    expect(f).toContain("Now using");
    expect(f).toContain("press Enter to try again");
  });
});
