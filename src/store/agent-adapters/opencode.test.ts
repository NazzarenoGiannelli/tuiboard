import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OPENCODE_STALE_AFTER_MS,
  classifyOpenCodeStatus,
  readOpenCodeSessions,
} from "./opencode";

const now = 1_700_000_000_000;
const minutes = (n: number) => n * 60_000;
const days = (n: number) => n * 86_400_000;

describe("classifyOpenCodeStatus", () => {
  const done = { role: "assistant", completed: now - 1 };

  it("is live-busy while the last assistant turn is unfinished and fresh", () => {
    expect(classifyOpenCodeStatus(now, now - minutes(2), { role: "assistant" }, false)).toBe(
      "live-busy",
    );
  });

  it("is live-busy right after a user prompt, before the reply starts", () => {
    expect(classifyOpenCodeStatus(now, now, { role: "user" }, false)).toBe("live-busy");
  });

  it("is stale when an unfinished turn stopped updating (killed process)", () => {
    const at = now - OPENCODE_STALE_AFTER_MS - 1;
    expect(classifyOpenCodeStatus(now, at, { role: "assistant" }, false)).toBe("stale");
  });

  it("is dormant when the last turn completed", () => {
    expect(classifyOpenCodeStatus(now, now - minutes(1), done, false)).toBe("dormant");
  });

  it("is dormant when the last turn errored or was aborted", () => {
    const aborted = { role: "assistant", error: { name: "MessageAbortedError" } };
    expect(classifyOpenCodeStatus(now, now, aborted, false)).toBe("dormant");
  });

  it("is archived after 7 days, even if the last turn never finished", () => {
    expect(classifyOpenCodeStatus(now, now - days(10), { role: "assistant" }, false)).toBe(
      "archived",
    );
  });

  it("is archived when OpenCode archived it", () => {
    expect(classifyOpenCodeStatus(now, now, done, true)).toBe("archived");
  });
});

describe("readOpenCodeSessions", () => {
  let dir: string;
  let dbPath: string;

  // Subset of the OpenCode 1.18 schema the adapter reads.
  function seed(fn: (db: Database) => void) {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT NOT NULL,
        title TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        time_archived INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    fn(db);
    db.close();
  }

  function addSession(db: Database, id: string, opts: { parent?: string; t: number }) {
    db.run(
      `INSERT INTO session VALUES (?, ?, '/home/u/code/app', ?, ?, ?, NULL)`,
      [id, opts.parent ?? null, `Title ${id}`, opts.t, opts.t],
    );
  }
  function addMessage(db: Database, id: string, sid: string, t: number, data: object) {
    db.run(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`, [id, sid, t, t, JSON.stringify(data)]);
  }
  function addPart(db: Database, id: string, mid: string, sid: string, t: number, data: object) {
    db.run(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`, [id, mid, sid, t, t, JSON.stringify(data)]);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tuiboard-opencode-"));
    dbPath = join(dir, "opencode.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns [] when OpenCode isn't installed", () => {
    expect(readOpenCodeSessions(join(dir, "missing.db"), now)).toEqual([]);
  });

  it("maps a finished session and skips subagent sessions", () => {
    const t = now - minutes(5);
    seed((db) => {
      addSession(db, "ses_a", { t });
      addSession(db, "ses_child", { parent: "ses_a", t });
      addMessage(db, "msg_1", "ses_a", t, { role: "user" });
      addPart(db, "prt_1", "msg_1", "ses_a", t, { type: "text", text: "fix the build" });
      addPart(db, "prt_2", "msg_1", "ses_a", t, { type: "text", text: "<file>", synthetic: true });
      addMessage(db, "msg_2", "ses_a", t + 1, {
        role: "assistant",
        modelID: "big-pickle",
        providerID: "opencode",
        time: { created: t + 1, completed: t + 3 },
        finish: "stop",
      });
      addPart(db, "prt_3", "msg_2", "ses_a", t + 1, { type: "step-start" });
      addPart(db, "prt_4", "msg_2", "ses_a", t + 2, {
        type: "tool",
        tool: "bash",
        state: { status: "completed" },
      });
      addPart(db, "prt_5", "msg_2", "ses_a", t + 3, { type: "text", text: "Build fixed." });
    });

    const sessions = readOpenCodeSessions(dbPath, now);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s).toMatchObject({
      provider: "opencode",
      sessionId: "ses_a",
      sourcePath: dbPath,
      cwd: "/home/u/code/app",
      status: "dormant",
      lastActivityMs: t + 3,
      displayName: "Title ses_a",
      messageCount: 2,
      toolCount: 1,
      lastUser: "fix the build",
      lastAssistant: "Build fixed.",
      resumeCommand: "opencode --session ses_a",
      model: "big-pickle",
    });
  });

  it("falls back to the prompt while the title is still OpenCode's placeholder", () => {
    seed((db) => {
      db.run(
        `INSERT INTO session VALUES ('ses_f51b86ad4ffe', NULL, '/tmp', ?, ?, ?, NULL)`,
        ["New session - 2026-09-17T07:32:01.963Z", now, now],
      );
      addMessage(db, "msg_1", "ses_f51b86ad4ffe", now, { role: "user" });
      addPart(db, "prt_1", "msg_1", "ses_f51b86ad4ffe", now, {
        type: "text",
        text: "\nrun the migrations\nthen report",
      });
    });
    const [s] = readOpenCodeSessions(dbPath, now);
    expect(s?.aiTitle).toBeUndefined();
    expect(s?.displayName).toBe("run the migrations · f51b86ad");
  });

  it("flags a turn left unfinished by a killed process as stale", () => {
    const t = now - OPENCODE_STALE_AFTER_MS - minutes(1);
    seed((db) => {
      addSession(db, "ses_k", { t });
      addMessage(db, "msg_1", "ses_k", t, { role: "user" });
      addMessage(db, "msg_2", "ses_k", t, { role: "assistant", time: { created: t } });
      addPart(db, "prt_1", "msg_2", "ses_k", t, {
        type: "tool",
        tool: "bash",
        state: { status: "running" },
      });
    });
    const [s] = readOpenCodeSessions(dbPath, now);
    expect(s?.status).toBe("stale");
    expect(s?.lastAssistant).toBeUndefined();
  });
});
