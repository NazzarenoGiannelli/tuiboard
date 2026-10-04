/**
 * herdr (terminal workspace manager for coding agents) link.
 *
 * `herdr api snapshot` lists every pane with the agent running in it, that
 * agent's state and — when herdr's integration for that agent is installed —
 * the agent session it's on (`{kind: "id"}` for Claude/OpenCode, `{kind:
 * "path"}` for Pi). tuiboard polls it and links panes to its own sessions, so
 * a session open in herdr shows herdr's live state (including "idle" and
 * "waiting for you", which the on-disk formats can't tell) and where it lives.
 *
 * Optional by design: no `herdr` on PATH, no server, or an unexpected answer
 * all just mean "no links".
 */

import type { AgentProvider, AgentSession, AgentStatus } from "~/store/agents";

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface HerdrPane {
  paneId: string;
  tabId: string;
  workspaceId: string;
  agent?: string;
  status: HerdrAgentStatus;
  cwd: string;
  session?: { kind: "id" | "path"; value: string };
}

export interface HerdrSnapshot {
  panes: HerdrPane[];
  focusedWorkspaceId?: string;
  tabs: Map<string, { label: string; number: number }>;
  workspaces: Map<string, { label: string; number: number }>;
}

/** The `herdr` binary to drive: the one herdr itself advertises, else PATH. */
export function herdrBin(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.HERDR_BIN_PATH || Bun.which("herdr") || undefined;
}

/** Where a session is open in herdr. */
export interface HerdrLink {
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
  tabNumber: number;
  status: HerdrAgentStatus;
  /** How the pane was matched; `cwd` = no session identity from herdr. */
  matchedBy: "id" | "path" | "cwd";
  /** herdr's name for the agent (for `herdr integration install <name>`). */
  agent: string;
}

/** `herdr blits · tab 3` */
export function herdrPlace(l: HerdrLink): string {
  return `herdr ${l.workspaceLabel || l.workspaceId} · tab ${l.tabNumber || l.tabId}`;
}

/** herdr agent name ↔ tuiboard provider. */
export const HERDR_AGENT: Record<AgentProvider, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
  omp: "omp",
};
const PROVIDER_OF: Record<string, AgentProvider> = Object.fromEntries(
  Object.entries(HERDR_AGENT).map(([p, a]) => [a, p as AgentProvider]),
);

const STATUSES = new Set<HerdrAgentStatus>(["idle", "working", "blocked", "done", "unknown"]);

/** Parse `herdr api snapshot` output. Returns undefined if it isn't one. */
export function parseHerdrSnapshot(raw: string): HerdrSnapshot | undefined {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const snap = data?.result?.snapshot ?? data?.snapshot;
  if (!snap || !Array.isArray(snap.panes)) return undefined;
  const panes: HerdrPane[] = [];
  for (const p of snap.panes) {
    if (typeof p?.pane_id !== "string") continue;
    const s = p.agent_session;
    panes.push({
      paneId: p.pane_id,
      tabId: String(p.tab_id ?? ""),
      workspaceId: String(p.workspace_id ?? ""),
      agent: typeof p.agent === "string" ? p.agent : undefined,
      status: STATUSES.has(p.agent_status) ? p.agent_status : "unknown",
      cwd: String(p.cwd ?? ""),
      session:
        s && (s.kind === "id" || s.kind === "path") && typeof s.value === "string"
          ? { kind: s.kind, value: s.value }
          : undefined,
    });
  }
  const byId = (list: unknown, key: string) =>
    new Map<string, { label: string; number: number }>(
      (Array.isArray(list) ? list : [])
        .filter((x: any) => typeof x?.[key] === "string")
        .map((x: any) => [x[key], { label: String(x.label ?? ""), number: Number(x.number ?? 0) }]),
    );
  return {
    panes,
    focusedWorkspaceId: typeof snap.focused_workspace_id === "string" ? snap.focused_workspace_id : undefined,
    tabs: byId(snap.tabs, "tab_id"),
    workspaces: byId(snap.workspaces, "workspace_id"),
  };
}

/** Compare paths across the formats agents store (`C:/x`, `C:\x`, lossy case). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let s = p.replaceAll("\\", "/").replace(/\/+$/, "");
    if (/^[A-Za-z]:/.test(s)) s = s.toLowerCase();
    return s;
  };
  if (!a || !b) return false;
  const x = norm(a);
  const y = norm(b);
  return x === y || x.toLowerCase() === y.toLowerCase();
}

const STATUS_FROM_HERDR: Partial<Record<HerdrAgentStatus, AgentStatus>> = {
  working: "live-busy",
  blocked: "live-blocked",
  done: "live-done",
  idle: "live-idle",
};

/**
 * Attach herdr links to sessions and let herdr's state win where it knows
 * it. Panes reporting a session id/path are matched first; panes without one
 * fall back to "most recent session of that agent in that directory".
 */
