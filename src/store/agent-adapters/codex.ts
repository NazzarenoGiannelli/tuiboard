/**
 * Codex CLI adapter for the agents store.
 *
 * Reads (read-only), under $CODEX_HOME (default ~/.codex):
 *   sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl[.zst]  — transcripts
 *   archived_sessions/rollout-…                          — archived ones
 *   session_index.jsonl                                  — explicit renames
 *   state_<n>.sqlite, table `threads`                    — optional enrichment
 *
 * Format per the Codex source (rust-v0.154.0). Rollouts are authoritative —
 * Codex itself treats the SQLite DB as a rebuildable view — so the list comes
 * from the files and the DB only fills in names and archive flags.
 *
 * Codex keeps no per-session PID file, so liveness is inferred like OpenCode:
 * a `task_started` with no later `task_complete` / `turn_aborted` is a turn in
 * progress (a clean exit writes `turn_aborted`; a killed process leaves the
 * turn open, hence "stale" after CODEX_STALE_AFTER_MS). An idle TUI waiting
 * for input isn't detectable, so Codex sessions are never `live-idle`.
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  DORMANT_AFTER_MS,
  cwdShort,
  type AgentAdapter,
  type AgentSession,
  type AgentStatus,
} from "~/store/agents";

/** Open turn untouched longer than this → "stale" (approval prompts write nothing). */
export const CODEX_STALE_AFTER_MS = 30 * 60 * 1000;

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** `rollout-2026-09-17T08-00-00-<uuid>[_<rolloutId>].jsonl[.zst]` → uuid. */
const ROLLOUT_FILE =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[^.]+)?\.jsonl(\.zst)?$/i;

export function threadIdFromRolloutName(name: string): string | undefined {
  return ROLLOUT_FILE.exec(name)?.[1]?.toLowerCase();
}

const TOOL_ITEM_TYPES = new Set([
  "function_call",
  "custom_tool_call",
  "local_shell_call",
  "web_search_call",
  "tool_search_call",
  "image_generation_call",
]);

/** Thread sources that aren't a human-driven session. */
const HIDDEN_THREAD_SOURCES = new Set(["subagent", "guardian_review", "memory_consolidation"]);

/** Heading the IDE integrations put before the actual prompt. */
const REQUEST_HEADING = "## My request for Codex:";

export interface RolloutParseResult {
  cwd?: string;
  gitBranch?: string;
  /** Model of the latest turn (`turn_context.model`). */
  model?: string;
  /** Subagent / internal thread — not listed on its own. */
  hidden: boolean;
  firstUser?: string;
  lastUser?: string;
  lastAssistant?: string;
  messageCount: number;
  toolCount: number;
  /** A turn started and hasn't completed or been aborted. */
  turnOpen: boolean;
}

function cleanPrompt(text: string): string {
  const at = text.indexOf(REQUEST_HEADING);
  return (at >= 0 ? text.slice(at + REQUEST_HEADING.length) : text).trim();
}

function joinText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((c) => c && typeof c.text === "string" && String(c.type).toLowerCase() === "text")
    .map((c) => c.text as string);
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function isHiddenSource(source: unknown, threadSource: unknown): boolean {
  if (typeof threadSource === "string" && HIDDEN_THREAD_SOURCES.has(threadSource)) return true;
  // SessionSource: "cli" | "vscode" | "exec" | "mcp" | {custom} | {subagent} | {internal}
  return (
    !!source &&
    typeof source === "object" &&
    ("subagent" in source || "internal" in source)
  );
}

/**
 * Single pass over a rollout. Defensive: malformed lines are skipped, since
 * the format is internal to Codex and drifts between versions.
 */
