import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentsStore } from "~/store/agents";
import {
  CODEX_STALE_AFTER_MS,
  classifyCodexStatus,
  createCodexAdapter,
  parseRollout,
  threadIdFromRolloutName,
} from "./codex";

const ID = "0199a8f2-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const PARENT = "0199a8f2-0000-7000-8000-000000000000";

// Lines shaped after the Codex rust-v0.154.0 structs (RolloutLine, SessionMetaLine,
// EventMsg, TurnItem, ResponseItem).
const line = (type: string, payload: object) =>
  JSON.stringify({ timestamp: "2026-09-17T08:00:00.000Z", type, payload });
const meta = (id: string, extra: object = {}) =>
  line("session_meta", {
    session_id: id,
    id,
    timestamp: "2026-09-17T08:00:00.000Z",
    cwd: "/home/u/code/app",
    originator: "codex_cli_rs",
    cli_version: "0.154.0",
    source: "cli",
    thread_source: "user",
    model_provider: "openai",
    history_mode: "paginated",
    git: { commit_hash: "abc123", branch: "main" },
    ...extra,
  });
const started = line("event_msg", { type: "task_started", turn_id: "t1" });
const userItem = (text: string) =>
  line("event_msg", {
    type: "item_completed",
    thread_id: ID,
    turn_id: "t1",
    item: { type: "UserMessage", id: "u1", content: [{ type: "text", text, text_elements: [] }] },
    completed_at_ms: 1,
  });
const agentItem = (text: string) =>
  line("event_msg", {
    type: "item_completed",
    thread_id: ID,
    turn_id: "t1",
    item: { type: "AgentMessage", id: "a1", content: [{ type: "Text", text }] },
    completed_at_ms: 2,
  });
const toolCall = line("response_item", {
  type: "function_call",
  name: "exec_command",
  arguments: '{"cmd":"ls"}',
  call_id: "call_1",
});
const complete = line("event_msg", {
  type: "task_complete",
  turn_id: "t1",
  last_agent_message: "Done.",
});

const FINISHED = [
  meta(ID),
  line("turn_context", { turn_id: "t1", cwd: "/home/u/code/app", model: "gpt-5.5-codex" }),
  started,
  userItem("# AGENTS.md stuff\n## My request for Codex:\nfix the flaky test"),
  line("response_item", { type: "message", role: "user", content: [] }),
  toolCall,
  agentItem("Fixed it."),
  complete,
].join("\n");

describe("threadIdFromRolloutName", () => {
  it("extracts the uuid from plain, reverted and compressed rollouts", () => {
    expect(threadIdFromRolloutName(`rollout-2026-09-17T08-00-00-${ID}.jsonl`)).toBe(ID);
    expect(threadIdFromRolloutName(`rollout-2026-09-17T08-00-00-${ID}_r2.jsonl`)).toBe(ID);
    expect(threadIdFromRolloutName(`rollout-2026-09-17T08-00-00-${ID}.jsonl.zst`)).toBe(ID);
    expect(threadIdFromRolloutName("session_index.jsonl")).toBeUndefined();
  });
});

describe("parseRollout", () => {
  it("reads meta, prompts, replies, tools and turn state (paginated mode)", () => {
    const r = parseRollout(FINISHED, ID);
    expect(r).toMatchObject({
      cwd: "/home/u/code/app",
      gitBranch: "main",
      model: "gpt-5.5-codex",
      hidden: false,
      firstUser: "fix the flaky test",
      lastUser: "fix the flaky test",
      lastAssistant: "Fixed it.",
      messageCount: 2,
      toolCount: 1,
      turnOpen: false,
    });
  });

  it("reads legacy-mode user_message / agent_message events", () => {
    const r = parseRollout(
      [
        meta(ID, { history_mode: "legacy" }),
        line("event_msg", { type: "user_message", message: "hello" }),
        line("event_msg", { type: "agent_message", message: "hi there" }),
      ].join("\n"),
      ID,
    );
    expect(r.lastUser).toBe("hello");
    expect(r.lastAssistant).toBe("hi there");
    expect(r.messageCount).toBe(2);
  });

  it("keeps a turn open until task_complete or turn_aborted", () => {
    expect(parseRollout([meta(ID), started, userItem("go")].join("\n"), ID).turnOpen).toBe(true);
    const aborted = line("event_msg", { type: "turn_aborted", reason: "interrupted" });
    expect(parseRollout([meta(ID), started, aborted].join("\n"), ID).turnOpen).toBe(false);
    const v2 = [meta(ID), line("event_msg", { type: "turn_started" })].join("\n");
    expect(parseRollout(v2, ID).turnOpen).toBe(true);
  });

  it("falls back to task_complete.last_agent_message", () => {
    const r = parseRollout([meta(ID), started, complete].join("\n"), ID);
    expect(r.lastAssistant).toBe("Done.");
  });

  it("hides subagent and internal threads", () => {
    const sub = { source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } };
    expect(parseRollout(meta(ID, sub), ID).hidden).toBe(true);
    expect(parseRollout(meta(ID, { thread_source: "subagent" }), ID).hidden).toBe(true);
    expect(parseRollout(meta(ID, { source: { internal: "x" } }), ID).hidden).toBe(true);
    expect(parseRollout(meta(ID, { source: "exec" }), ID).hidden).toBe(false);
  });

  it("prefers its own session_meta over an embedded parent's (forks)", () => {
    const r = parseRollout(
      [meta(PARENT, { cwd: "/parent", source: { subagent: "review" } }), meta(ID)].join("\n"),
      ID,
    );
    expect(r.cwd).toBe("/home/u/code/app");
    expect(r.hidden).toBe(false);
  });

  it("tolerates malformed lines and empty input", () => {
    expect(parseRollout(FINISHED + "\n{not json", ID).lastAssistant).toBe("Fixed it.");
    expect(parseRollout("", ID)).toMatchObject({ messageCount: 0, turnOpen: false });
  });
});

