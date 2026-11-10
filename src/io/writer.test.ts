import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConflictError, writeBoardFile } from "./writer";

describe("writeBoardFile optimistic concurrency", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("does not recreate a board deleted since it was loaded", () => {
    dir = mkdtempSync(join(tmpdir(), "tuiboard-writer-deleted-"));
    const filepath = join(dir, "board.md");
    writeFileSync(filepath, "## Todo\n- [ ] Original\n");
    const expectedMtimeMs = statSync(filepath).mtimeMs;
    unlinkSync(filepath);

    expect(() => writeBoardFile(filepath, "## Todo\n- [ ] Replacement\n", { expectedMtimeMs }))
      .toThrow(ConflictError);
    expect(existsSync(filepath)).toBe(false);
    expect(tempFiles(dir)).toEqual([]);
  });

  it("removes its temporary file when the commit fails", () => {
    dir = mkdtempSync(join(tmpdir(), "tuiboard-writer-rename-failure-"));
    const filepath = join(dir, "board.md");
    // A directory at the destination makes rename-over-target fail.
    // The writer must leave the existing destination and directory contents alone.
    const nested = join(filepath, "keep.txt");
    mkdirSync(filepath);
    writeFileSync(nested, "keep");

    expect(() => writeBoardFile(filepath, "new content")).toThrow();
    expect(readFileSync(nested, "utf-8")).toBe("keep");
    expect(tempFiles(dir)).toEqual([]);
  });
});

function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}
