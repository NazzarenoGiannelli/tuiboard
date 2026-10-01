/**
 * Which files count as boards: sync-conflict copies do not.
 *
 * Syncthing keeps the loser of an edit conflict next to the original as
 * `Name.sync-conflict-<date>-<time>-<id>.md`. It is a byte-for-byte board, so
 * without a rule against it every conflict shows up as a second candidate
 * with a long, unreadable name. The rule lives in `isBoardFile`, so the
 * onboarding scan and the loader's zero-config fallback must agree.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { loadConfig } from "~/config/loader";
import { isBoardFile, scanDirectory } from "./scan";

const TASKS = "## Todo\n- [ ] One\n- [x] Two\n";

let dir: string;
let prevCfg: string | undefined;
let prevHome: string | undefined;
let prevProfile: string | undefined;
let prevXdg: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tuiboard-scan-"));
  prevCfg = process.env.TUIBOARD_CONFIG;
  prevHome = process.env.HOME;
  prevProfile = process.env.USERPROFILE;
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.TUIBOARD_CONFIG = join(dir, "no-such-config.yaml");
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.XDG_DATA_HOME = dir;
});

afterEach(() => {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("TUIBOARD_CONFIG", prevCfg);
  restore("HOME", prevHome);
  restore("USERPROFILE", prevProfile);
  restore("XDG_DATA_HOME", prevXdg);
  rmSync(dir, { recursive: true, force: true });
});

function put(name: string, text = TASKS): string {
  const path = join(dir, name);
  writeFileSync(path, text, "utf-8");
  return path;
}

describe("sync-conflict copies are not boards", () => {
  it("isBoardFile rejects a conflict copy even when it holds checkboxes", () => {
    const path = put("Tasks - Personal.sync-conflict-20260925-111227-6ZMBDZW.md");
    expect(isBoardFile(path)).toBe(false);
  });

  it("the marker is matched in any case", () => {
    expect(isBoardFile(put("Tasks.SYNC-CONFLICT-20260925-111227-6ZMBDZW.md"))).toBe(false);
  });

  it("a Kanban-marked conflict copy is rejected too", () => {
    const path = put("Empty.sync-conflict-20260925-111227-6ZMBDZW.md", "---\n\nkanban-plugin: board\n\n---\n");
    expect(isBoardFile(path)).toBe(false);
  });

  it("a name that merely says 'conflict' is still a board", () => {
    expect(isBoardFile(put("Conflict resolution.md"))).toBe(true);
    expect(isBoardFile(put("sync-conflict notes.md"))).toBe(true);
    expect(isBoardFile(put("Merge conflict-tracker.md"))).toBe(true);
  });

  it("scanDirectory skips the conflict copies and keeps the original", () => {
    put("Tasks - Personal.md");
    put("Tasks - Personal.sync-conflict-20260925-111227-6ZMBDZW.md");
    put("Tasks - Personal.sync-conflict-20260926-080000-ABCDEFG.md");
    expect(scanDirectory(dir).map((c) => basename(c.path))).toEqual(["Tasks - Personal.md"]);
  });

  it("the loader's zero-config fallback skips them as well", () => {
    put("Tasks - Personal.md");
    put("Tasks - Personal.sync-conflict-20260925-111227-6ZMBDZW.md");
    const cfg = loadConfig({ startDir: dir });
    expect(cfg.loaded).toBe(false);
    expect(cfg.boards.map((b) => basename(b.path))).toEqual(["Tasks - Personal.md"]);
  });
});
