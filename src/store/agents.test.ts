import { describe, expect, it } from "bun:test";
import {
  createAgentsStore,
  cwdShort,
  formatAge,
  sortSessions,
  type AgentAdapter,
  type AgentSession,
  type AgentStatus,
} from "./agents";

function fakeSession(sessionId: string, status: AgentStatus, lastActivityMs: number): AgentSession {
  return {
    provider: "claude-code",
    sessionId,
    sourcePath: `/tmp/${sessionId}`,
    cwd: "/tmp",
    cwdShort: "/tmp",
    status,
    lastActivityMs,
    displayName: sessionId,
    messageCount: 0,
    toolCount: 0,
    resumeCommand: `resume ${sessionId}`,
  };
}

function fakeAdapter(discover: () => AgentSession[]): AgentAdapter {
  return { provider: "claude-code", watchPaths: () => [], discover };
}

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

describe("sortSessions", () => {
  it("orders by status rank, then most recent first", () => {
    const sorted = sortSessions([
      fakeSession("old-dormant", "dormant", 1),
      fakeSession("stale", "stale", 5),
      fakeSession("new-dormant", "dormant", 9),
      fakeSession("busy", "live-busy", 0),
    ]);
    expect(sorted.map((s) => s.sessionId)).toEqual([
      "busy",
      "stale",
      "new-dormant",
      "old-dormant",
    ]);
  });
});

describe("createAgentsStore", () => {
  it("merges sessions from every adapter", async () => {
    const store = createAgentsStore([
      fakeAdapter(() => [fakeSession("a", "dormant", 1)]),
      fakeAdapter(() => [fakeSession("b", "live-idle", 2)]),
    ]);
    expect(store.sessions().map((s) => s.sessionId)).toEqual(["b", "a"]);
    await store.dispose();
  });

  it("keeps the other adapters' sessions when one throws", async () => {
    const store = createAgentsStore([
      fakeAdapter(() => {
        throw new Error("corrupt store");
      }),
      fakeAdapter(() => [fakeSession("ok", "dormant", 1)]),
    ]);
    expect(store.sessions().map((s) => s.sessionId)).toEqual(["ok"]);
    await store.dispose();
  });
});
