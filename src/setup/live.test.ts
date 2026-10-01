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

  describe("the update notice is reported as on only when it can run", () => {
    const cfg = (updateCheck: boolean) =>
      ({ boards: [], zones: { planner: "on", agenda: "on", agents: "on" }, updateCheck }) as any;
    const enabled = (updateCheck: boolean, env: Record<string, string | undefined>) =>
      liveSetupDeps(cfg(updateCheck), [], env).updateCheckEnabled;

    it("on with the config on and a clean environment", () => {
      expect(enabled(true, {})).toBe(true);
    });
    it("off when the config says off", () => {
      expect(enabled(false, {})).toBe(false);
    });
    it("off under TUIBOARD_NO_UPDATE_CHECK=1, whatever the config says", () => {
      expect(enabled(true, { TUIBOARD_NO_UPDATE_CHECK: "1" })).toBe(false);
    });
    it("empty or 0 does not switch it off, as in the real check", () => {
      expect(enabled(true, { TUIBOARD_NO_UPDATE_CHECK: "" })).toBe(true);
      expect(enabled(true, { TUIBOARD_NO_UPDATE_CHECK: "0" })).toBe(true);
    });
    it("off in CI", () => {
      expect(enabled(true, { CI: "true" })).toBe(false);
    });
    it("a missing terminal is not part of it: doctor is often piped and the app has one", () => {
      // liveSetupDeps takes no stdout at all; the environment is the whole answer.
      expect(enabled(true, {})).toBe(true);
    });
  });
});
