import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSetupStatus } from "./status";
import { liveSetupDeps } from "./live";

describe("liveSetupDeps", () => {
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
