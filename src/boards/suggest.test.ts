import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { defaultBoardsDir, suggestBoardsDir } from "./suggest";

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