export function linkHerdrSessions(
  sessions: AgentSession[],
  snap: HerdrSnapshot | undefined,
): AgentSession[] {
  if (!snap || snap.panes.length === 0) return sessions;
  const links = new Map<AgentSession, HerdrLink>();
  const link = (s: AgentSession, p: HerdrPane, matchedBy: HerdrLink["matchedBy"]) => {
    const tab = snap.tabs.get(p.tabId);
    links.set(s, {
      paneId: p.paneId,
      tabId: p.tabId,
      workspaceId: p.workspaceId,
      workspaceLabel: snap.workspaces.get(p.workspaceId)?.label ?? "",
      tabLabel: tab?.label ?? "",
      tabNumber: tab?.number ?? 0,
      status: p.status,
      matchedBy,
      agent: p.agent ?? "",
    });
  };
  const agentPanes = snap.panes.filter((p) => p.agent && PROVIDER_OF[p.agent]);

  for (const p of agentPanes) {
    if (!p.session) continue;
    const provider = PROVIDER_OF[p.agent!];
    const { kind, value } = p.session;
    const s = sessions.find(
      (x) =>
        x.provider === provider &&
        !links.has(x) &&
        (kind === "id"
          ? x.sessionId === value
          : samePath(x.sourcePath, value) || value.includes(x.sessionId)),
    );
    if (s) link(s, p, kind);
  }
  for (const p of agentPanes) {
    if (p.session) continue;
    const provider = PROVIDER_OF[p.agent!];
    const s = sessions
      .filter((x) => x.provider === provider && !links.has(x) && samePath(x.cwd, p.cwd))
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0];
    if (s) link(s, p, "cwd");
  }

  if (links.size === 0) return sessions;
  return sessions.map((s) => {
    const l = links.get(s);
    if (!l) return s;
    return { ...s, herdr: l, status: STATUS_FROM_HERDR[l.status] ?? s.status };
  });
}

/** Agent status glyph style — the same two herdr offers. */
export type IndicatorStyle = "dots" | "symbols";

/** One synchronous snapshot, for CLI/dev scripts. */
export function readHerdrSnapshotOnce(bin = Bun.which("herdr") ?? undefined): HerdrSnapshot | undefined {
  if (!bin) return undefined;
  try {
    const res = Bun.spawnSync([bin, "api", "snapshot"], { stdout: "pipe", stderr: "ignore", timeout: 5000 });
    return res.exitCode === 0 ? parseHerdrSnapshot(res.stdout.toString()) : undefined;
  } catch {
    return undefined;
  }
}

// ─── Polling source ─────────────────────────────────────────────────────────

export interface HerdrSource {
  snapshot: () => HerdrSnapshot | undefined;
  onChange: (cb: () => void) => void;
  dispose: () => void;
}

export const HERDR_POLL_MS = 2000;
/**
 * Consecutive failed polls before herdr counts as gone. A single slow or
 * failed call used to drop every link at once, making states flicker.
 */
export const HERDR_MISSES_BEFORE_CLEAR = 3;

/**
 * Poll `herdr api snapshot` in the background. Inert when herdr isn't on
 * PATH (or `bin: null`). A failing call clears the snapshot (server gone)
 * without noise.
 */
export function createHerdrSource(
  {
    pollMs = HERDR_POLL_MS,
    bin = Bun.which("herdr"),
    missesBeforeClear = HERDR_MISSES_BEFORE_CLEAR,
  }: { pollMs?: number; bin?: string | null; missesBeforeClear?: number } = {},
): HerdrSource {
  let current: HerdrSnapshot | undefined;
  let lastRaw = "";
  const listeners: (() => void)[] = [];
  if (!bin) return { snapshot: () => undefined, onChange: () => {}, dispose: () => {} };

  let inFlight = false;
  let disposed = false;
  let misses = 0;
  const poll = async () => {
    if (inFlight || disposed) return;
    inFlight = true;
    try {
      const proc = Bun.spawn([bin, "api", "snapshot"], {
        stdout: "pipe",
        stderr: "ignore",
        windowsHide: true,
      });
      const timer = setTimeout(() => proc.kill(), 5000);
      const out = await new Response(proc.stdout).text();
      clearTimeout(timer);
      const code = await proc.exited;
      let snap = code === 0 ? parseHerdrSnapshot(out) : undefined;
      if (snap) misses = 0;
      else if (++misses < missesBeforeClear) snap = current; // ride out a blip
      // Only the parts we use decide whether anything changed.
      const key = snap
        ? JSON.stringify([snap.panes, [...snap.tabs], [...snap.workspaces]])
        : "";
      if (key !== lastRaw && !disposed) {
        lastRaw = key;
        current = snap;
        for (const cb of listeners) cb();
      }
    } catch {
      // herdr vanished mid-call — counts as a miss, try again next tick
      misses++;
    } finally {
      inFlight = false;
    }
  };
  void poll();
  const timer = setInterval(poll, pollMs);
  timer.unref?.();
  return {
    snapshot: () => current,
    onChange: (cb) => listeners.push(cb),
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}
