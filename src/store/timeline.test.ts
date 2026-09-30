import { describe, expect, it } from "bun:test";

import type { Board, Task } from "~/types";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  TOTAL_ROWS,
  buildRowMap,
  buildCalendarEntries,
  buildTimelineEntries,
  buildUnscheduledToday,
  countOverlaps,
  findFreeSlot,
  formatAgendaDay,
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
    const board = makeBoard("Work", "work.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("includes a scheduled, time-blocked, non-done task for today", () => {
    const t = makeTask({
      displayTitle: "outreach",
      scheduled: today,
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 + 30 },
    });
    const board = makeBoard("Work", "work.md", [t]);
    const entries = buildTimelineEntries([board], today);
    expect(entries.length).toBe(1);
    expect(entries[0]!.startMin).toBe(540);
    expect(entries[0]!.endMin).toBe(630);
    // 9:00 = row 8 (since DAY_START=7, 60min/15 = 4 rows per hour)
    expect(entries[0]!.startRow).toBe(8);
    // 90min duration = 6 rows
    expect(entries[0]!.endRow).toBe(14);
  });

  it("includes done tasks (timeline doubles as a done-log)", () => {
    const t = makeTask({
      displayTitle: "done deal",
      done: true,
      scheduled: today,
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 },
    });
    const board = makeBoard("Work", "work.md", [t]);
    const entries = buildTimelineEntries([board], today);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.task.done).toBe(true);
  });

  it("excludes tasks scheduled for a different date", () => {
    const t = makeTask({
      displayTitle: "tomorrow",
      scheduled: "2026-05-28",
      timeBlock: { startMin: 9 * 60, endMin: 10 * 60 },
    });
    const board = makeBoard("Work", "work.md", [t]);
    expect(buildTimelineEntries([board], today)).toEqual([]);
  });

  it("clips blocks that span outside the rendered window", () => {
    const t = makeTask({
      displayTitle: "early",
      scheduled: today,
      // 6:30-7:30 → only 7:00-7:30 visible (rows 0-1)
      timeBlock: { startMin: 6 * 60 + 30, endMin: 7 * 60 + 30 },
    });
    const board = makeBoard("Work", "work.md", [t]);
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
    const board = makeBoard("Work", "work.md", [t]);
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
    const board = makeBoard("Work", "work.md", [t1, t2]);
    const entries = buildTimelineEntries([board], today);
    expect(entries.map((e) => e.task.displayTitle)).toEqual([
      "morning",
      "afternoon",
    ]);
  });
});

