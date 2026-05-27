/**
 * Discovery + reactive store for local Claude Code sessions.
 *
 * Reads:
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl  — transcripts
 *   ~/.claude/sessions/<sessionId>.json          — live PID records
 *
 * Watches both with chokidar; re-parses the changed jsonl on update.
 * Eager initial scan (1-2s for ~80 sessions) is acceptable startup cost.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chokidar from "chokidar";
import { createSignal } from "solid-js";

const CLAUDE_HOME = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_HOME, "projects");
const SESSIONS_DIR = join(CLAUDE_HOME, "sessions");

/** Threshold: PID record older than this means the Claude process likely crashed. */
const LIVE_STALE_AFTER_MS = 5 * 60 * 1000;
/** Threshold: jsonl untouched longer than this is "archived" (won't show in compact list). */
const DORMANT_AFTER_MS = 7 * 86_400 * 1000;

export type AgentStatus =
  | "live-busy"
  | "live-idle"
  | "stale-pid"
  | "dormant"
  | "archived";

export interface LivePidRecord {
  mtimeMs: number;
  /** "busy" | "idle" | undefined */
  status?: string;
  pid?: number;
  version?: string;
  cwd?: string;
}

export interface AgentSession {
  sessionId: string;
  jsonlPath: string;
  cwd: string;
  cwdShort: string;
  status: AgentStatus;
  lastActivityMs: number;
  customTitle?: string;
  aiTitle?: string;
  displayName: string;
  messageCount: number;
  toolCount: number;
  lastUser?: string;
  lastAssistant?: string;
  gitBranch?: string;
}

/** Reverse Claude Code's path-to-slug encoding (lossy on case). */
export function cwdFromSlug(slug: string): string {
  // Drive letter heuristic: "C--Users-foo" → "C:\Users\foo"
  if (slug.length >= 2 && slug[1] === "-") {
    return slug[0] + ":\\" + slug.slice(3).replaceAll("-", "\\");
  }
  return slug.replaceAll("-", "\\");
}

/** Last 3 path parts with leading ellipsis when path is long. */
export function cwdShort(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.length >= 4) {
    return "…" + parts.slice(-3).join("\\");
  }
  return cwd;
}

export function classifyStatus(
  now: number,
  jsonlMtimeMs: number,
  live: LivePidRecord | undefined,
): AgentStatus {
  if (live) {
    if (now - live.mtimeMs > LIVE_STALE_AFTER_MS) return "stale-pid";
    return live.status === "busy" ? "live-busy" : "live-idle";
  }
  const age = now - jsonlMtimeMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  return "dormant";
}

