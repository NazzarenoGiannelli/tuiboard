import { describe, expect, it } from "bun:test";

import { T } from "~/ui/glyphs";
import type { Task } from "~/types";
import {
  OVERDUE_HEAVY_AFTER_DAYS,
  daysBetweenIso,
  overdueBand,
  statusOf,
  suffixColorFor,
  titleColorFor,
} from "./task-status";

const TODAY = "2026-09-20";
const TOMORROW = "2026-09-21";

const task = (fields: Partial<Task> = {}): Task =>
  ({
    kind: "task",
    done: false,
    priority: "none",
    displayTitle: "t",
    tags: [],
    ...fields,
  }) as Task;

const color = (t: Task) => titleColorFor(t, statusOf(t, TODAY, TOMORROW), TODAY);

describe("daysBetweenIso", () => {
  it("counts calendar days across months and years", () => {
    expect(daysBetweenIso("2026-09-20", "2026-09-20")).toBe(0);
    expect(daysBetweenIso("2026-09-17", "2026-09-20")).toBe(3);
    expect(daysBetweenIso("2026-02-26", "2026-03-03")).toBe(5);
    expect(daysBetweenIso("2025-12-30", "2026-01-06")).toBe(7);
  });

  it("doesn't drift across a DST change", () => {
    // Europe/Rome springs forward on 2026-03-29: local-time arithmetic would
    // make this 6.96 days and round down.
    expect(daysBetweenIso("2026-03-25", "2026-04-01")).toBe(7);
  });
});

describe("overdueBand", () => {
  it("splits at the threshold", () => {
    const light = `2026-09-${20 - (OVERDUE_HEAVY_AFTER_DAYS - 1)}`;
    const heavy = `2026-09-${20 - OVERDUE_HEAVY_AFTER_DAYS}`;
    expect(overdueBand(light, TODAY)).toBe("light");
    expect(overdueBand(heavy, TODAY)).toBe("heavy");
  });

  it("keeps a Friday task light when it's looked at again on Monday", () => {
    // 2026-09-18 Friday → 2026-09-21 Monday: 3 days, ordinary drift.
    expect(overdueBand("2026-09-18", "2026-09-21")).toBe("light");
  });
});

describe("statusOf", () => {
  it("buckets by date, with done winning over everything", () => {
    expect(statusOf(task({ done: true, scheduled: "2020-01-01" }), TODAY, TOMORROW)).toBe("done");
    expect(statusOf(task({ scheduled: "2026-09-19" }), TODAY, TOMORROW)).toBe("overdue");
    expect(statusOf(task({ scheduled: TODAY }), TODAY, TOMORROW)).toBe("today");
    expect(statusOf(task({ scheduled: TOMORROW }), TODAY, TOMORROW)).toBe("tomorrow");
    expect(statusOf(task({ scheduled: "2026-12-01" }), TODAY, TOMORROW)).toBe("future");
    expect(statusOf(task(), TODAY, TOMORROW)).toBe("unscheduled");
  });

  it("falls back to the due date when there's no scheduled date", () => {
    expect(statusOf(task({ due: "2026-09-19" }), TODAY, TOMORROW)).toBe("overdue");
  });
});

describe("titleColorFor", () => {
  it("paints a long-overdue task louder than a fresh one", () => {
    expect(color(task({ scheduled: "2026-09-19" }))).toBe(T.overdue);
    expect(color(task({ scheduled: "2026-09-10" }))).toBe(T.overdueHeavy);
  });

  it("keeps the existing precedence: done > overdue > priority > today > tomorrow", () => {
    expect(color(task({ done: true, scheduled: "2026-09-01" }))).toBe(T.done);
    // Overdue beats priority, in both bands.
    expect(color(task({ scheduled: "2026-09-19", priority: "high" }))).toBe(T.overdue);
    expect(color(task({ scheduled: "2026-09-01", priority: "high" }))).toBe(T.overdueHeavy);
    expect(color(task({ scheduled: TOMORROW, priority: "high" }))).toBe(T.textDim);
    expect(color(task({ priority: "high" }))).toBe(T.today);
    expect(color(task({ scheduled: TODAY }))).toBe(T.todayPale);
    expect(color(task({ scheduled: "2026-12-01" }))).toBe(T.text);
  });
});

describe("suffixColorFor", () => {
  it("carries the same band as the title", () => {
    const fresh = task({ scheduled: "2026-09-19" });
    const old = task({ scheduled: "2026-09-01" });
    expect(suffixColorFor(fresh, statusOf(fresh, TODAY, TOMORROW), TODAY)).toBe(T.overdue);
    expect(suffixColorFor(old, statusOf(old, TODAY, TOMORROW), TODAY)).toBe(T.overdueHeavy);
  });

  it("leaves the other states as they were", () => {
    const done = task({ done: true, doneDate: TODAY });
    expect(suffixColorFor(done, statusOf(done, TODAY, TOMORROW), TODAY)).toBe(T.textDone);
    const future = task({ scheduled: "2026-12-01" });
    expect(suffixColorFor(future, statusOf(future, TODAY, TOMORROW), TODAY)).toBe(T.scheduled);
  });
});