describe("buildRowMap", () => {
  function entryAt(startRow: number, endRow: number, title = "block"): TimelineEntry {
    return {
      kind: "task",
      ref: { boardPath: "x", columnIndex: 0, taskIndex: 0 },
      task: makeTask({ displayTitle: title }),
      boardName: "Work",
      boardIndex: 0,
      columnName: "Inbox",
      startMin: 0,
      endMin: 0,
      startRow,
      endRow,
    };
  }

  const titleOf = (e: TimelineEntry | undefined) =>
    e?.kind === "task" ? e.task.displayTitle : undefined;

  it("returns TOTAL_ROWS row pairs", () => {
    const result = buildRowMap([], 0);
    expect(result.rows.length).toBe(TOTAL_ROWS);
    expect(result.overflow).toBe(0);
  });

  it("marks hour-anchor rows on the left lane with kind=hour", () => {
    const { rows } = buildRowMap([], 0);
    expect(rows[0]!.left).toEqual({ kind: "hour", hour: DAY_START_HOUR });
    expect(rows[4]!.left).toEqual({ kind: "hour", hour: DAY_START_HOUR + 1 });
    expect(rows[1]!.left.kind).toBe("empty");
    // Right lane is always empty when no overlap.
    expect(rows[0]!.right.kind).toBe("empty");
  });

  it("places a single entry on the left lane as head/body/fill", () => {
    const { rows } = buildRowMap([entryAt(8, 14)], 0);
    expect(rows[8]!.left.kind).toBe("head");
    expect(rows[9]!.left.kind).toBe("body");
    expect(rows[10]!.left.kind).toBe("fill");
    expect(rows[13]!.left.kind).toBe("fill");
    expect(rows[14]!.left.kind).not.toBe("fill"); // end exclusive
    // No overlap → right lane all empty.
    for (let r = 8; r < 14; r++) {
      expect(rows[r]!.right.kind).toBe("empty");
    }
  });

  it("places overlapping entries on left and right lanes side-by-side", () => {
    // A: rows 5-10, B: rows 7-12 → overlap on rows 7-9.
    const a = entryAt(5, 10, "A");
    const b = entryAt(7, 12, "B");
    const { rows, overflow } = buildRowMap([a, b], 0);
    expect(overflow).toBe(0);
    // Lane 0 (left) gets A.
    expect(rows[5]!.left.kind).toBe("head");
    expect(titleOf(rows[5]!.left.entry)).toBe("A");
    // Lane 1 (right) gets B starting at row 7.
    expect(rows[7]!.right.kind).toBe("head");
    expect(titleOf(rows[7]!.right.entry)).toBe("B");
    // Row 10 is past A's end but inside B → left empty, right fill.
    expect(rows[10]!.left.kind).toBe("empty");
    expect(titleOf(rows[10]!.right.entry)).toBe("B");
  });

  it("counts third+ overlapping entry as overflow", () => {
    // Three blocks overlapping at row 8.
    const a = entryAt(5, 12, "A");
    const b = entryAt(6, 11, "B");
    const c = entryAt(7, 10, "C");
    const { overflow } = buildRowMap([a, b, c], 0);
    expect(overflow).toBe(1); // C didn't fit either lane
  });

  it("reuses a lane after its block ends", () => {
    // A: rows 5-8, C: rows 10-15 → both can use lane 0.
    const a = entryAt(5, 8, "A");
    const c = entryAt(10, 15, "C");
    const { rows, overflow } = buildRowMap([a, c], 0);
    expect(overflow).toBe(0);
    expect(titleOf(rows[5]!.left.entry)).toBe("A");
    expect(titleOf(rows[10]!.left.entry)).toBe("C");
    // Right lane stayed empty throughout.
    for (let r = 0; r < TOTAL_ROWS; r++) {
      expect(rows[r]!.right.kind).toBe("empty");
    }
  });

  it("overlays a now marker on the left lane (and clears the right)", () => {
    const nowMin = 10 * 60 + 30; // 10:30 → row 14
    const { rows } = buildRowMap([], nowMin);
    expect(rows[14]!.left.kind).toBe("now");
    expect(rows[14]!.left.nowMin).toBe(nowMin);
    expect(rows[14]!.right.kind).toBe("empty");
  });

  it("does not place a now marker when out of window", () => {
    const { rows } = buildRowMap([], 3 * 60); // 03:00, before DAY_START
    expect(rows.some((r) => r.left.kind === "now")).toBe(false);
  });
});

