import { describe, expect, it } from "bun:test";

import { isTask, parseBoard } from "~/parser/markdown";
import { serializeBoard } from "~/parser/serialize";
import type { Task } from "~/types";
import { addDays, buildDemoBoards, todayLocal } from "./seed";

const TODAY = "2026-10-15";

function tasks(): Task[] {
  const out: Task[] = [];
  for (const b of buildDemoBoards(TODAY)) {
    const { board } = parseBoard(b.content, { filepath: b.file });
    for (const col of board.columns) for (const c of col.children) if (isTask(c)) out.push(c);
  }
  return out;
}

describe("demo boards", () => {
  it("parse cleanly and survive a roundtrip byte for byte", () => {
    for (const b of buildDemoBoards(TODAY)) {
      const { board, diagnostics } = parseBoard(b.content, { filepath: b.file });
      expect(diagnostics).toEqual([]);
      expect(serializeBoard(board)).toBe(b.content);
    }
  });

  it("are the same text for the same day, and move with the day", () => {
    expect(buildDemoBoards(TODAY)).toEqual(buildDemoBoards(TODAY));
    expect(buildDemoBoards(TODAY)[0]!.content).not.toBe(buildDemoBoards(addDays(TODAY, 1))[0]!.content);
  });

  it("cover every case the Agenda and the planner have to get right", () => {
    const all = tasks();
    const open = all.filter((t) => !t.done);
    const scheduled = (n: number) => open.filter((t) => t.scheduled === addDays(TODAY, n));

    expect(open.filter((t) => t.scheduled && t.scheduled < TODAY).length).toBeGreaterThanOrEqual(4); // overdue
    expect(open.filter((t) => t.due && t.due < TODAY).length).toBeGreaterThanOrEqual(1); // past its due date
    expect(scheduled(0).filter((t) => !t.timeBlock).length).toBeGreaterThanOrEqual(3); // today, the "To place" tray
    expect(scheduled(0).filter((t) => t.timeBlock).length).toBeGreaterThanOrEqual(6); // today, on the clock
    expect(scheduled(1).length).toBeGreaterThanOrEqual(3); // tomorrow
    expect(scheduled(1).some((t) => t.timeBlock)).toBe(true); // ...one of them on the clock
    expect(open.filter((t) => t.scheduled && t.scheduled > addDays(TODAY, 1)).length).toBeGreaterThanOrEqual(4); // coming days
    expect(open.some((t) => !t.scheduled && t.due)).toBe(true); // dated only by a due date
    expect(all.filter((t) => t.done && t.doneDate === TODAY).length).toBeGreaterThanOrEqual(2); // done today
    expect(all.filter((t) => t.done && t.doneDate === addDays(TODAY, -1)).length).toBeGreaterThanOrEqual(1); // done yesterday
    expect(open.filter((t) => !t.scheduled && !t.due).length).toBeGreaterThanOrEqual(2); // undated backlog
  });

  it("has today's blocks that nest, overlap in part and touch, and all of them carry an hour", () => {
    const blocks = tasks()
      .filter((t) => !t.done && t.scheduled === TODAY && t.timeBlock)
      .map((t) => t.timeBlock!);
    const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) =>
      a.startMin < b.endMin && b.startMin < a.endMin;
    const nested = blocks.some((a) => blocks.some((b) => a !== b && a.startMin <= b.startMin && b.endMin <= a.endMin));
    const partial = blocks.some((a) =>
      blocks.some((b) => a !== b && overlaps(a, b) && a.startMin < b.startMin && a.endMin < b.endMin),
    );
    expect(nested).toBe(true);
    expect(partial).toBe(true);
    expect(blocks.every((b) => b.endMin > b.startMin)).toBe(true);
  });

  it("uses invented names only: nothing from a real setup", () => {
    const text = buildDemoBoards(TODAY).map((b) => b.content).join("\n").toLowerCase();
    for (const real of ["r3plica", "blits", "medilab", "nazz", "giannelli"]) expect(text).not.toContain(real);
  });

  it("no title contains a hash: it would be read as a tag and vanish from the title", () => {
    for (const t of tasks()) expect(t.displayTitle).not.toContain("#");
  });

  it("addDays handles month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
