/**
 * Discovery + reactive store for local coding-agent sessions.
 *
 * Each agent CLI (Claude Code today) plugs in through an `AgentAdapter`
 * that owns its own on-disk format, status semantics and resume command —
 * see `src/store/agent-adapters/`. This module only holds the shared shape
 * and merges every adapter's sessions into one sorted, watched list.
 */

import chokidar from "chokidar";
import { createSignal } from "solid-js";

/** Threshold: session untouched longer than this is "archived" (won't show in compact list). */
export const DORMANT_AFTER_MS = 7 * 86_400 * 1000;

export type AgentProvider = "claude-code";

export type AgentStatus =
  | "live-busy"
  | "live-idle"
  /** Looks busy, but stopped updating — the process likely crashed. */
  | "stale"
  | "dormant"
  | "archived";

export interface AgentSession {
  provider: AgentProvider;
  sessionId: string;
  /** File (or database) the session was read from. */
  sourcePath: string;
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
  /** Shell command that resumes this session when run from `cwd`. */
  resumeCommand: string;
}

/** One agent CLI's session source. */
export interface AgentAdapter {
  provider: AgentProvider;
  /** Files/directories whose changes should trigger a refresh. */
  watchPaths(): string[];
  /** Full scan. Must not throw — a missing install yields `[]`. */
  discover(now: number): AgentSession[];
}

/** Last 3 path parts with leading ellipsis when path is long. */
export function cwdShort(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.length >= 4) {
    return "…" + parts.slice(-3).join("\\");
  }
  return cwd;
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

const STATUS_RANK: Record<AgentStatus, number> = {
  "live-busy": 0,
  "live-idle": 1,
  "stale": 2,
  "dormant": 3,
  "archived": 4,
};

export function sortSessions(arr: AgentSession[]): AgentSession[] {
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
 * Reactive store of local agent sessions. Watches every adapter's paths
 * and refreshes on any change with a short debounce. Initial scan is eager.
 */
export function createAgentsStore(adapters: AgentAdapter[]): AgentsStore {
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);

  function refresh(): void {
    const now = Date.now();
    const built: AgentSession[] = [];
    for (const adapter of adapters) {
      try {
        built.push(...adapter.discover(now));
      } catch {
        // One broken adapter must not blank out the others.
      }
    }
    setSessions(sortSessions(built));
  }

  refresh();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 200);
  };

  const watcher = chokidar.watch(
    adapters.flatMap((a) => a.watchPaths()),
    { ignoreInitial: true, depth: 3 },
  );
  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);

  async function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer);
    await watcher.close();
  }

  return { sessions, refresh, dispose };
}
