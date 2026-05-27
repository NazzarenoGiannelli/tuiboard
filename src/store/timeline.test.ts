import { describe, expect, it } from "bun:test";

import type { Board, Task } from "~/types";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  TOTAL_ROWS,
  buildRowMap,
  buildTimelineEntries,
  countOverlaps,
  formatHm,
  type TimelineEntry,
} from "./timeline";

/** Build a minimal Task object for testing. Only fields touched by timeline. */
function makeTask(opts: Partial<Task> & Pick<Task, "displayTitle">): Task {
  const base: Partial<Task> = {
    id: "0:0",
    rawBody: opts.displayTitle,
    rawLine: `- [ ] ${opts.displayTitle}`,
    done: false,
    priority: "none",
    tags: [],
    wikilinks: [],
    dirty: false,
  };
  return { ...base, ...opts } as Task;
}

function makeBoard(name: string, filepath: string, tasks: Task[]): Board {
  return {
    name,
    filepath,
    frontmatter: "",
    preamble: "",
    trailer: "",
    lineEnding: "\n",
    originalContent: "",
    columns: [
      {
        name: "Inbox",
        headerLevel: 2,
        rawHeading: "## Inbox",
        children: tasks,
      },
    ],
  };
}

describe("buildTimelineEntries", () => {
  const today = "2026-05-27";

  it("returns empty when no tasks are time-blocked today", () => {
    const t = makeTask({ displayTitle: "no time block", scheduled: today });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("includes a scheduled, time-blocked, non-done task for today", () => {
    const t = makeTask({
      displayTitle: "outreach",
      scheduled: today,
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 + 30 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    const entries = buildTimelineEntries([board], today);
    expect(entries.length).toBe(1);
    expect(entries[0]!.startMin).toBe(540);
    expect(entries[0]!.endMin).toBe(630);
    // 9:00 = row 8 (since DAY_START=7, 60min/15 = 4 rows per hour)
    expect(entries[0]!.startRow).toBe(8);
    // 90min duration = 6 rows
    expect(entries[0]!.endRow).toBe(14);
  });

  it("excludes done tasks", () => {
    const t = makeTask({
      displayTitle: "done deal",
      done: true,
      scheduled: today,
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("excludes tasks scheduled for a different date", () => {
    const t = makeTask({
      displayTitle: "tomorrow",
      scheduled: "2026-05-28",
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("clips blocks that span outside the rendered window", () => {
    const t = makeTask({
      displayTitle: "early",
      scheduled: today,
      // 6:30-7:30 → only 7:00-7:30 visible (rows 0-1)
      timeBlock: { startMin: 6 * 60 + 30, endMin: 7 * 60 + 30 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    const entries = buildTimelineEntries([board], today);
    expect(entries.length).toBe(1);
    expect(entries[0]!.startRow).toBe(0); // clipped at top
  });

  it("skips blocks entirely outside the window", () => {
    const t = makeTask({
      displayTitle: "midnight",
      scheduled: today,
      timeBlock: { startMin: 0, endMin: 30 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("sorts entries by startMin", () => {
    const t1 = makeTask({
      displayTitle: "afternoon",
      scheduled: today,
      timeBlock: { startMin: 14 * 60, endMin: 15 * 60 },
    });
    const t2 = makeTask({
      displayTitle: "morning",
      scheduled: today,
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 },
    });
    const board = makeBoard("R3PLICA", "r3.md", [t1, t2]);
    const entries = buildTimelineEntries([board], today);
    expect(entries.map((e) => e.task.displayTitle)).toEqual([
      "morning",
      "afternoon",
    ]);
  });
});

describe("buildRowMap", () => {
  it("returns TOTAL_ROWS entries", () => {
    const map = buildRowMap([], 0);
    expect(map.length).toBe(TOTAL_ROWS);
  });

  it("marks hour-anchor rows with kind=hour and the hour value", () => {
    const map = buildRowMap([], 0);
    // Row 0 = DAY_START_HOUR
    expect(map[0]).toEqual({ kind: "hour", hour: DAY_START_HOUR });
    // Row 4 = DAY_START_HOUR + 1
    expect(map[4]).toEqual({ kind: "hour", hour: DAY_START_HOUR + 1 });
    // Row 1 = 15min past hour, empty
    expect(map[1]?.kind).toBe("empty");
  });

  it("places an entry as head/body/fill across its rows", () => {
    const entry: TimelineEntry = {
      ref: { boardPath: "x", columnIndex: 0, taskIndex: 0 },
      task: makeTask({ displayTitle: "block" }),
      boardName: "R3PLICA",
      boardIndex: 0,
      columnName: "Inbox",
      startMin: 9 * 60,
      endMin: 10 * 60 + 30,
      startRow: 8,
      endRow: 14,
    };
    const map = buildRowMap([entry], 0);
    expect(map[8]?.kind).toBe("head");
    expect(map[9]?.kind).toBe("body");
    expect(map[10]?.kind).toBe("fill");
    expect(map[13]?.kind).toBe("fill");
    expect(map[14]?.kind).not.toBe("fill"); // end exclusive
  });

  it("overlays a now marker at the current minute", () => {
    const nowMin = 10 * 60 + 30; // 10:30 → row 14
    const map = buildRowMap([], nowMin);
    expect(map[14]?.kind).toBe("now");
    expect(map[14]?.nowMin).toBe(nowMin);
  });

  it("does not place a now marker when out of window", () => {
    const map = buildRowMap([], 3 * 60); // 03:00, before DAY_START
    expect(map.some((r) => r.kind === "now")).toBe(false);
  });
});

describe("countOverlaps", () => {
  function entry(s: number, e: number): TimelineEntry {
    return {
      ref: { boardPath: "x", columnIndex: 0, taskIndex: 0 },
      task: makeTask({ displayTitle: "x" }),
      boardName: "X",
      boardIndex: 0,
      columnName: "X",
      startMin: s,
      endMin: e,
      startRow: 0,
      endRow: 0,
    };
  }

  it("returns 0 for non-overlapping blocks", () => {
    expect(
      countOverlaps([entry(540, 600), entry(600, 660), entry(720, 780)]),
    ).toBe(0);
  });

  it("counts overlapping pairs", () => {
    expect(countOverlaps([entry(540, 660), entry(600, 720)])).toBe(1);
  });

  it("counts every overlapping pair in a 3-way overlap", () => {
    expect(
      countOverlaps([entry(540, 660), entry(600, 720), entry(630, 700)]),
    ).toBe(3);
  });
});

describe("formatHm", () => {
  it("zero-pads hours and minutes", () => {
    expect(formatHm(0)).toBe("00:00");
    expect(formatHm(540)).toBe("09:00");
    expect(formatHm(615)).toBe("10:15");
    expect(formatHm(23 * 60 + 59)).toBe("23:59");
  });
});

// silence unused-var lint about MINS_PER_ROW import
void MINS_PER_ROW;
