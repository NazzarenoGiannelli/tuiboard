import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSetupStatus } from "~/setup/status";
import { formatDoctor, runDoctor } from "./doctor";

const baseDeps = {
  version: "0.16.0", configPath: undefined, boardsDir: "/b", boards: [], zones: { planner: "on", agenda: "on", agents: "on" },
  calendars: {}, adapters: [{ provider: "claude-code", watchPaths: () => ["/x"] }], sessions: [], herdrBin: undefined,
  updateCheckEnabled: true, updateCache: undefined, exists: () => false,
} as const;

const status = collectSetupStatus({ ...baseDeps, zones: { ...baseDeps.zones }, adapters: [...baseDeps.adapters] } as any);
const foundStatus = collectSetupStatus({
  ...baseDeps, zones: { ...baseDeps.zones }, adapters: [...baseDeps.adapters],
  sessions: [{ provider: "claude-code", lastActivityMs: 1 }, { provider: "claude-code", lastActivityMs: 2 }],
  exists: (p: string) => p === "/x",
} as any);

describe("formatDoctor", () => {
  it("one line per area, with a mark and a remedy for what is not set up", () => {
    const out = formatDoctor(status);
    expect(out).toContain("tuiboard 0.16.0");
    expect(out).toContain("○ Boards");
    expect(out).toContain("○ Claude Code");
    expect(out).toContain("tuiboard calendar-setup google");
    expect(out).toContain("Update notice");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("prints a session count when sessions are known", () => {
    expect(formatDoctor(foundStatus)).toContain("✓ Claude Code  2 sessions");
    expect(formatDoctor(foundStatus, true)).toContain("2 sessions");
  });

  it("says only 'found' when sessions are not counted (never a misleading 0)", () => {
    const out = formatDoctor(foundStatus, false);
    expect(out).toContain("✓ Claude Code  found");
    expect(out).not.toMatch(/\d+ sessions?/);
  });

  it("with the Agents zone off, a found source reads 'found' even when sessions are known", () => {
    const off = { ...foundStatus, zones: { ...foundStatus.zones, agents: "off" as const } };
    const out = formatDoctor(off, true);
    expect(out).toContain("✓ Claude Code  found");
    expect(out).not.toMatch(/\d+ sessions?/);
  });
});

describe("runDoctor", () => {
  const ENV_KEYS = ["HOME", "USERPROFILE", "TUIBOARD_CONFIG", "XDG_DATA_HOME"] as const;
  const prevEnv: Record<string, string | undefined> = {};
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tb-doctor-home-"));
    for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XDG_DATA_HOME = home;
    process.env.TUIBOARD_CONFIG = join(home, "no-config.yaml");
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    rmSync(home, { recursive: true, force: true });
  });

  const capture = (fn: () => number) => {
    const log = console.log; let text = "";
    console.log = (...a: unknown[]) => { text += a.join(" ") + "\n"; };
    try { return { code: fn(), text }; } finally { console.log = log; }
  };

  it("exits 0 and prints a report, even on a machine with nothing set up", () => {
    const r = capture(() => runDoctor([]));
    expect(r.code).toBe(0);
    expect(r.text).toContain("tuiboard ");
    expect(r.text).toContain("Update notice");
  });

  it("never prints a session count, because it does not read sessions", () => {
    const r = capture(() => runDoctor([]));
    expect(r.text).not.toMatch(/\d+ sessions?/);
  });

  it("--json prints the status object", () => {
    const r = capture(() => runDoctor(["--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.text);
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("agents");
    expect(parsed).toHaveProperty("calendars");
  });

  it("an unknown flag is a usage error", () => {
    const err = console.error; console.error = () => {};
    try { expect(runDoctor(["--nope"])).toBe(2); } finally { console.error = err; }
  });
});