/** Compact human-readable age. Mirrors av.py `_fmt_age`. */
export function formatAge(ts: number, now: number): string {
  if (!ts) return "—";
  const delta = (now - ts) / 1000;
  if (delta < 60) return `${Math.floor(delta)}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

export interface TranscriptParseResult {
  customTitle?: string;
  aiTitle?: string;
  lastUser?: string;
  lastAssistant?: string;
  messageCount: number;
  toolCount: number;
  gitBranch?: string;
}

/**
 * Lightweight pass over a jsonl transcript. Defensive: malformed lines
 * are skipped silently because the format is internal to Claude Code
 * and may drift between versions.
 */
export function parseTranscript(content: string): TranscriptParseResult {
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let lastUser: string | undefined;
  let lastAssistant: string | undefined;
  let gitBranch: string | undefined;
  let messageCount = 0;
  let toolCount = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.gitBranch) gitBranch = obj.gitBranch;
    const t = obj.type;
    if (t === "custom-title") {
      customTitle = obj.customTitle ?? obj.title ?? customTitle;
      continue;
    }
    if (t === "ai-title") {
      aiTitle = obj.aiTitle ?? obj.title ?? aiTitle;
      continue;
    }
    const msg = obj.message ?? {};
    const role = msg.role;
    if (role === "user") {
      messageCount++;
      const content = msg.content;
      if (typeof content === "string") {
        lastUser = content;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            part.type === "text" &&
            typeof part.text === "string"
          ) {
            lastUser = part.text;
          }
        }
      }
    } else if (role === "assistant") {
      messageCount++;
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "text" && typeof part.text === "string") {
            lastAssistant = part.text;
          } else if (part.type === "tool_use") {
            toolCount++;
          }
        }
      }
    }
  }

  return {
    customTitle,
    aiTitle,
    lastUser,
    lastAssistant,
    messageCount,
    toolCount,
    gitBranch,
  };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

function discoverLivePids(): Map<string, LivePidRecord> {
  const out = new Map<string, LivePidRecord>();
  if (!existsSync(SESSIONS_DIR)) return out;
  let entries: string[];
  try {
    entries = readdirSync(SESSIONS_DIR);
  } catch {
    return out;
  }
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    const path = join(SESSIONS_DIR, f);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const sid = raw.sessionId;
      if (!sid) continue;
      const stat = statSync(path);
      out.set(sid, {
        mtimeMs: stat.mtimeMs,
        status: raw.status?.toLowerCase(),
        pid: raw.pid,
        version: raw.version,
        cwd: raw.cwd,
      });
    } catch {
      // ignore — malformed PID files happen during writes
    }
  }
  return out;
}

interface JsonlEntry {
  slug: string;
  sessionId: string;
  path: string;
  mtimeMs: number;
}

function discoverJsonlFiles(): JsonlEntry[] {
  const out: JsonlEntry[] = [];
  if (!existsSync(PROJECTS_DIR)) return out;
  let slugs: string[];
  try {
    slugs = readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const slug of slugs) {
    const slugDir = join(PROJECTS_DIR, slug);
    let slugStat;
    try {
      slugStat = statSync(slugDir);
    } catch {
      continue;
    }
    if (!slugStat.isDirectory()) continue;
    let inner: string[];
    try {
      inner = readdirSync(slugDir);
    } catch {
      continue;
    }
    for (const f of inner) {
      // Skip subagent transcripts — they're addressed by their parent session.
      if (!f.endsWith(".jsonl")) continue;
      const path = join(slugDir, f);
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;
        out.push({
          slug,
          sessionId: f.slice(0, -".jsonl".length),
          path,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  return out;
}

function buildSession(
  jsonl: JsonlEntry,
  live: LivePidRecord | undefined,
  now: number,
): AgentSession {
  let parsed: TranscriptParseResult;
  try {
    parsed = parseTranscript(readFileSync(jsonl.path, "utf-8"));
  } catch {
    parsed = { messageCount: 0, toolCount: 0 };
  }
  const cwd = live?.cwd ?? cwdFromSlug(jsonl.slug);
  const displayName =
    parsed.customTitle?.slice(0, 60) ??
    parsed.aiTitle?.slice(0, 60) ??
    parsed.lastUser?.split("\n")[0]?.slice(0, 60) ??
    jsonl.sessionId.slice(0, 8);
  return {
    sessionId: jsonl.sessionId,
    jsonlPath: jsonl.path,
    cwd,
    cwdShort: cwdShort(cwd),
    status: classifyStatus(now, jsonl.mtimeMs, live),
    lastActivityMs: jsonl.mtimeMs,
    customTitle: parsed.customTitle,
    aiTitle: parsed.aiTitle,
    displayName,
    messageCount: parsed.messageCount,
    toolCount: parsed.toolCount,
    lastUser: parsed.lastUser,
    lastAssistant: parsed.lastAssistant,
    gitBranch: parsed.gitBranch,
  };
}

const STATUS_RANK: Record<AgentStatus, number> = {
  "live-busy": 0,
  "live-idle": 1,
  "stale-pid": 2,
  "dormant": 3,
  "archived": 4,
};

function sortSessions(arr: AgentSession[]): AgentSession[] {
  return arr.slice().sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r !== 0) return r;
    return b.lastActivityMs - a.lastActivityMs;
  });
}

// ─── Reactive store ─────────────────────────────────────────────────────────

export interface AgentsStore {
  sessions: () => AgentSession[];
  refresh: () => void;
  dispose: () => Promise<void>;
}

/**
 * Reactive store of local Claude Code sessions. Watches the .claude
 * projects + sessions directories and refreshes on any change with a
 * short debounce. Initial scan is eager.
 */
export function createAgentsStore(): AgentsStore {
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);

  function refresh(): void {
    const now = Date.now();
    const live = discoverLivePids();
    const jsonlFiles = discoverJsonlFiles();
    const built = jsonlFiles.map((j) =>
      buildSession(j, live.get(j.sessionId), now),
    );
    setSessions(sortSessions(built));
  }

  refresh();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 200);
  };

  const watcher = chokidar.watch([PROJECTS_DIR, SESSIONS_DIR], {
    ignoreInitial: true,
    depth: 3,
  });
  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);

  async function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer);
    await watcher.close();
  }

  return { sessions, refresh, dispose };
}
