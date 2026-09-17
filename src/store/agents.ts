/**
 * Discovery + reactive store for local coding-agent sessions.
 *
 * Each agent CLI (Claude Code, Codex, OpenCode) plugs in through an `AgentAdapter`
 * that owns its own on-disk format, status semantics and resume command —
 * see `src/store/agent-adapters/`. This module only holds the shared shape
 * and merges every adapter's sessions into one sorted, watched list.
 */

import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

import chokidar from "chokidar";
import { createSignal } from "solid-js";

/** Threshold: session untouched longer than this is "archived" (won't show in compact list). */
export const DORMANT_AFTER_MS = 7 * 86_400 * 1000;

export type AgentProvider = "claude-code" | "codex" | "opencode";

/** Two-letter harness badge + display name, per provider. (`pi` = Pi, once its adapter lands.) */
export const HARNESS: Record<AgentProvider, { code: string; name: string }> = {
  "claude-code": { code: "cc", name: "Claude Code" },
  codex: { code: "cx", name: "Codex" },
  opencode: { code: "oc", name: "OpenCode" },
};

/** Agents-zone filter: every harness, or just one. */
export type AgentsFilter = "all" | AgentProvider;

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
  /** Model id as the agent recorded it (latest turn), e.g. `claude-opus-5`. */
  model?: string;
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

/** Last 3 path parts with leading ellipsis when path is long. Keeps the path's own separator. */
export function cwdShort(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.length >= 4) {
    const sep = cwd.includes("/") ? "/" : "\\";
    return "…" + parts.slice(-3).join(sep);
  }
  return cwd;
}

/**
 * Compact model label for tight rows: drops the provider prefix, the
 * `claude-` family prefix, date stamps and context-window suffixes.
 *   `claude-opus-5[1m]` → `opus-5` · `anthropic/claude-sonnet-4-5-20250929` → `sonnet-4-5`
 */
export function shortModel(raw: string | undefined): string | undefined {
  if (!raw || raw.startsWith("<")) return undefined; // e.g. Claude's "<synthetic>"
  const m = (raw.split("/").pop() ?? raw)
    .replace(/\[[^\]]*\]$/, "")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "");
  return m || undefined;
}

/** Apply the Agents-zone harness filter. Keeps the store's sort order. */
export function filterSessions(arr: AgentSession[], filter: AgentsFilter): AgentSession[] {
  return filter === "all" ? arr : arr.filter((s) => s.provider === filter);
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

const DEBOUNCE_MS = 200;
/** Cap on debounce deferral, so a session streaming non-stop still refreshes. */
const DEBOUNCE_MAX_WAIT_MS = 1000;
/**
 * The watcher ignores paths that don't exist yet (agent installed, or first
 * session started, after tuiboard launched) — poll for them this often.
 */
const MISSING_PATH_POLL_MS = 5000;

/**
 * Reactive store of local agent sessions. Watches every adapter's paths and,
 * on a change, re-scans only the adapter that owns the changed path (short
 * debounce). Initial scan is eager.
 */
export function createAgentsStore(
  adapters: AgentAdapter[],
  { missingPathPollMs = MISSING_PATH_POLL_MS } = {},
): AgentsStore {
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);
  const byAdapter = new Map<AgentAdapter, AgentSession[]>();

  function scan(adapter: AgentAdapter, now: number): void {
    try {
      byAdapter.set(adapter, adapter.discover(now));
    } catch {
      // One broken adapter must not blank out the others; keep its last list.
    }
  }

  function publish(): void {
    setSessions(sortSessions([...byAdapter.values()].flat()));
  }

  function refresh(): void {
    const now = Date.now();
    for (const adapter of adapters) scan(adapter, now);
    publish();
  }

  refresh();

  const watched = adapters.flatMap((adapter) =>
    adapter.watchPaths().map((p) => ({ root: resolve(p), adapter })),
  );
  const owners = (path: string) => {
    const abs = resolve(path);
    return new Set(
      watched
        .filter((w) => abs === w.root || abs.startsWith(w.root + sep))
        .map((w) => w.adapter),
    );
  };

  const pending = new Set<AgentAdapter>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt = 0;
  const flush = () => {
    debounceTimer = undefined;
    const now = Date.now();
    for (const adapter of pending) scan(adapter, now);
    pending.clear();
    publish();
  };
  const onChange = (path: string) => {
    const hit = owners(path);
    if (hit.size === 0) return;
    for (const adapter of hit) pending.add(adapter);
    const now = Date.now();
    if (debounceTimer) clearTimeout(debounceTimer);
    else firstPendingAt = now;
    const wait = Math.min(DEBOUNCE_MS, firstPendingAt + DEBOUNCE_MAX_WAIT_MS - now);
    debounceTimer = setTimeout(flush, Math.max(0, wait));
  };

  const roots = [...new Set(watched.map((w) => w.root))];
  const watcher = chokidar.watch(
    roots.filter((r) => existsSync(r)),
    { ignoreInitial: true, depth: 3 },
  );
  watcher.on("add", onChange);
  watcher.on("addDir", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);

  let missing = roots.filter((r) => !existsSync(r));
  const missingPoll = setInterval(() => {
    const appeared = missing.filter((r) => existsSync(r));
    if (appeared.length === 0) return;
    missing = missing.filter((r) => !appeared.includes(r));
    watcher.add(appeared);
    for (const root of appeared) onChange(root);
    if (missing.length === 0) clearInterval(missingPoll);
  }, missingPathPollMs);
  missingPoll.unref?.();
  if (missing.length === 0) clearInterval(missingPoll);

  async function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(missingPoll);
    await watcher.close();
  }

  return { sessions, refresh, dispose };
}
