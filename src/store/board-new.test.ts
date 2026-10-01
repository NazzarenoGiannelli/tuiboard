import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("setupStatus follows the boards added in this session", () => {
  it("a board created by the wizard is in the status at once, and its folder is where new boards go", async () => {
    const s = fresh();
    expect(s.setupStatus().boards).toEqual([]);
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(true);
    const st = s.setupStatus();
    expect(st.boards).toHaveLength(1);
    expect(st.boards[0]).toMatchObject({ name: "Work", path: join(boardsDir, "Work.md"), exists: true });
    await s.dispose();
  });

  it("paths.boardsDir follows a board that lives elsewhere than the default folder", async () => {
    const s = fresh();
    const elsewhere = join(dir, "vault");
    mkdirSync(elsewhere, { recursive: true });
    const p = join(elsewhere, "Notes.md");
    writeFileSync(p, "## Todo\n- [ ] one\n");
    expect(s.addBoard(p, "Notes")).toEqual({ ok: true });
    const st = s.setupStatus();
    expect(st.boards.map((b) => b.name)).toEqual(["Notes"]);
    expect(st.paths.boardsDir).toBe(elsewhere);
    expect(st.paths.boardsDir).not.toBe(boardsDir);
    await s.dispose();
  });

  it("a configured board that never loaded stays listed, and is not listed twice once loaded", async () => {
    const missing = join(dir, "gone.md");
    const s = createTuiStore({ config: { ...emptyConfig(), boards: [{ path: missing, name: "Gone" }] } });
    expect(s.setupStatus().boards).toEqual([{ name: "Gone", path: missing, exists: false }]);
    const p = join(dir, "Live.md");
    writeFileSync(p, "## Todo\n");
    s.addBoard(p, "Live");
    expect(s.setupStatus().boards.map((b) => b.name)).toEqual(["Gone", "Live"]);
    await s.dispose();
  });
});