export function parseRollout(content: string, threadId?: string): RolloutParseResult {
  const out: RolloutParseResult = {
    hidden: false,
    messageCount: 0,
    toolCount: 0,
    turnOpen: false,
  };
  let metaMatched = false;
  let lastAgentFallback: string | undefined;

  const user = (raw: string) => {
    const text = cleanPrompt(raw);
    out.messageCount++;
    if (!text) return;
    out.lastUser = text;
    out.firstUser ??= text;
  };
  const assistant = (text: string) => {
    out.messageCount++;
    out.lastAssistant = text;
  };

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const p = obj?.payload;
    if (!p || typeof p !== "object") continue;

    if (obj.type === "session_meta") {
      // A forked rollout embeds its parent's meta too; prefer our own.
      const own = threadId !== undefined && String(p.id).toLowerCase() === threadId;
      if (metaMatched || (out.cwd !== undefined && !own)) continue;
      metaMatched = own;
      out.cwd = typeof p.cwd === "string" ? p.cwd : out.cwd;
      out.gitBranch = p.git?.branch ?? out.gitBranch;
      out.hidden = isHiddenSource(p.source, p.thread_source);
    } else if (obj.type === "turn_context") {
      if (typeof p.model === "string") out.model = p.model;
    } else if (obj.type === "response_item") {
      if (TOOL_ITEM_TYPES.has(p.type)) out.toolCount++;
    } else if (obj.type === "event_msg") {
      switch (p.type) {
        case "task_started":
        case "turn_started":
          out.turnOpen = true;
          break;
        case "task_complete":
        case "turn_complete":
          out.turnOpen = false;
          if (typeof p.last_agent_message === "string") lastAgentFallback = p.last_agent_message;
          break;
        case "turn_aborted":
          out.turnOpen = false;
          break;
        // Legacy history mode.
        case "user_message":
          if (typeof p.message === "string") user(p.message);
          break;
        case "agent_message":
          if (typeof p.message === "string") assistant(p.message);
          break;
        // Paginated history mode (default for new threads).
        case "item_completed": {
          const item = p.item;
          if (item?.type === "UserMessage") {
            const text = joinText(item.content);
            if (text !== undefined) user(text);
          } else if (item?.type === "AgentMessage") {
            const text = joinText(item.content);
            if (text !== undefined) assistant(text);
          }
          break;
        }
      }
    }
  }

  out.lastAssistant ??= lastAgentFallback;
  return out;
}

export function classifyCodexStatus(
  now: number,
  lastActivityMs: number,
  turnOpen: boolean,
  archived: boolean,
): AgentStatus {
  if (archived) return "archived";
  const age = now - lastActivityMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  if (turnOpen) return age > CODEX_STALE_AFTER_MS ? "stale" : "live-busy";
  return "dormant";
}

// ─── Discovery ──────────────────────────────────────────────────────────────

interface RolloutFile {
  threadId: string;
  path: string;
  mtimeMs: number;
  size: number;
  compressed: boolean;
  inArchive: boolean;
}

function listRollouts(dir: string, inArchive: boolean, out: Map<string, RolloutFile>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      listRollouts(path, inArchive, out);
      continue;
    }
    const threadId = threadIdFromRolloutName(e.name);
    if (!threadId || !e.isFile()) continue;
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    // A reverted thread has several rollouts; the newest one is current.
    const prev = out.get(threadId);
    if (prev && prev.mtimeMs >= st.mtimeMs) continue;
    out.set(threadId, {
      threadId,
      path,
      mtimeMs: st.mtimeMs,
      size: st.size,
      compressed: e.name.endsWith(".zst"),
      inArchive,
    });
  }
}

/** Last explicit rename per thread (append-only file, last entry wins). */
function readSessionIndex(path: string): Map<string, string> {
  const names = new Map<string, string>();
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return names;
  }
  for (const line of content.split("\n")) {
    try {
      const e = JSON.parse(line);
      if (typeof e?.id === "string" && typeof e.thread_name === "string") {
        names.set(e.id.toLowerCase(), e.thread_name);
      }
    } catch {
      // skip partial/malformed lines
    }
  }
  return names;
}

interface ThreadRow {
  id: string;
  title: string | null;
  name: string | null;
  archived: number | null;
  cwd: string | null;
  git_branch: string | null;
  model?: string | null;
}

/** Newest `state_<n>.sqlite`, if any. */
function findStateDb(dir: string): string | undefined {
  let best: { n: number; path: string } | undefined;
  try {
    for (const f of readdirSync(dir)) {
      const m = /^state_(\d+)\.sqlite$/.exec(f);
      if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), path: join(dir, f) };
    }
  } catch {
    return undefined;
  }
  return best?.path;
}

