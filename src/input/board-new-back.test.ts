import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";

// Esc in the board wizard goes back one step. Hermetic: HOME, USERPROFILE, XDG_DATA_HOME and
// TUIBOARD_CONFIG point into a temp dir, and the cwd is the temp dir, so nothing real is read or written.
const ENV_KEYS = ["HOME", "USERPROFILE", "XDG_DATA_HOME", "TUIBOARD_CONFIG"] as const;
const prevEnv: Record<string, string | undefined> = {};
let dir: string;
let prevCwd: string;
let proposed: string;
let scanned: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-esc-back-"));
  prevCwd = process.cwd();
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.XDG_DATA_HOME = dir;
  process.env.TUIBOARD_CONFIG = join(dir, "config.yaml");
  writeFileSync(join(dir, "config.yaml"), "boards: []\n");
  process.chdir(dir);
  proposed = join(dir, "tuiboard", "boards");
  scanned = join(dir, "existing");
  mkdirSync(scanned);
  writeFileSync(join(scanned, "Old.md"), "## Todo\n- [ ] one\n");
});
afterEach(() => {
  process.chdir(prevCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

function fresh() {
  return createTuiStore({
    config: {
      root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
}
type S = ReturnType<typeof fresh>;
const esc = (s: S) => handleKey(s, { name: "escape" }, 0);
const enter = (s: S) => handleKey(s, { name: "enter" }, 0);
const wiz = (s: S) => s.state.ui.boardNew;

/** mode -> adopt -> dir (the folder typed and submitted -> pick). */
function toPick(s: S) {
  s.boardNewChooseMode("adopt");
  s.boardNewSubmitText(scanned);
  expect(wiz(s)?.step).toBe("pick");
}

describe("Esc goes back one step in the wizard", () => {
  for (const mandatory of [true, false]) {
    const tag = mandatory ? "first run" : "from the + button";

    it(`${tag}: dir -> mode`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      s.boardNewChooseMode("adopt");
      expect(wiz(s)?.step).toBe("dir");
      esc(s);
      expect(wiz(s)?.step).toBe("mode");
      expect(s.state.ui.modal?.kind).toBe("board-new");
      expect(wiz(s)?.error).toBeUndefined();
    });

    it(`${tag}: pick -> dir -> mode, the scanned folder stays in the field`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      toPick(s);
      esc(s);
      expect(wiz(s)?.step).toBe("dir");
      expect(wiz(s)?.scanDir).toBe(scanned);
      esc(s);
      expect(wiz(s)?.step).toBe("mode");
      expect(s.state.ui.modal?.kind).toBe("board-new");
    });

    it(`${tag}: name -> mode`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      s.boardNewChooseMode("create");
      expect(wiz(s)?.step).toBe("name");
      esc(s);
      expect(wiz(s)?.step).toBe("mode");
      expect(s.state.ui.modal?.kind).toBe("board-new");
    });

    it(`${tag}: examples -> columns -> name -> mode, values kept`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      s.boardNewChooseMode("create");
      s.boardNewSubmitText("Work");
      s.boardNewSubmitText("A, B");
      expect(wiz(s)?.step).toBe("examples");
      esc(s);
      expect(wiz(s)?.step).toBe("columns");
      expect(wiz(s)?.columns).toBe("A, B");
      esc(s);
      expect(wiz(s)?.step).toBe("name");
      expect(wiz(s)?.name).toBe("Work");
      expect(wiz(s)?.columns).toBe("A, B");
      esc(s);
      expect(wiz(s)?.step).toBe("mode");
      expect(wiz(s)?.name).toBe("Work");
      expect(s.state.ui.modal?.kind).toBe("board-new");
    });

    it(`${tag}: the error is cleared when going back`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      s.boardNewChooseMode("adopt");
      s.boardNewSubmitText(join(dir, "nothing-here"));
      expect(wiz(s)?.error).toContain("no board files");
      esc(s);
      expect(wiz(s)?.step).toBe("mode");
      expect(wiz(s)?.error).toBeUndefined();
    });

    it(`${tag}: the cursor returns to the branch it came from`, () => {
      const s = fresh();
      s.openBoardNew(mandatory);
      s.boardNewChooseMode("adopt");
      esc(s);
      expect(wiz(s)?.sel).toBe(1);
      s.boardNewChooseMode("create");
      esc(s);
      expect(wiz(s)?.sel).toBe(0);
    });
  }

  it("the mandatory welcome ignores Esc on the mode step and stays open", () => {
    const s = fresh();
    s.openBoardNew(true);
    esc(s);
    esc(s);
    expect(wiz(s)?.step).toBe("mode");
    expect(s.state.ui.modal?.kind).toBe("board-new");
  });

  it("a dismissable wizard closes on Esc at the mode step", () => {
    const s = fresh();
    s.openBoardNew(false);
    esc(s);
    expect(s.state.ui.modal).toBeUndefined();
    expect(wiz(s)).toBeUndefined();
  });

  it("the mandatory wizard is never closed by Esc from any step", () => {
    const s = fresh();
    s.openBoardNew(true);
    s.boardNewChooseMode("create");
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    for (let i = 0; i < 6; i++) esc(s);
    expect(wiz(s)?.step).toBe("mode");
    expect(s.state.ui.modal?.kind).toBe("board-new");
    s.boardNewChooseMode("adopt");
    s.boardNewSubmitText(scanned);
    for (let i = 0; i < 6; i++) esc(s);
    expect(wiz(s)?.step).toBe("mode");
    expect(s.state.ui.modal?.kind).toBe("board-new");
  });

  it("Esc still closes the other dialogs", () => {
    const s = fresh();
    s.openModal({ kind: "setup" } as any);
    esc(s);
    expect(s.state.ui.modal).toBeUndefined();
    s.openModal({ kind: "search" } as any);
    esc(s);
    expect(s.state.ui.modal).toBeUndefined();
    expect(s.state.ui.boardNew).toBeUndefined();
  });
});

describe("the adopt folder and the create folder stay apart", () => {
  it("adopt, type a folder, Esc, choose create: the name step shows the proposal, and a board is created there", async () => {
    const s = fresh();
    s.openBoardNew(true);
    toPick(s);
    esc(s);
    esc(s);
    expect(wiz(s)?.step).toBe("mode");
    // choose "Create" through the key path, as a user would (the cursor sits on "adopt")
    handleKey(s, { name: "k" }, 0);
    enter(s);
    expect(wiz(s)?.step).toBe("name");
    expect(wiz(s)?.dir).toBe(proposed);
    expect(wiz(s)?.dirProposed).toBe(true);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(false);
    expect(existsSync(join(proposed, "Work.md"))).toBe(true);
    expect(existsSync(join(scanned, "Work.md"))).toBe(false);
    expect(s.state.ui.modal).toBeUndefined();
    await s.dispose();
  });

  it("choosing adopt again shows the folder typed before, not the proposal", () => {
    const s = fresh();
    s.openBoardNew(true);
    toPick(s);
    esc(s);
    esc(s);
    s.boardNewChooseMode("adopt");
    expect(wiz(s)?.step).toBe("dir");
    expect(wiz(s)?.scanDir).toBe(scanned);
  });

  it("a typed path in the create path survives Esc from columns back to name", () => {
    const s = fresh();
    s.openBoardNew(false);
    s.boardNewChooseMode("create");
    s.boardNewSubmitText("~/notes/Work");
    expect(wiz(s)?.step).toBe("columns");
    esc(s);
    expect(wiz(s)?.step).toBe("name");
    expect(wiz(s)?.dir).toBe(join(dir, "notes"));
    expect(wiz(s)?.name).toBe("Work");
  });

  it("the write-failure fallback still works after a round trip through adopt", () => {
    const s = fresh();
    s.openBoardNew(true);
    toPick(s);
    esc(s);
    esc(s);
    s.boardNewChooseMode("create");
    // make the proposed folder unwritable: a FILE where a folder is needed
    mkdirSync(join(dir, "tuiboard"), { recursive: true });
    writeFileSync(proposed, "not a folder");
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(false);
    expect(wiz(s)?.step).toBe("name");
    expect(wiz(s)?.dir).toBe(join(dir, "tuiboard"));
    expect(wiz(s)?.dirProposed).toBe(false);
    expect(wiz(s)?.error).toContain("Now using");
  });
});
