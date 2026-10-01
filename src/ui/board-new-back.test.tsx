import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";
import { BottomBar } from "~/ui/Chrome";
import { ModalLayer } from "~/ui/Modal";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
const ENV_KEYS = ["HOME", "USERPROFILE", "XDG_DATA_HOME", "TUIBOARD_CONFIG"] as const;
const prevEnv: Record<string, string | undefined> = {};
const prevColumns = process.stdout.columns;
let dir: string;
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-esc-ui-"));
  prevCwd = process.cwd();
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.XDG_DATA_HOME = dir;
  process.env.TUIBOARD_CONFIG = join(dir, "config.yaml");
  writeFileSync(join(dir, "config.yaml"), "boards: []\n");
  process.chdir(dir);
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  process.chdir(prevCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

const flatten = (frame: string) => frame.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ");
const make = () => createTuiStore({
  config: {
    root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
    resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
    zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
  } as any,
});
type S = ReturnType<typeof make>;

async function dialog(s: S, width = 100, height = 30) {
  process.stdout.columns = width;
  if (width < 100) s.setNarrow(true);
  const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={s} /></box>, { width, height });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return { frame: async () => { await t.renderOnce(); await t.renderOnce(); return t.captureCharFrame(); } };
}
async function bar(s: S) {
  process.stdout.columns = 100;
  const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><BottomBar store={s} /></box>, { width: 100, height: 6 });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return t.captureCharFrame();
}

describe("the wizard's hints tell the truth about Esc", () => {
  it("mandatory welcome: no Esc in the box or on the bar; the folder step offers Esc back in both", async () => {
    const s = make();
    s.openBoardNew(true);
    const d = await dialog(s);
    expect(flatten(await d.frame())).not.toContain("Esc");
    expect(await bar(s)).not.toContain("Esc");

    handleKey(s, { name: "j" }, 0);
    handleKey(s, { name: "enter" }, 0);
    expect(s.state.ui.boardNew?.step).toBe("dir");
    expect(flatten(await d.frame())).toContain("Esc back");
    expect(await bar(s)).toContain("Esc back");
    await s.dispose();
  });

  it("every other step says Esc back in the box and on the bar, mandatory or not", async () => {
    for (const mandatory of [true, false]) {
      const s = make();
      s.openBoardNew(mandatory);
      const d = await dialog(s);
      s.boardNewChooseMode("create");
      for (const step of ["name", "columns", "examples"] as const) {
        expect(s.state.ui.boardNew?.step).toBe(step);
        expect(flatten(await d.frame())).toContain("Esc back");
        expect(await bar(s)).toContain("Esc back");
        if (step === "name") s.boardNewSubmitText("Work");
        else if (step === "columns") s.boardNewSubmitText("");
      }
      await s.dispose();
    }
  });

  it("non-mandatory mode step still says Esc cancel", async () => {
    const s = make();
    s.openBoardNew(false);
    const d = await dialog(s);
    expect(flatten(await d.frame())).toContain("Esc cancel");
    expect(await bar(s)).toContain("Esc cancel");
    await s.dispose();
  });

  it("the pick step keeps its in-box hint", async () => {
    writeFileSync(join(dir, "Old.md"), "## Todo\n- [ ] one\n");
    const s = make();
    s.openBoardNew(true);
    s.boardNewChooseMode("adopt");
    s.boardNewSubmitText(dir);
    expect(s.state.ui.boardNew?.step).toBe("pick");
    const d = await dialog(s, 100, 30);
    expect(flatten(await d.frame())).toContain("Space tick · Enter adopt · Esc back");
    await s.dispose();
  });

  it("Esc from the folder step shows the welcome again, and 40 columns do not overflow", async () => {
    const s = make();
    s.openBoardNew(true);
    s.boardNewChooseMode("adopt");
    const d = await dialog(s, 40, 24);
    handleKey(s, { name: "escape" }, 0);
    const frame = await d.frame();
    expect(flatten(frame)).toContain("Welcome to tuiboard");
    expect(flatten(frame)).toContain("Create a new board");
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    await s.dispose();
  });
});