describe("countOverlaps", () => {
  function entry(s: number, e: number): TimelineEntry {
    return {
      kind: "task",
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

describe("formatAgendaDay", () => {
  it("uses relative words for the near days", () => {
    expect(formatAgendaDay(0, "2026-05-30")).toBe("Today");
    expect(formatAgendaDay(1, "2026-05-31")).toBe("Tomorrow");
    expect(formatAgendaDay(-1, "2026-05-29")).toBe("Yesterday");
  });

  it("stamps weekday + day + month for farther days", () => {
    // 2026-06-02 is a Tuesday.
    expect(formatAgendaDay(3, "2026-06-02")).toBe("Tue 02 Jun");
    // 2026-05-25 is a Monday.
    expect(formatAgendaDay(-5, "2026-05-25")).toBe("Mon 25 May");
  });
});

describe("buildCalendarEntries", () => {
  const ev = (startMin: number, endMin: number, title = "Standup") => ({
    title,
    startMin,
    endMin,
    color: "#FF5F00",
    source: "google" as const,
  });

  it("maps an in-window event to a calendar entry with rows", () => {
    const out = buildCalendarEntries([ev(9 * 60, 10 * 60, "Standup")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("calendar");
    expect(out[0]!.title).toBe("Standup");
    expect(out[0]!.color).toBe("#FF5F00");
    // 09:00 → (540 - DAY_START*60) / 15
    expect(out[0]!.startRow).toBe((9 * 60 - DAY_START_HOUR * 60) / MINS_PER_ROW);
  });

  it("drops events entirely outside the rendered window", () => {
    expect(buildCalendarEntries([ev(2 * 60, 3 * 60)])).toEqual([]);
  });

  it("sorts by start time", () => {
    const out = buildCalendarEntries([ev(11 * 60, 12 * 60, "late"), ev(8 * 60, 9 * 60, "early")]);
    expect(out.map((e) => e.title)).toEqual(["early", "late"]);
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

describe("buildUnscheduledToday (the To place tray)", () => {
  it("lists open tasks scheduled for the day that have no time block, in board order", () => {
    const board = makeBoard("Work", "/w.md", [
      makeTask({ displayTitle: "first", scheduled: "2026-10-01" }),
      makeTask({ displayTitle: "blocked", scheduled: "2026-10-01", timeBlock: { startMin: 600, endMin: 660 } }),
      makeTask({ displayTitle: "done", scheduled: "2026-10-01", done: true }),
      makeTask({ displayTitle: "other day", scheduled: "2026-10-02" }),
      makeTask({ displayTitle: "no date" }),
      makeTask({ displayTitle: "second", scheduled: "2026-10-01" }),
    ]);
    const tray = buildUnscheduledToday([board], "2026-10-01");
    expect(tray.map((t) => t.task.displayTitle)).toEqual(["first", "second"]);
    // The refs point at the real task inside the column, blocked ones included in the count.
    expect(tray.map((t) => t.ref.taskIndex)).toEqual([0, 5]);
  });
});

describe("findFreeSlot", () => {
  const H = (h: number, m = 0) => h * 60 + m;

  it("takes the next 15-minute step, half an hour long", () => {
    expect(findFreeSlot([], H(9, 7))).toEqual({ startMin: H(9, 15), endMin: H(9, 45) });
    expect(findFreeSlot([], H(9, 15))).toEqual({ startMin: H(9, 15), endMin: H(9, 45) });
  });

  it("never starts before the grid does", () => {
    expect(findFreeSlot([], H(3)).startMin).toBe(DAY_START_HOUR * 60);
  });

  it("steps over blocks and calendar events, and touching is not overlapping", () => {
    const busy = [
      { startMin: H(9), endMin: H(10) },
      { startMin: H(10, 15), endMin: H(11) },
    ];
    // 10:00-10:30 would overlap the 10:15 block, so the first fit is 11:00.
    expect(findFreeSlot(busy, H(9))).toEqual({ startMin: H(11), endMin: H(11, 30) });
    // A block ending exactly at 10:00 leaves 10:00-10:15 free but too short; 30 min needs the gap.
    expect(findFreeSlot([{ startMin: H(9), endMin: H(10) }], H(9))).toEqual({ startMin: H(10), endMin: H(10, 30) });
  });

  it("honours a different length", () => {
    expect(findFreeSlot([{ startMin: H(9), endMin: H(9, 30) }], H(9), 60)).toEqual({ startMin: H(9, 30), endMin: H(10, 30) });
  });

  it("late in the evening it falls back to the first free slot of the day", () => {
    expect(findFreeSlot([], H(22, 45))).toEqual({ startMin: DAY_START_HOUR * 60, endMin: DAY_START_HOUR * 60 + 30 });
  });

  it("a full day still returns a slot to nudge, at the asked-for start", () => {
    const full = [{ startMin: 0, endMin: 24 * 60 }];
    expect(findFreeSlot(full, H(12))).toEqual({ startMin: H(12), endMin: H(12, 30) });
  });
});
