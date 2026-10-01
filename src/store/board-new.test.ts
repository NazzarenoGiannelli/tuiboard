import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "~/config/loader";
import { createTuiStore } from "~/store/index";

let dir: string;
let prevCfg: string | undefined;
let prevXdg: string | undefined;
/** Where the wizard proposes to create a board: XDG_DATA_HOME points at the temp dir, so never the real HOME. */
let boardsDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-wizard-"));
  writeFileSync(join(dir, "config.yaml"), "boards: []\n");
  prevCfg = process.env.TUIBOARD_CONFIG;
  process.env.TUIBOARD_CONFIG = join(dir, "config.yaml");
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  boardsDir = join(dir, "tuiboard", "boards");
});
afterEach(() => {
  if (prevCfg === undefined) delete process.env.TUIBOARD_CONFIG;
  else process.env.TUIBOARD_CONFIG = prevCfg;
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  rmSync(dir, { recursive: true, force: true });
});

function emptyConfig(): Config {
  return {
    root: dir,
    loaded: false,
    boards: [],
    assignees: [],
    doneColumn: "Done",
    archiveColumn: "Archive",
    resumeTerminal: "auto",
    resumeShell: "auto",
    statusIndicators: "symbols",
    copyResumeCommand: "x",
    zones: { planner: "on", agenda: "on", agents: "off" },
    updateCheck: true,
  };
}

function fresh() {
  return createTuiStore({ config: emptyConfig() });
}

/** Opens the create path. The wizard proposes `boardsDir` (see XDG_DATA_HOME above). */
function openWizard(store: ReturnType<typeof fresh>) {
  store.openBoardNew(true);
  store.boardNewChooseMode("create");
}

describe("the create path asks about examples after the columns", () => {
  it("name, then columns, then the examples step", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    expect(s.state.ui.boardNew?.step).toBe("columns");
    s.boardNewSubmitText("");
    expect(s.state.ui.boardNew?.step).toBe("examples");
    expect(s.state.ui.boardNew?.examples).toBe(true);
    await s.dispose();
  });

  it("yes writes the board with the example tasks and finishes", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(true);
    expect(s.state.ui.boardNew).toBeUndefined();
    expect(s.state.boards).toHaveLength(1);
    expect(readFileSync(join(boardsDir, "Work.md"), "utf-8")).toContain("Press n to add a task of your own");
    await s.dispose();
  });

  it("no writes an empty board", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(false);
    expect(readFileSync(join(boardsDir, "Work.md"), "utf-8")).not.toContain("Press n");
    await s.dispose();
  });

  it("adopting existing files never asks about examples", async () => {
    const s = fresh();
    s.openBoardNew(true);
    s.boardNewChooseMode("adopt");
    expect(s.state.ui.boardNew?.step).toBe("dir");
    await s.dispose();
  });

  it("the examples step is a two-item list that j and k move through", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewMove(1);
    expect(s.state.ui.boardNew?.sel).toBe(1);
    s.boardNewMove(5);
    expect(s.state.ui.boardNew?.sel).toBe(1);
    s.boardNewMove(-5);
    expect(s.state.ui.boardNew?.sel).toBe(0);
    await s.dispose();
  });
});
