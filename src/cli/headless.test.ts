/**
 * The headless CLI — `tuiboard task` and `tuiboard summary`.
 *
 * These are the only commands that write to the user's real board files from
 * outside the TUI (a bar widget, a cron job), so they are tested against a
 * real board on disk rather than a parsed fixture: the round trip through
 * parse → mutate → serialize → write is exactly what can lose data.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConflictError, statMtime, writeBoardFile } from "~/io/writer";
import { buildSummary } from "./summary";
import { runTask } from "./task";

const BOARD = `---

kanban-plugin: board

---

## Home
- [ ] Bollette ⏳ 2026-08-31
- [x] Spesa ⏳ 2026-08-31 ✅ 2026-08-31
- [ ] Chiamare idraulico 📅 2026-08-31
- [ ] Cambiare gomme
- [ ] Ambiguo uno
- [ ] Ambiguo due
`;

let dir: string;
let boardPath: string;
let configPath: string;
let previousConfig: string | undefined;

/** Days from today as YYYY-MM-DD, in local time — matches the CLI's own clock. */
function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function board(): string {
  return readFileSync(boardPath, "utf-8");
}

function line(title: string): string {
  const hit = board()
    .split("\n")
    .find((l) => l.includes(title));
  if (!hit) throw new Error(`no line matching "${title}" in board`);
  return hit;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tuiboard-cli-"));
  boardPath = join(dir, "Board.md");
  configPath = join(dir, "config.yaml");
  writeFileSync(boardPath, BOARD, "utf-8");
  writeFileSync(configPath, `boards:\n  - path: ${boardPath}\n    name: Test\n`, "utf-8");
  previousConfig = process.env.TUIBOARD_CONFIG;
  process.env.TUIBOARD_CONFIG = configPath;
});

afterEach(() => {
  if (previousConfig === undefined) delete process.env.TUIBOARD_CONFIG;
  else process.env.TUIBOARD_CONFIG = previousConfig;
  rmSync(dir, { recursive: true, force: true });
});

const args = (...rest: string[]) => ["--board", "Test", "--column", "Home", ...rest];

describe("tuiboard task done", () => {
  it("ticks the task and stamps today's completion date", async () => {
    expect(await runTask(["done", ...args("--match", "Bollette")])).toBe(0);
    expect(line("Bollette")).toBe(`- [x] Bollette ⏳ 2026-08-31 ✅ ${iso(0)}`);
  });

  it("leaves an already-done task untouched", async () => {
    const before = line("Spesa");
    expect(await runTask(["done", ...args("--match", "Spesa")])).toBe(0);
    expect(line("Spesa")).toBe(before);
  });
});

describe("tuiboard task undone", () => {
  it("reopens a completed task and drops the completion date with it", async () => {
    expect(await runTask(["undone", ...args("--match", "Spesa")])).toBe(0);
    expect(line("Spesa")).toBe("- [ ] Spesa ⏳ 2026-08-31");
  });

  it("is the exact inverse of done — round trip restores the line", async () => {
    const before = line("Bollette");
    expect(await runTask(["done", ...args("--match", "Bollette")])).toBe(0);
    expect(await runTask(["undone", ...args("--match", "Bollette")])).toBe(0);
    expect(line("Bollette")).toBe(before);
  });

  it("leaves an already-open task untouched", async () => {
    const before = line("Bollette");
    expect(await runTask(["undone", ...args("--match", "Bollette")])).toBe(0);
    expect(line("Bollette")).toBe(before);
  });
});

describe("tuiboard task defer", () => {
  it("moves `scheduled` when the task has one", async () => {
    expect(await runTask(["defer", ...args("--match", "Bollette")])).toBe(0);
    expect(line("Bollette")).toBe(`- [ ] Bollette ⏳ ${iso(1)}`);
  });

  it("moves `due` when that is the only date — the field the planner reads", async () => {
    expect(await runTask(["defer", ...args("--match", "idraulico")])).toBe(0);
    expect(line("idraulico")).toBe(`- [ ] Chiamare idraulico 📅 ${iso(1)}`);
  });

  it("schedules an undated task, which is what puts it on the agenda", async () => {
    expect(await runTask(["defer", ...args("--match", "gomme")])).toBe(0);
    expect(line("gomme")).toBe(`- [ ] Cambiare gomme ⏳ ${iso(1)}`);
  });

  it("--days 0 pulls a task back to today", async () => {
    expect(await runTask(["defer", ...args("--match", "Bollette", "--days", "0")])).toBe(0);
    expect(line("Bollette")).toBe(`- [ ] Bollette ⏳ ${iso(0)}`);
  });

  it("--to takes an explicit date", async () => {
    expect(await runTask(["defer", ...args("--match", "Bollette", "--to", "2027-01-15")])).toBe(0);
    expect(line("Bollette")).toBe("- [ ] Bollette ⏳ 2027-01-15");
  });

  it("rejects a malformed --to without touching the board", async () => {
    const before = board();
    expect(await runTask(["defer", ...args("--match", "Bollette", "--to", "15/01/2027")])).toBe(2);
    expect(board()).toBe(before);
  });
});

describe("tuiboard task — refusing to guess", () => {
  it("writes nothing when the match is ambiguous", async () => {
    const before = board();
    expect(await runTask(["done", ...args("--match", "Ambiguo")])).toBe(1);
    expect(board()).toBe(before);
  });

  it("writes nothing when nothing matches", async () => {
    const before = board();
    expect(await runTask(["done", ...args("--match", "inesistente")])).toBe(1);
    expect(board()).toBe(before);
  });

  it("--dry-run reports success and leaves the file alone", async () => {
    const before = board();
    expect(await runTask(["done", ...args("--match", "Bollette", "--dry-run")])).toBe(0);
    expect(board()).toBe(before);
  });

  it("refuses the write when the board moved on since it was read", () => {
    // What `runTask` maps to exit 3. Driven through the writer directly: the
    // race it guards against — the file changing between the read and the
    // write — cannot be staged from outside the function that spans it.
    const stale = statMtime(boardPath);
    const past = new Date(Date.now() - 60_000);
    utimesSync(boardPath, past, past);
    const before = board();
    expect(() => writeBoardFile(boardPath, "clobbered", { expectedMtimeMs: stale }))
      .toThrow(ConflictError);
    expect(board()).toBe(before);
  });
});

describe("tuiboard summary — planner entries", () => {
  it("reports whether a Today entry is already ticked", async () => {
    // The board's dates are fixed, so the summary is asked for that same day.
    const s = buildSummary({ next: 0, today: "2026-08-31" });
    const today = s.planner.today;
    const bollette = today.find((e) => e.title === "Bollette");
    const spesa = today.find((e) => e.title === "Spesa");

    expect(bollette?.done).toBe(false);
    expect(bollette?.doneDate).toBeUndefined();
    expect(spesa?.done).toBe(true);
    expect(spesa?.doneDate).toBe("2026-08-31");
  });

  it("follows a task through done and back", async () => {
    await runTask(["done", ...args("--match", "Bollette")]);
    const done = buildSummary({ next: 0, today: "2026-08-31" })
      .planner.today.find((e) => e.title === "Bollette");
    expect(done?.done).toBe(true);

    await runTask(["undone", ...args("--match", "Bollette")]);
    const reopened = buildSummary({ next: 0, today: "2026-08-31" })
      .planner.today.find((e) => e.title === "Bollette");
    expect(reopened?.done).toBe(false);
    expect(reopened?.doneDate).toBeUndefined();
  });
});
