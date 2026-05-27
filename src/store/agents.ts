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
