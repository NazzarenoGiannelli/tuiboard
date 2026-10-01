import { describe, expect, it } from "bun:test";

import { collectSetupStatus, type SetupDeps } from "./status";

const base = (over: Partial<SetupDeps> = {}): SetupDeps => ({
  version: "0.16.0",
  configPath: undefined,
  boardsDir: "/b",
  boards: [],
  zones: { planner: "on", agenda: "on", agents: "on" },
  calendars: {},
  adapters: [
    { provider: "claude-code", watchPaths: () => ["/home/.claude/projects"] },
    { provider: "codex", watchPaths: () => ["/home/.codex/sessions"] },
    { provider: "opencode", watchPaths: () => ["/home/.local/share/opencode/opencode.db"] },
    { provider: "pi", watchPaths: () => ["/home/.pi/agent/sessions"] },
  ],
  sessions: [],
  herdrBin: undefined,
  updateCheckEnabled: true,
  updateCache: undefined,
  exists: () => false,
  ...over,
});

describe("collectSetupStatus", () => {
  it("a machine with nothing on it: no crash, everything not-yet", () => {
    const s = collectSetupStatus(base());
    expect(s.version).toBe("0.16.0");
    expect(s.boards).toEqual([]);
    expect(s.agents).toHaveLength(4);
    expect(s.agents.every((a) => !a.found && a.sessions === 0)).toBe(true);
    expect(s.calendars.map((c) => [c.provider, c.connected])).toEqual([["google", false], ["microsoft", false]]);
    expect(s.herdr.installed).toBe(false);
    expect(s.updates).toEqual({ enabled: true, latest: undefined, checkedAt: undefined });
  });

  it("an agent source is found when one of its paths exists, and sessions are counted per tool", () => {
    const s = collectSetupStatus(base({
      exists: (p) => p === "/home/.codex/sessions",
      sessions: [
        { provider: "codex", lastActivityMs: 100 },
        { provider: "codex", lastActivityMs: 300 },
        { provider: "claude-code", lastActivityMs: 50 },
      ],
    }));
    const codex = s.agents.find((a) => a.provider === "codex")!;
    expect(codex).toMatchObject({ found: true, sessions: 2, lastActivityMs: 300, label: "Codex" });
    expect(s.agents.find((a) => a.provider === "claude-code")).toMatchObject({ found: false, sessions: 1 });
  });

  it("boards report whether their file is there", () => {
    const s = collectSetupStatus(base({
      boards: [{ name: "Work", path: "/b/Work.md" }, { path: "/b/Gone.md" }],
      exists: (p) => p === "/b/Work.md",
    }));
    expect(s.boards).toEqual([
      { name: "Work", path: "/b/Work.md", exists: true },
      { name: "Gone", path: "/b/Gone.md", exists: false },
    ]);
  });

  it("a calendar is connected when its token file exists; a broken path is just not connected", () => {
    const s = collectSetupStatus(base({
      calendars: { google: { token: "/t/google.json" }, microsoft: { tokenCache: "/t/ms.json" } },
      exists: (p) => p === "/t/google.json",
    }));
    expect(s.calendars.find((c) => c.provider === "google")).toMatchObject({ connected: true });
    const ms = s.calendars.find((c) => c.provider === "microsoft")!;
    expect(ms.connected).toBe(false);
    expect(ms.hint).toContain("tuiboard calendar-setup microsoft");
  });

  it("the hint for an unconfigured calendar is the command that connects it", () => {
    const g = collectSetupStatus(base()).calendars.find((c) => c.provider === "google")!;
    expect(g.hint).toBe("tuiboard calendar-setup google");
  });

  it("herdr and the update notice are reported as they are", () => {
    const s = collectSetupStatus(base({
      herdrBin: "/usr/bin/herdr",
      updateCheckEnabled: false,
      updateCache: { latest: "0.17.0", checkedAt: 1234 },
    }));
    expect(s.herdr.installed).toBe(true);
    expect(s.updates).toEqual({ enabled: false, latest: "0.17.0", checkedAt: 1234 });
  });

  it("an adapter whose watchPaths throws does not take the report down", () => {
    const s = collectSetupStatus(base({
      adapters: [{ provider: "pi", watchPaths: () => { throw new Error("boom"); } }],
    }));
    expect(s.agents).toEqual([{ provider: "pi", label: "Pi", found: false, sessions: 0, lastActivityMs: undefined }]);
  });
});
