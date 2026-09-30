import { describe, expect, it } from "bun:test";

import { PerfRecorder, perfKeyName, perfLogPath, startPerfLog } from "./perf";

function recorder(clock: { t: number }) {
  const lines: any[] = [];
  const rec = new PerfRecorder((l) => lines.push(JSON.parse(l)), () => clock.t);
  return { rec, lines };
}

describe("PerfRecorder", () => {
  it("logs a key handler only when it is slow", () => {
    const { rec, lines } = recorder({ t: 0 });
    rec.key("j", 2);
    rec.key("m", 45.4);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "slow-key", key: "m", ms: 45 });
  });

  it("explains a lag with the keys before it and how long before", () => {
    const clock = { t: 1_000 };
    const { rec, lines } = recorder(clock);
    rec.key("s", 1);
    clock.t = 1_400;
    rec.key("m", 1);
    clock.t = 2_000;
    rec.lag(1_300);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "lag", ms: 1300, keys: ["s -1000ms", "m -600ms"] });
  });

  it("ignores small stalls but still counts them in the window's worst lag", () => {
    const { rec, lines } = recorder({ t: 0 });
    rec.lag(40);
    rec.sample({ cpuPct: 12.6, rssMB: 300.4, heapMB: 90.2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "sample", cpuPct: 13, rssMB: 300, heapMB: 90, maxLagMs: 40, keys: 0 });
  });

  it("starts a fresh window after each sample", () => {
    const { rec, lines } = recorder({ t: 0 });
    rec.key("j", 1);
    rec.lag(500);
    rec.sample({ cpuPct: 1, rssMB: 1, heapMB: 1 });
    rec.sample({ cpuPct: 1, rssMB: 1, heapMB: 1 });
    const samples = lines.filter((l) => l.type === "sample");
    expect(samples[0]).toMatchObject({ keys: 1, maxLagMs: 500 });
    expect(samples[1]).toMatchObject({ keys: 0, maxLagMs: 0 });
  });

  it("keeps only the last few keys", () => {
    const { rec, lines } = recorder({ t: 0 });
    for (const k of "abcdefghij") rec.key(k, 1);
    rec.lag(300);
    expect(lines[0].keys).toHaveLength(6);
    expect(lines[0].keys[0]).toStartWith("e ");
  });
});

describe("TUIBOARD_PERF", () => {
  it("is off unless asked for", () => {
    expect(perfLogPath(undefined)).toBeUndefined();
    expect(perfLogPath("")).toBeUndefined();
    expect(perfLogPath("0")).toBeUndefined();
    expect(perfLogPath("false")).toBeUndefined();
    expect(startPerfLog("0.0.0", {})).toBeUndefined();
  });

  it("takes a path, or 1 for the temp dir", () => {
    expect(perfLogPath("C:/logs/perf.log")).toBe("C:/logs/perf.log");
    expect(perfLogPath("1")).toMatch(/tuiboard-perf\.log$/);
  });

  it("names keys with their modifiers", () => {
    expect(perfKeyName({ name: "m" })).toBe("m");
    expect(perfKeyName({ name: "t", shift: true })).toBe("S-t");
    expect(perfKeyName({ name: "[", ctrl: true, meta: true })).toBe("C-M-[");
    expect(perfKeyName({ sequence: "\u001b" })).toBe(JSON.stringify("\u001b"));
  });
});
