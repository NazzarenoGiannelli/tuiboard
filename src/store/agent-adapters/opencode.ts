/**
 * OpenCode adapter for the agents store.
 *
 * Reads (read-only):
 *   $XDG_DATA_HOME/opencode/opencode.db   — SQLite, WAL mode
 *     session  one row per session (cwd, AI title, parent_id for subagents)
 *     message  JSON `data`: role, time.completed, error
 *     part     JSON `data`: type text | reasoning | tool | step-start | …
 *
 * OpenCode keeps no PID/lock registry, so liveness is inferred from the
 * transcript: the newest message being an unfinished assistant turn means
 * "busy" — unless nothing has been written for STALE_AFTER_MS, which is what
 * a killed process leaves behind. An idle TUI waiting for input can't be told
 * apart from a closed one, so OpenCode sessions are never `live-idle`.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  DORMANT_AFTER_MS,
  cwdShort,
  type AgentAdapter,
  type AgentSession,
  type AgentStatus,
} from "~/store/agents";

/**
 * Unfinished turn untouched longer than this → "stale". Generous on purpose:
 * a long-running tool call doesn't update its part while it runs.
 */
export const OPENCODE_STALE_AFTER_MS = 30 * 60 * 1000;

export function defaultOpenCodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

export interface LastMessageInfo {
  role?: string;
  completed?: number;
  error?: unknown;
}

export function classifyOpenCodeStatus(
  now: number,
  lastActivityMs: number,
  last: LastMessageInfo | undefined,
  archived: boolean,
): AgentStatus {
  if (archived) return "archived";
  const age = now - lastActivityMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  // A user message with no reply yet also counts: the assistant message is
  // only created once the model starts answering.
  const unfinished =
    last !== undefined &&
    last.error == null &&
    (last.role === "user" || (last.role === "assistant" && !last.completed));
  if (unfinished) return age > OPENCODE_STALE_AFTER_MS ? "stale" : "live-busy";
  return "dormant";
}

/** Title OpenCode assigns until the AI-generated one arrives. */
const PLACEHOLDER_TITLE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/;

function parseJson(raw: unknown): any {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Visible text of a message's parts, skipping synthetic/ignored ones. */
function textOf(partRows: { data: string }[]): string | undefined {
  const texts: string[] = [];
  for (const row of partRows) {
    const p = parseJson(row.data);
    if (!p || p.type !== "text" || typeof p.text !== "string") continue;
    if (p.synthetic || p.ignored) continue;
    texts.push(p.text);
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

interface SessionRow {
  id: string;
  directory: string;
  title: string;
  time_updated: number;
  time_archived: number | null;
}

export function readOpenCodeSessions(dbPath: string, now: number): AgentSession[] {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const sessions = db
      .query<SessionRow, []>(
        `SELECT id, directory, title, time_updated, time_archived
           FROM session WHERE parent_id IS NULL`,
      )
      .all();
    const lastMessage = db.query<{ data: string; time_updated: number }, [string]>(
      `SELECT data, time_updated FROM message
        WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1`,
    );
    const messageCount = db.query<{ n: number }, [string]>(
      `SELECT count(*) AS n FROM message WHERE session_id = ?`,
    );
    const partStats = db.query<{ tools: number; updated: number | null }, [string]>(
      `SELECT sum(json_extract(data, '$.type') = 'tool') AS tools,
              max(time_updated) AS updated
         FROM part WHERE session_id = ?`,
    );
    const lastOfRole = db.query<{ id: string }, [string, string]>(
      `SELECT m.id FROM message m
        WHERE m.session_id = ? AND json_extract(m.data, '$.role') = ?
          AND EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id
                        AND json_extract(p.data, '$.type') = 'text')
        ORDER BY m.time_created DESC, m.id DESC LIMIT 1`,
    );
    const partsOf = db.query<{ data: string }, [string]>(
      `SELECT data FROM part WHERE message_id = ? ORDER BY id`,
    );
    const lastText = (sessionId: string, role: string) => {
      const m = lastOfRole.get(sessionId, role);
      return m ? textOf(partsOf.all(m.id)) : undefined;
    };

    return sessions.map((s) => {
      const last = lastMessage.get(s.id);
      const lastData = parseJson(last?.data);
      const stats = partStats.get(s.id);
      const lastActivityMs = Math.max(
        s.time_updated,
        last?.time_updated ?? 0,
        stats?.updated ?? 0,
      );
      const title = PLACEHOLDER_TITLE.test(s.title) ? "" : s.title.trim();
      const lastUser = lastText(s.id, "user");
      const promptLine = lastUser
        ?.split("\n")
        .find((l) => l.trim().length > 0)
        ?.slice(0, 60);
      const displayName = title
        ? title.slice(0, 60)
        : promptLine
          ? `${promptLine} · ${s.id.slice(4, 12)}`
          : s.id;
      return {
        provider: "opencode",
        sessionId: s.id,
        sourcePath: dbPath,
        cwd: s.directory,
        cwdShort: cwdShort(s.directory),
        status: classifyOpenCodeStatus(
          now,
          lastActivityMs,
          lastData && {
            role: lastData.role,
            completed: lastData.time?.completed,
            error: lastData.error,
          },
          s.time_archived != null,
        ),
        lastActivityMs,
        aiTitle: title || undefined,
        displayName,
        messageCount: messageCount.get(s.id)?.n ?? 0,
        toolCount: stats?.tools ?? 0,
        lastUser,
        lastAssistant: lastText(s.id, "assistant"),
        // Assistant messages carry `modelID`; user messages `model.modelID`.
        model: lastData?.modelID ?? lastData?.model?.modelID,
        resumeCommand: `opencode --session ${s.id}`,
      } satisfies AgentSession;
    });
  } finally {
    db.close();
  }
}

export function createOpenCodeAdapter(dbPath = defaultOpenCodeDbPath()): AgentAdapter {
  return {
    provider: "opencode",
    // OpenCode commits to the WAL; the main file only changes on checkpoint.
    watchPaths: () => [dbPath, `${dbPath}-wal`],
    discover: (now) => readOpenCodeSessions(dbPath, now),
  };
}
