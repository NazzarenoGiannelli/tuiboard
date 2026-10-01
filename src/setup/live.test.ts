import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSetupStatus } from "./status";
import { liveSetupDeps } from "./live";

const ENV_KEYS = ["HOME", "USERPROFILE", "TUIBOARD_CONFIG", "XDG_DATA_HOME"] as const;
const prevEnv: Record<string, string | undefined> = {};
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tb-live-home-"));
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

describe("liveSetupDeps", () => {
  it("reads the config path and boards dir from the redirected environment, not the real HOME", () => {
    const deps = liveSetupDeps({ boards: [], zones: { planner: "on", agenda: "on", agents: "on" }, updateCheck: true } as any, []);
    expect(deps.configPath).toBeUndefined(); // TUIBOARD_CONFIG names a file that does not exist
    expect(deps.boardsDir.startsWith(home)).toBe(true);
  });

  it("looks at the real file system, and lists all four tools", () => {
    const d = mkdtempSync(join(tmpdir(), "tb-live-"));
    try {
      const board = join(d, "A.md");
      writeFileSync(board, "## Todo\n");
      const deps = liveSetupDeps({
        boards: [{ path: board, name: "A" }], zones: { planner: "on", agenda: "on", agents: "on" }, updateCheck: true, calendars: undefined,
      } as any, []);
      const s = collectSetupStatus(deps);
      expect(s.boards[0]).toEqual({ name: "A", path: board, exists: true });
      expect(s.agents.map((a) => a.provider).sort()).toEqual(["claude-code", "codex", "opencode", "pi"]);
      expect(s.calendars.every((c) => !c.connected)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
