import { describe, expect, it } from "bun:test";
import {
  classifyStatus,
  cwdFromSlug,
  cwdShort,
  formatAge,
  type LivePidRecord,
} from "./agents";

describe("cwdFromSlug", () => {
  it("decodes a Windows drive-letter slug", () => {
    expect(cwdFromSlug("C--Users-nazza-Documents-Repos-Blits")).toBe(
      "C:\\Users\\nazza\\Documents\\Repos\\Blits",
    );
  });

  it("handles a simple path without drive letter", () => {
    expect(cwdFromSlug("home-nazz-projects")).toBe("home\\nazz\\projects");
  });
});

describe("cwdShort", () => {
  it("returns the last 3 parts prefixed with ellipsis when path is long", () => {
    expect(cwdShort("C:\\Users\\nazza\\Documents\\Repos\\Blits")).toBe(
      "…Documents\\Repos\\Blits",
    );
  });

  it("returns the full path when 3 or fewer parts", () => {
    expect(cwdShort("C:\\Users\\nazza")).toBe("C:\\Users\\nazza");
  });
});

describe("classifyStatus", () => {
  const now = 1_700_000_000_000; // fixed instant
  const minutes = (n: number) => n * 60_000;
  const days = (n: number) => n * 86_400_000;

  it("returns live-busy when PID record fresh AND status busy", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("live-busy");
  });

  it("returns live-idle when PID record fresh AND status idle/missing", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1) };
    expect(classifyStatus(now, now, live)).toBe("live-idle");
  });

  it("returns stale-pid when PID record older than 5min", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(10), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("stale-pid");
  });

  it("returns dormant when no PID and jsonl mtime within 7 days", () => {
    expect(classifyStatus(now, now - days(2), undefined)).toBe("dormant");
  });

  it("returns archived when jsonl mtime older than 7 days and no PID", () => {
    expect(classifyStatus(now, now - days(10), undefined)).toBe("archived");
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000;

  it("formats seconds", () => {
    expect(formatAge(now - 30_000, now)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
  });

  it("formats hours", () => {
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("formats days", () => {
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("returns dash for zero", () => {
    expect(formatAge(0, now)).toBe("—");
  });
});
