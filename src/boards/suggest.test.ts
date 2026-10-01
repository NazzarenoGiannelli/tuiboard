import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defaultBoardsDir, parseBoardTarget, suggestBoardsDir, userHome } from "./suggest";

const home = join("home", "me");
const noDirs = () => false;

describe("defaultBoardsDir", () => {
  it("an explicit XDG_DATA_HOME wins, as it always has", () => {
    const xdg = join("srv", "data");
    expect(defaultBoardsDir({ XDG_DATA_HOME: xdg }, home, () => true)).toBe(join(xdg, "tuiboard", "boards"));
  });

  it("uses ~/Documents/tuiboard when Documents exists", () => {
    const docs = join(home, "Documents");
    expect(defaultBoardsDir({}, home, (p) => p === docs)).toBe(join(docs, "tuiboard"));
  });

  it("falls back to ~/tuiboard when there is no Documents folder", () => {
    expect(defaultBoardsDir({}, home, noDirs)).toBe(join(home, "tuiboard"));
  });

  it("a blank XDG_DATA_HOME counts as unset", () => {
    expect(defaultBoardsDir({ XDG_DATA_HOME: "  " }, home, noDirs)).toBe(join(home, "tuiboard"));
  });
});

describe("suggestBoardsDir keeps learning from existing boards", () => {
  it("one shared folder: new boards go next to the others, whatever the default is", () => {
    const dir = join("vault", "tasks");
    expect(suggestBoardsDir({ boards: [{ path: join(dir, "a.md") }, { path: join(dir, "b.md") }] })).toContain("tasks");
  });
});

describe("defaultBoardsDir against the real file system", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tb-suggest-home-"));
  });
  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("a FILE named Documents is not a folder: falls back to ~/tuiboard", () => {
    writeFileSync(join(tmpHome, "Documents"), "not a folder");
    expect(defaultBoardsDir({}, tmpHome)).toBe(join(tmpHome, "tuiboard"));
  });

  it("a real Documents folder is used", () => {
    mkdirSync(join(tmpHome, "Documents"));
    expect(defaultBoardsDir({}, tmpHome)).toBe(join(tmpHome, "Documents", "tuiboard"));
  });

  it("no Documents at all: ~/tuiboard", () => {
    expect(defaultBoardsDir({}, tmpHome)).toBe(join(tmpHome, "tuiboard"));
  });
});

describe("parseBoardTarget: the name field also takes a path", () => {
  const h = join(resolve("/"), "home", "me");

  it("a plain name stays a plain name: no folder change", () => {
    expect(parseBoardTarget("Work", h)).toEqual({ ok: true, name: "Work" });
    expect(parseBoardTarget("My Tasks", h)).toEqual({ ok: true, name: "My Tasks" });
  });

  it("an absolute path: its folder and its name", () => {
    const dir = join(resolve("/"), "srv", "boards");
    expect(parseBoardTarget(join(dir, "Work"), h)).toEqual({ ok: true, dir, name: "Work" });
  });

  it("a trailing .md is stripped from the name; with no folder in it the proposed folder stays", () => {
    expect(parseBoardTarget("Work.md", h)).toEqual({ ok: true, name: "Work" });
    const dir = join(resolve("/"), "srv");
    expect(parseBoardTarget(join(dir, "Work.md"), h)).toEqual({ ok: true, dir, name: "Work" });
  });

  it("~/x/Work expands the home folder", () => {
    expect(parseBoardTarget("~/x/Work", h)).toEqual({ ok: true, dir: join(h, "x"), name: "Work" });
    if (process.platform === "win32") {
      expect(parseBoardTarget(String.raw`~\x\Work`, h)).toEqual({ ok: true, dir: join(h, "x"), name: "Work" });
    }
  });

  it("a relative path with a separator resolves against the working folder", () => {
    expect(parseBoardTarget("sub/Work", h)).toEqual({ ok: true, dir: resolve("sub"), name: "Work" });
  });

  it("a path with no name in it is an error, not a board called ''", () => {
    for (const bad of ["~/x/", "/", ".md", "~/x/.md"]) {
      const r = parseBoardTarget(bad, h);
      expect(r.ok).toBe(false);
    }
  });
});

describe("userHome: the home folder follows the environment, like Node's os.homedir()", () => {
  const system = () => join(resolve("/"), "from-system");

  it("win32 prefers USERPROFILE and ignores HOME", () => {
    expect(userHome({ USERPROFILE: "C:/u", HOME: "/h" }, "win32", system)).toBe("C:/u");
    expect(userHome({ HOME: "/h" }, "win32", system)).toBe(system());
  });

  it("linux and darwin prefer HOME and ignore USERPROFILE", () => {
    for (const platform of ["linux", "darwin"]) {
      expect(userHome({ HOME: "/h", USERPROFILE: "C:/u" }, platform, system)).toBe("/h");
      expect(userHome({ USERPROFILE: "C:/u" }, platform, system)).toBe(system());
    }
  });

  it("an unset or empty variable falls back to the system lookup", () => {
    expect(userHome({}, "linux", system)).toBe(system());
    expect(userHome({ HOME: "" }, "linux", system)).toBe(system());
    expect(userHome({ USERPROFILE: "" }, "win32", system)).toBe(system());
  });

  it("the real defaults give a non-empty folder and follow a runtime change of the variable", () => {
    expect(userHome().length).toBeGreaterThan(0);
    const key = process.platform === "win32" ? "USERPROFILE" : "HOME";
    const before = process.env[key];
    const dir = join(resolve("/"), "redirected-home");
    process.env[key] = dir;
    try {
      expect(userHome()).toBe(dir);
    } finally {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    }
  });
});
