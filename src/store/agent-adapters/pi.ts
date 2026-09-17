/**
 * Pi (pi.dev) adapter for the agents store.
 *
 * Reads (read-only), per Pi's `docs/session-format.md`:
 *   <sessions dir>/--<cwd>--/<timestamp>_<uuid>.jsonl
 *     line 1   {"type":"session","id":<uuid>,"cwd":…}
 *     then     tree entries — `message` (user / assistant / toolResult / …),
 *              `session_info` (name), `model_change`, `compaction`, …
 *
 * Sessions dir: $PI_CODING_AGENT_SESSION_DIR, else `sessionDir` in
 * <agent dir>/settings.json, else <agent dir>/sessions; agent dir is
 * $PI_CODING_AGENT_DIR or ~/.pi/agent.
 *
 * Pi keeps no PID registry, so liveness is inferred like Codex/OpenCode: a
 * turn is in progress while the last message still awaits the model (user,
 * tool result, or an assistant that stopped to call tools); "stale" once the
 * file is untouched for PI_STALE_AFTER_MS. Idle TUIs aren't detectable.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  DORMANT_AFTER_MS,
  cwdShort,
  type AgentAdapter,
  type AgentSession,
  type AgentStatus,
} from "~/store/agents";

/** Open turn untouched longer than this → "stale". */
export const PI_STALE_AFTER_MS = 30 * 60 * 1000;

function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") || p.startsWith("~\\") ? join(homedir(), p.slice(2)) : p;
}

export function defaultPiSessionsDir(env: Record<string, string | undefined> = process.env): string {
  if (env.PI_CODING_AGENT_SESSION_DIR) return expandHome(env.PI_CODING_AGENT_SESSION_DIR);
  const agentDir = expandHome(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
    if (typeof settings?.sessionDir === "string" && settings.sessionDir) {
      const dir = expandHome(settings.sessionDir);
      return isAbsolute(dir) ? dir : resolve(agentDir, dir);
    }
  } catch {
    // no settings / not JSON: default location
  }
  return join(agentDir, "sessions");
}

export interface PiParseResult {
  sessionId?: string;
  cwd?: string;
  name?: string;
  firstUser?: string;
  lastUser?: string;
  lastAssistant?: string;
  model?: string;
  messageCount: number;
  toolCount: number;
  /** The last message still awaits the model. */
  turnOpen: boolean;
}

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/**
 * Single pass in file order (entries are appended as they happen, so the
 * last message line is the current position). Defensive: malformed lines
 * are skipped.
 */
export function parsePiSession(content: string): PiParseResult {
  const out: PiParseResult = { messageCount: 0, toolCount: 0, turnOpen: false };
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    switch (e?.type) {
      case "session":
        if (typeof e.id === "string") out.sessionId = e.id;
        if (typeof e.cwd === "string") out.cwd = e.cwd;
        break;
      case "session_info":
        // `name` undefined clears it.
        out.name = typeof e.name === "string" && e.name ? e.name : undefined;
        break;
      case "model_change":
        if (typeof e.modelId === "string") out.model = e.modelId;
        break;
      case "message": {
        const m = e.message;
        switch (m?.role) {
          case "user": {
            out.messageCount++;
            out.turnOpen = true;
            const text = textOf(m.content);
            if (text) {
              out.lastUser = text;
              out.firstUser ??= text;
            }
            break;
          }
          case "assistant": {
            out.messageCount++;
            if (typeof m.model === "string") out.model = m.model;
            if (Array.isArray(m.content)) {
              out.toolCount += m.content.filter((c: any) => c?.type === "toolCall").length;
            }
            const text = textOf(m.content);
            if (text) out.lastAssistant = text;
            // toolUse: tools run next and the model is called again.
            out.turnOpen = m.stopReason === "toolUse";
            break;
          }
          case "toolResult":
          case "bashExecution":
            out.turnOpen = true;
            break;
        }
        break;
      }
    }
  }
  return out;
}

export function classifyPiStatus(
  now: number,
  lastActivityMs: number,
  turnOpen: boolean,
): AgentStatus {
  const age = now - lastActivityMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  if (turnOpen) return age > PI_STALE_AFTER_MS ? "stale" : "live-busy";
  return "dormant";
}

interface SessionFile {
  path: string;
  mtimeMs: number;
  size: number;
}

function listSessionFiles(root: string): SessionFile[] {
  const out: SessionFile[] = [];
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = join(root, d.name);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(dir, f);
      try {
        const st = statSync(path);
        if (st.isFile()) out.push({ path, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // vanished mid-scan
      }
    }
  }
  return out;
}

/** `<timestamp>_<uuid>.jsonl` → uuid, for files whose header can't be read. */
function idFromFileName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.jsonl$/, "").split("_").pop() ?? base;
}

function firstLine(text: string | undefined): string | undefined {
  return text?.split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 60);
}

export function createPiAdapter(sessionsDir = defaultPiSessionsDir()): AgentAdapter {
  // Sessions grow while a turn runs: re-parse a file only when it changed.
  const cache = new Map<string, { mtimeMs: number; size: number; parsed: PiParseResult }>();

  function parseFile(f: SessionFile): PiParseResult {
    const hit = cache.get(f.path);
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.parsed;
    let parsed: PiParseResult;
    try {
      parsed = parsePiSession(readFileSync(f.path, "utf-8"));
    } catch {
      parsed = { messageCount: 0, toolCount: 0, turnOpen: false };
    }
    cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
    return parsed;
  }

  function discover(now: number): AgentSession[] {
    if (!existsSync(sessionsDir)) return [];
    const files = listSessionFiles(sessionsDir);
    const sessions = files.map((f): AgentSession => {
      const p = parseFile(f);
      const sessionId = p.sessionId ?? idFromFileName(f.path);
      const cwd = p.cwd ?? "";
      const fallback = firstLine(p.firstUser);
      const id8 = sessionId.slice(0, 8);
      return {
        provider: "pi",
        sessionId,
        sourcePath: f.path,
        cwd,
        cwdShort: cwdShort(cwd),
        status: classifyPiStatus(now, f.mtimeMs, p.turnOpen),
        lastActivityMs: f.mtimeMs,
        customTitle: p.name,
        displayName: p.name ? p.name.slice(0, 60) : fallback ? `${fallback} · ${id8}` : id8,
        messageCount: p.messageCount,
        toolCount: p.toolCount,
        lastUser: p.lastUser,
        lastAssistant: p.lastAssistant,
        model: p.model,
        resumeCommand: `pi --session ${sessionId}`,
        resumeArgv: ["pi", "--session", sessionId],
      };
    });
    const live = new Set(files.map((f) => f.path));
    for (const path of cache.keys()) if (!live.has(path)) cache.delete(path);
    return sessions;
  }

  return {
    provider: "pi",
    watchPaths: () => [sessionsDir],
    discover,
  };
}