describe("classifyCodexStatus", () => {
  const now = 1_700_000_000_000;
  it("maps turn state and age", () => {
    expect(classifyCodexStatus(now, now, true, false)).toBe("live-busy");
    expect(classifyCodexStatus(now, now - CODEX_STALE_AFTER_MS - 1, true, false)).toBe("stale");
    expect(classifyCodexStatus(now, now, false, false)).toBe("dormant");
    expect(classifyCodexStatus(now, now - 8 * 86_400_000, true, false)).toBe("archived");
    expect(classifyCodexStatus(now, now, false, true)).toBe("archived");
  });
});

describe("createCodexAdapter", () => {
  let home: string;
  const dayDir = () => join(home, "sessions", "2026", "09", "17");
  const rollout = (id: string, suffix = "") =>
    `rollout-2026-09-17T08-00-00-${id}${suffix}.jsonl`;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tuiboard-codex-"));
    mkdirSync(dayDir(), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("returns [] when Codex isn't installed", () => {
    expect(createCodexAdapter(join(home, "missing")).discover(Date.now())).toEqual([]);
  });

  it("lists rollouts with renames, archive state and zstd files", () => {
    const now = Date.now();
    const sub = "0199a8f2-2222-7000-8000-000000000002";
    const zst = "0199a8f2-3333-7000-8000-000000000003";
    const arch = "0199a8f2-4444-7000-8000-000000000004";
    writeFileSync(join(dayDir(), rollout(ID)), FINISHED);
    writeFileSync(join(dayDir(), rollout(sub)), meta(sub, { thread_source: "subagent" }));
    writeFileSync(
      join(dayDir(), rollout(zst) + ".zst"),
      Bun.zstdCompressSync(Buffer.from([meta(zst), userItem("old work")].join("\n"))),
    );
    mkdirSync(join(home, "archived_sessions"));
    writeFileSync(join(home, "archived_sessions", rollout(arch)), meta(arch));
    writeFileSync(
      join(home, "session_index.jsonl"),
      [
        JSON.stringify({ id: ID, thread_name: "first name", updated_at: "x" }),
        JSON.stringify({ id: ID, thread_name: "Flaky test hunt", updated_at: "y" }),
      ].join("\n"),
    );

    const byId = new Map(
      createCodexAdapter(home)
        .discover(now)
        .map((s) => [s.sessionId, s]),
    );
    expect([...byId.keys()].sort()).toEqual([ID, zst, arch].sort());
    expect(byId.get(ID)).toMatchObject({
      provider: "codex",
      cwd: "/home/u/code/app",
      status: "dormant",
      customTitle: "Flaky test hunt",
      displayName: "Flaky test hunt",
      gitBranch: "main",
      messageCount: 2,
      toolCount: 1,
      resumeCommand: `codex resume ${ID}`,
    });
    expect(byId.get(zst)?.displayName).toBe("old work · 0199a8f2");
    expect(byId.get(arch)?.status).toBe("archived");
  });

  it("uses the newest rollout of a reverted thread and the DB as enrichment", () => {
    const now = Date.now();
    const old = join(dayDir(), rollout(ID));
    writeFileSync(old, [meta(ID), started].join("\n"));
    utimesSync(old, new Date(now - 60_000), new Date(now - 60_000));
    writeFileSync(join(dayDir(), rollout(ID, "_r2")), [meta(ID), started, complete].join("\n"));
    const db = new Database(join(home, "state_5.sqlite"));
    db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, name TEXT,
      archived INTEGER, cwd TEXT, git_branch TEXT)`);
    db.run(`INSERT INTO threads VALUES (?, 'db title', 'Renamed in app', 1, '/db', 'dev')`, [ID]);
    db.close();

    const [s] = createCodexAdapter(home).discover(now);
    expect(s?.sourcePath.endsWith("_r2.jsonl")).toBe(true);
    expect(s?.customTitle).toBe("Renamed in app");
    expect(s?.status).toBe("archived");
    expect(s?.cwd).toBe("/home/u/code/app"); // rollout wins over the DB
  });

  it("marks a turn in progress busy and picks up new rollouts via the watcher", async () => {
    const store = createAgentsStore([createCodexAdapter(home)]);
    try {
      expect(store.sessions()).toEqual([]);
      await new Promise((r) => setTimeout(r, 300)); // let the watcher arm
      writeFileSync(join(dayDir(), rollout(ID)), [meta(ID), started, userItem("go")].join("\n"));
      const start = Date.now();
      while (store.sessions().length === 0 && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(store.sessions()[0]?.status).toBe("live-busy");
    } finally {
      await store.dispose();
    }
  });
});
