import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSession } from "~/store/agents";
import {
  createHerdrSource,
  linkHerdrSessions,
  parseHerdrSnapshot,
  samePath,
  type HerdrSnapshot,
} from "./herdr";

// Shaped after a real `herdr api snapshot` (herdr protocol 20).
const pane = (id: string, fields: object) => ({
  pane_id: id,
  tab_id: "w1:t1",
  workspace_id: "w1",
  agent_status: "unknown",
  cwd: "/home/u/app",
  focused: false,
  ...fields,
});
const RAW = JSON.stringify({
  id: "cli:api:snapshot",
  result: {
    snapshot: {
      protocol: 20,
      panes: [
        pane("w1:p1", {
          agent: "claude",
          agent_status: "working",
          agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "cc-1" },
        }),
        pane("w1:p2", {
          agent: "pi",
          agent_status: "blocked",
          tab_id: "w1:t2",
          agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/h/.pi/agent/sessions/--x--/2026_pi-1.jsonl" },
        }),
        pane("w1:p3", { agent: "codex", agent_status: "done" }),
        pane("w1:p4", { agent: "gemini", agent_status: "idle" }),
        pane("w1:p5", {}),
      ],
      tabs: [
        { tab_id: "w1:t1", label: "Trace", number: 1 },
        { tab_id: "w1:t2", label: "Neona", number: 2 },
      ],
      workspaces: [{ workspace_id: "w1", label: "blits", number: 1 }],
    },
  },
});

const session = (provider: AgentSession["provider"], sessionId: string, fields: Partial<AgentSession> = {}): AgentSession => ({
  provider,
  sessionId,
  sourcePath: `/src/${sessionId}`,
  cwd: "/home/u/app",
  cwdShort: "/home/u/app",
  status: "dormant",
  lastActivityMs: 0,
  displayName: sessionId,
  messageCount: 0,
  toolCount: 0,
  resumeCommand: `resume ${sessionId}`,
  ...fields,
});

describe("parseHerdrSnapshot", () => {
  it("reads panes, tabs and workspaces", () => {
    const snap = parseHerdrSnapshot(RAW)!;
    expect(snap.panes).toHaveLength(5);
    expect(snap.panes[0]).toEqual({
      paneId: "w1:p1",
      tabId: "w1:t1",
      workspaceId: "w1",
      agent: "claude",
      status: "working",
      cwd: "/home/u/app",
      session: { kind: "id", value: "cc-1" },
    });
    expect(snap.panes[4]!.agent).toBeUndefined();
    expect(snap.tabs.get("w1:t2")).toEqual({ label: "Neona", number: 2 });
    expect(snap.workspaces.get("w1")).toEqual({ label: "blits", number: 1 });
  });

  it("rejects anything that isn't a snapshot", () => {
    expect(parseHerdrSnapshot("not json")).toBeUndefined();
    expect(parseHerdrSnapshot(JSON.stringify({ error: { code: "x" } }))).toBeUndefined();
  });

  it("maps unknown states to unknown", () => {
    const raw = JSON.stringify({ result: { snapshot: { panes: [pane("p", { agent_status: "sleeping" })] } } });
    expect(parseHerdrSnapshot(raw)!.panes[0]!.status).toBe("unknown");
  });
});

describe("samePath", () => {
  it("matches across separators, trailing slashes and Windows case", () => {
    expect(samePath("C:/Users/Nazza/Vault", "c:\\users\\nazza\\vault\\")).toBe(true);
    expect(samePath("/home/u/app/", "/home/u/app")).toBe(true);
    expect(samePath("/home/u/app", "/home/u/other")).toBe(false);
    expect(samePath("", "/x")).toBe(false);
  });
});

describe("linkHerdrSessions", () => {
  const snap = parseHerdrSnapshot(RAW)!;

  it("links by id, by path and by cwd, and takes herdr's state", () => {
    const linked = linkHerdrSessions(
      [
        session("claude-code", "cc-1", { status: "stale" }),
        session("pi", "pi-1", { sourcePath: "/h/.pi/agent/sessions/--x--/2026_pi-1.jsonl" }),
        session("codex", "cx-old", { lastActivityMs: 1 }),
        session("codex", "cx-new", { lastActivityMs: 2 }),
        session("opencode", "oc-1"),
      ],
      snap,
    );
    const by = new Map(linked.map((s) => [s.sessionId, s]));
    expect(by.get("cc-1")).toMatchObject({
      status: "live-busy",
      herdr: { paneId: "w1:p1", workspaceLabel: "blits", tabLabel: "Trace", tabNumber: 1, matchedBy: "id" },
    });
    expect(by.get("pi-1")).toMatchObject({ status: "live-blocked", herdr: { paneId: "w1:p2", tabNumber: 2, matchedBy: "path" } });
    // No session identity from herdr: most recent codex session in that cwd.
    expect(by.get("cx-new")).toMatchObject({ status: "live-done", herdr: { paneId: "w1:p3", matchedBy: "cwd", agent: "codex" } });
    expect(by.get("cx-old")!.herdr).toBeUndefined();
    // gemini isn't a tuiboard provider; opencode has no pane.
    expect(by.get("oc-1")!.status).toBe("dormant");
    expect(by.get("oc-1")!.herdr).toBeUndefined();
  });

  it("links a session to one pane only, and ignores other directories", () => {
    const two: HerdrSnapshot = {
      ...snap,
      panes: [
        { paneId: "a", tabId: "", workspaceId: "", agent: "codex", status: "idle", cwd: "/home/u/app" },
        { paneId: "b", tabId: "", workspaceId: "", agent: "codex", status: "working", cwd: "/home/u/app" },
        { paneId: "c", tabId: "", workspaceId: "", agent: "codex", status: "working", cwd: "/elsewhere" },
      ],
    };
    const linked = linkHerdrSessions(
      [session("codex", "x", { lastActivityMs: 2 }), session("codex", "y", { lastActivityMs: 1 })],
      two,
    );
    expect(linked.map((s) => s.herdr?.paneId)).toEqual(["a", "b"]);
  });

  it("keeps the adapter's status when herdr doesn't know", () => {
    const unknown: HerdrSnapshot = {
      ...snap,
      panes: [{ paneId: "p", tabId: "", workspaceId: "", agent: "claude", status: "unknown", cwd: "/x", session: { kind: "id", value: "s" } }],
    };
    const [s] = linkHerdrSessions([session("claude-code", "s", { status: "stale" })], unknown);
    expect(s).toMatchObject({ status: "stale", herdr: { paneId: "p" } });
  });

  it("returns sessions untouched without a snapshot", () => {
    const sessions = [session("claude-code", "cc-1")];
    expect(linkHerdrSessions(sessions, undefined)).toBe(sessions);
  });
});

describe("createHerdrSource", () => {
  it("is inert when herdr isn't installed", () => {
    const src = createHerdrSource({ bin: null });
    expect(src.snapshot()).toBeUndefined();
    src.dispose();
  });

  it.skipIf(process.platform === "win32")("polls a herdr-compatible binary and notifies on change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-herdr-"));
    const fake = join(dir, "herdr");
    try {
      writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${RAW}\nEOF\n`, { mode: 0o755 });
      const src = createHerdrSource({ bin: fake, pollMs: 50 });
      let changes = 0;
      src.onChange(() => changes++);
      const start = Date.now();
      while (!src.snapshot() && Date.now() - start < 5000) await Bun.sleep(25);
      await Bun.sleep(200);
      src.dispose();
      expect(src.snapshot()?.panes).toHaveLength(5);
      expect(changes).toBe(1); // same output on later polls → no extra notifications
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