function readThreadRows(dbPath: string | undefined): Map<string, ThreadRow> {
  const rows = new Map<string, ThreadRow>();
  if (!dbPath) return rows;
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    for (const r of db
      // SELECT * so optional columns (e.g. `model`, added in later schema
      // versions) are read when present without failing when absent.
      .query<ThreadRow, []>(`SELECT * FROM threads`)
      .all()) {
      rows.set(r.id.toLowerCase(), r);
    }
  } catch {
    // Missing table or schema drift: rollouts alone are enough.
  } finally {
    db?.close();
  }
  return rows;
}

function firstLine(text: string | undefined): string | undefined {
  return text?.split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 60);
}

export function createCodexAdapter(codexHome = defaultCodexHome()): AgentAdapter {
  const sessionsDir = join(codexHome, "sessions");
  const archiveDir = join(codexHome, "archived_sessions");
  const indexPath = join(codexHome, "session_index.jsonl");
  const sqliteHome = process.env.CODEX_SQLITE_HOME || codexHome;

  // Rollouts only grow while a turn runs, and every append triggers a refresh:
  // re-parse a file only when its mtime/size changed.
  const cache = new Map<string, { mtimeMs: number; size: number; parsed: RolloutParseResult }>();

  function parseFile(f: RolloutFile): RolloutParseResult {
    const hit = cache.get(f.path);
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.parsed;
    let parsed: RolloutParseResult;
    try {
      const raw = readFileSync(f.path);
      const text = new TextDecoder().decode(f.compressed ? Bun.zstdDecompressSync(raw) : raw);
      parsed = parseRollout(text, f.threadId);
    } catch {
      parsed = { hidden: false, messageCount: 0, toolCount: 0, turnOpen: false };
    }
    cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
    return parsed;
  }

  function discover(now: number): AgentSession[] {
    if (!existsSync(codexHome)) return [];
    const files = new Map<string, RolloutFile>();
    listRollouts(sessionsDir, false, files);
    listRollouts(archiveDir, true, files);
    const renames = readSessionIndex(indexPath);
    const threads = readThreadRows(findStateDb(sqliteHome));

    const sessions: AgentSession[] = [];
    for (const f of files.values()) {
      const parsed = parseFile(f);
      if (parsed.hidden) continue;
      const row = threads.get(f.threadId);
      const cwd = parsed.cwd ?? row?.cwd ?? "";
      const customTitle = renames.get(f.threadId) ?? row?.name ?? undefined;
      const fallback = firstLine(parsed.firstUser) ?? firstLine(row?.title ?? undefined);
      const id8 = f.threadId.slice(0, 8);
      const displayName = customTitle
        ? customTitle.slice(0, 60)
        : fallback
          ? `${fallback} · ${id8}`
          : id8;
      sessions.push({
        provider: "codex",
        sessionId: f.threadId,
        sourcePath: f.path,
        cwd,
        cwdShort: cwdShort(cwd),
        status: classifyCodexStatus(
          now,
          f.mtimeMs,
          parsed.turnOpen,
          f.inArchive || Boolean(row?.archived),
        ),
        lastActivityMs: f.mtimeMs,
        customTitle,
        displayName,
        messageCount: parsed.messageCount,
        toolCount: parsed.toolCount,
        lastUser: parsed.lastUser,
        lastAssistant: parsed.lastAssistant,
        gitBranch: parsed.gitBranch ?? row?.git_branch ?? undefined,
        model: parsed.model ?? row?.model ?? undefined,
        resumeCommand: `codex resume ${f.threadId}`,
      });
    }
    // Drop cache entries for files that disappeared (archived / deleted).
    const live = new Set([...files.values()].map((f) => f.path));
    for (const path of cache.keys()) if (!live.has(path)) cache.delete(path);
    return sessions;
  }

  return {
    provider: "codex",
    watchPaths: () => [sessionsDir, archiveDir, indexPath],
    discover,
  };
}
