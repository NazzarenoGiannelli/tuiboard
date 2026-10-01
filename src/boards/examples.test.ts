import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBoard } from "~/cli/board";
import { parseBoard } from "~/parser/markdown";
import { createBoardFile, exampleTasks } from "./create";

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min);

describe("exampleTasks", () => {
  it("four tasks, all dated today, one with a half-hour block", () => {
    const lines = exampleTasks(at(2026, 10, 1, 9, 12));
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(l.startsWith("- [ ] ")).toBe(true);
      expect(l).toContain("⏳ 2026-10-01");
    }
    const withBlock = lines.filter((l) => l.includes("⌚"));
    expect(withBlock).toHaveLength(1);
    expect(withBlock[0]).toContain("⌚ 09:30-10:00");
  });

  it("the block starts at the next half hour that is at least 10 minutes away", () => {
    expect(exampleTasks(at(2026, 10, 1, 9, 20)).find((l) => l.includes("⌚"))).toContain("⌚ 09:30-10:00");
    expect(exampleTasks(at(2026, 10, 1, 9, 21)).find((l) => l.includes("⌚"))).toContain("⌚ 10:00-10:30");
    expect(exampleTasks(at(2026, 10, 1, 14, 0)).find((l) => l.includes("⌚"))).toContain("⌚ 14:30-15:00");
  });

  it("22:20 still fits today; 22:21 does not", () => {
    expect(exampleTasks(at(2026, 10, 1, 22, 20)).find((l) => l.includes("⌚"))).toContain("⌚ 22:30-23:00");
    const late = exampleTasks(at(2026, 10, 1, 22, 21)).find((l) => l.includes("⌚"))!;
    expect(late).toContain("⌚ 09:00-09:30");
    expect(late).toContain("⏳ 2026-10-02");
  });

  it("rolls over a month and a year when it moves to tomorrow", () => {
    expect(exampleTasks(at(2026, 10, 31, 23, 55)).find((l) => l.includes("⌚"))).toContain("⏳ 2026-11-01");
    expect(exampleTasks(at(2026, 12, 31, 23, 55)).find((l) => l.includes("⌚"))).toContain("⏳ 2027-01-01");
  });

  it("the other tasks stay dated today even when the block moves to tomorrow", () => {
    const lines = exampleTasks(at(2026, 10, 1, 23, 30));
    expect(lines.filter((l) => !l.includes("⌚")).every((l) => l.includes("⏳ 2026-10-01"))).toBe(true);
  });
});

describe("createBoardFile with examples", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tb-examples-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (path: string) => parseBoard(readFileSync(path, "utf-8"), { filepath: path }).board;
  const isTask = (c: any) => typeof c.rawLine === "string" && c.rawLine.startsWith("- [");

  it("puts them in the first column and parses back as real tasks", () => {
    const path = join(dir, "A.md");
    createBoardFile(path, { columns: ["Todo", "Doing", "Done"], examples: exampleTasks(at(2026, 10, 1, 9, 12)) });
    const board = read(path);
    expect(board.columns.map((c) => c.name)).toEqual(["Todo", "Doing", "Done"]);
    const tasks = board.columns[0]!.children.filter(isTask) as any[];
    expect(tasks).toHaveLength(4);
    expect(board.columns[1]!.children.filter(isTask)).toHaveLength(0);
    expect(board.columns[2]!.children.filter(isTask)).toHaveLength(0);
    const blocked = tasks.find((t) => t.timeBlock);
    expect(blocked.timeBlock).toEqual({ startMin: 9 * 60 + 30, endMin: 10 * 60 });
    expect(blocked.scheduled).toBe("2026-10-01");
  });

  it("skips a Done or Archive first column", () => {
    const path = join(dir, "B.md");
    createBoardFile(path, { columns: ["Done", "Inbox"], examples: ["- [ ] x ⏳ 2026-10-01"] });
    const board = read(path);
    expect(board.columns[0]!.children.some(isTask)).toBe(false);
    expect(board.columns[1]!.children.some(isTask)).toBe(true);
  });

  it("with only hidden columns the first one takes them", () => {
    const path = join(dir, "C.md");
    createBoardFile(path, { columns: ["Done", "Archive"], examples: ["- [ ] x ⏳ 2026-10-01"] });
    const board = read(path);
    expect(board.columns[0]!.children.some(isTask)).toBe(true);
    expect(board.columns[1]!.children.some(isTask)).toBe(false);
  });

  it("without examples the file is exactly what it was before", () => {
    const path = join(dir, "D.md");
    createBoardFile(path, { columns: ["Todo", "Done"] });
    expect(readFileSync(path, "utf-8")).toBe("---\n\nkanban-plugin: board\n\n---\n\n## Todo\n\n## Done\n\n");
  });
});

describe("tuiboard board add --examples", () => {
  it("creates the board with the example tasks in it", async () => {
    const d = mkdtempSync(join(tmpdir(), "tb-cli-"));
    const cfg = join(d, "config.yaml");
    writeFileSync(cfg, "boards: []\n");
    const prev = process.env.TUIBOARD_CONFIG;
    process.env.TUIBOARD_CONFIG = cfg;
    const log = console.log;
    console.log = () => {};
    try {
      const code = await runBoard(["add", "--path", join(d, "Work.md"), "--examples"]);
      expect(code).toBe(0);
      expect(existsSync(join(d, "Work.md"))).toBe(true);
      expect(readFileSync(join(d, "Work.md"), "utf-8")).toContain("Press n to add a task of your own");
    } finally {
      console.log = log;
      if (prev === undefined) delete process.env.TUIBOARD_CONFIG; else process.env.TUIBOARD_CONFIG = prev;
      rmSync(d, { recursive: true, force: true });
    }
  });
});
