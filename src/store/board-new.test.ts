import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Config } from "~/config/loader";
import { createTuiStore } from "~/store/index";

let dir: string;
let prevCfg: string | undefined;
let prevXdg: string | undefined;
let prevHome: string | undefined;
let prevProfile: string | undefined;
/** The redirected home: `~` in the wizard is this, never the real one. */
let home: string;
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
  home = join(dir, "home");
  mkdirSync(home);
  prevHome = process.env.HOME;
  prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(() => {
  if (prevCfg === undefined) delete process.env.TUIBOARD_CONFIG;
  else process.env.TUIBOARD_CONFIG = prevCfg;
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevProfile;
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

/** Types a board through the three steps; returns the store. */
function createThrough(s: ReturnType<typeof fresh>, nameField: string) {
  openWizard(s);
  s.boardNewSubmitText(nameField);
  if (s.state.ui.boardNew?.step !== "columns") return;
  s.boardNewSubmitText("");
  s.boardNewAnswerExamples(true);
}

describe("the name field also takes a path", () => {
  it("a plain name keeps the proposed folder", async () => {
    const s = fresh();
    createThrough(s, "Work");
    expect(existsSync(join(boardsDir, "Work.md"))).toBe(true);
    await s.dispose();
  });

  it("an absolute path: the file lands there, named after the last part", async () => {
    const s = fresh();
    const target = join(dir, "elsewhere", "Plans");
    createThrough(s, target);
    expect(existsSync(target + ".md")).toBe(true);
    expect(s.state.boards[0]?.board.name).toBe("Plans");
    expect(existsSync(join(boardsDir, "Plans.md"))).toBe(false);
    await s.dispose();
  });

  it("~/x/Work goes under the home folder, with ~ expanded", async () => {
    const s = fresh();
    createThrough(s, "~/x/Work");
    expect(existsSync(join(home, "x", "Work.md"))).toBe(true);
    await s.dispose();
  });

  it("a name ending in .md loses the extension (no double .md)", async () => {
    const s = fresh();
    createThrough(s, "Work.md");
    expect(existsSync(join(boardsDir, "Work.md"))).toBe(true);
    expect(existsSync(join(boardsDir, "Work.md.md"))).toBe(false);
    await s.dispose();
  });

  it("a relative path with a separator resolves against the working folder", async () => {
    const s = fresh();
    const rel = join("tb-rel-" + Date.now(), "Work");
    try {
      createThrough(s, rel);
      expect(existsSync(resolve(rel + ".md"))).toBe(true);
    } finally {
      rmSync(resolve(dirname(rel)), { recursive: true, force: true });
    }
    await s.dispose();
  });

  it("a path with no name in it is an error and the step stays", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText(join(dir, "folder") + "/");
    expect(s.state.ui.boardNew?.step).toBe("name");
    expect(s.state.ui.boardNew?.error).toContain("no board name");
    expect(s.state.ui.boardNew?.dir).toBe(boardsDir);
    await s.dispose();
  });

  it("the typed folder shows on the next step as the folder it will live in", async () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("~/x/Work");
    expect(s.state.ui.boardNew?.step).toBe("columns");
    expect(s.state.ui.boardNew?.dir).toBe(join(home, "x"));
    expect(s.state.ui.boardNew?.name).toBe("Work");
    await s.dispose();
  });
});

describe("a write that fails does not strand the first-run wizard", () => {
  it("an existing file stays on the name step with the message and the same folder", async () => {
    mkdirSync(boardsDir, { recursive: true });
    writeFileSync(join(boardsDir, "Work.md"), "## Todo\n");
    const s = fresh();
    createThrough(s, "Work");
    const b = s.state.ui.boardNew;
    expect(b?.step).toBe("name");
    expect(b?.error).toContain("already exists");
    expect(b?.dir).toBe(boardsDir);
    await s.dispose();
  });

  it("a failing proposed folder switches to ~/tuiboard, says so, writes nothing, and a retry works", async () => {
    // XDG_DATA_HOME's tuiboard folder is a FILE: mkdir under it fails on every platform.
    writeFileSync(join(dir, "tuiboard"), "in the way");
    const s = fresh();
    createThrough(s, "Work");
    const b = s.state.ui.boardNew;
    const fallback = join(home, "tuiboard");
    expect(b?.step).toBe("name");
    expect(b?.dir).toBe(fallback);
    expect(b?.name).toBe("Work"); // the name field is prefilled, so Enter carries on
    expect(b?.error).toContain("Could not write to " + boardsDir);
    expect(b?.error).toContain("Now using " + fallback);
    expect(b?.error).toContain("Enter");
    expect(existsSync(fallback)).toBe(false);
    expect(s.state.boards).toHaveLength(0);
    // Enter again, as the message says.
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(true);
    expect(s.state.ui.boardNew).toBeUndefined();
    expect(existsSync(join(fallback, "Work.md"))).toBe(true);
    await s.dispose();
  });

  it("a failure in ~/tuiboard itself keeps the folder and points at typing a path", async () => {
    delete process.env.XDG_DATA_HOME; // the proposal is now ~/tuiboard (there is no Documents in the temp home)
    writeFileSync(join(home, "tuiboard"), "in the way");
    const s = fresh();
    createThrough(s, "Work");
    const b = s.state.ui.boardNew;
    expect(b?.step).toBe("name");
    expect(b?.dir).toBe(join(home, "tuiboard"));
    expect(b?.error).toContain("Could not write to " + join(home, "tuiboard"));
    expect(b?.error?.toLowerCase()).toContain("path");
    expect(b?.error).not.toContain("Now using");
    await s.dispose();
  });

  it("a failure in a folder the user typed keeps that folder, never switches behind their back", async () => {
    writeFileSync(join(dir, "blocked"), "in the way");
    const s = fresh();
    const typed = join(dir, "blocked", "Work");
    createThrough(s, typed);
    const b = s.state.ui.boardNew;
    expect(b?.step).toBe("name");
    expect(b?.dir).toBe(join(dir, "blocked"));
    expect(b?.error?.toLowerCase()).toContain("path");
    expect(existsSync(join(home, "tuiboard"))).toBe(false);
    await s.dispose();
  });

  it("after the switch, a second failure in ~/tuiboard does not loop or change folder", async () => {
    writeFileSync(join(dir, "tuiboard"), "in the way");
    writeFileSync(join(home, "tuiboard"), "also in the way");
    const s = fresh();
    createThrough(s, "Work");
    expect(s.state.ui.boardNew?.dir).toBe(join(home, "tuiboard"));
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(true);
    const b = s.state.ui.boardNew;
    expect(b?.step).toBe("name");
    expect(b?.dir).toBe(join(home, "tuiboard"));
    expect(b?.error).not.toContain("Now using");
    await s.dispose();
  });
});
