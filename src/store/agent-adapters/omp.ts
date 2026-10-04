/**
 * oh-my-pi (omp) adapter for the agents store.
 *
 * omp reuses Pi's session format with three additions:
 *   1. A fixed-width, 256-byte `{"type":"title",…}\n` slot before the header,
 *      written by current omp builds. Legacy files start directly with the header.
 *      `header.title` in the session entry also carries the name (same value).
 *   2. `model_change` uses `model` instead of `modelId` and carries an optional
 *      `role` field. Only role==="default" (or absent) updates the session model.
 *   3. `{"type":"custom","customType":"session_exit",…}` is appended synchronously
 *      on disposal — a trailing one means the process is gone (→ dormant).
 *
 * Sessions dir: $PI_CODING_AGENT_SESSION_DIR, else
 *   `~/${PI_CONFIG_DIR || ".omp"}/agent/sessions`.
 *
 * Dedup: if the resolved omp dir equals the Pi adapter's dir (the user set
 * PI_CODING_AGENT_DIR pointing at their omp dir), this adapter returns [] so
 * sessions aren't listed twice.
 */

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
import { defaultPiSessionsDir } from "./pi";

export const OMP_STALE_AFTER_MS = 30 * 60 * 1000;

function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") || p.startsWith("~\\") ? join(homedir(), p.slice(2)) : p;
}

/**
 * Resolves the omp sessions directory.
 *
 * Priority:
 *  1. $PI_CODING_AGENT_SESSION_DIR (same env omp reuses from Pi)
 *  2. `~/${PI_CONFIG_DIR || ".omp"}/agent/sessions`
 */
export function defaultOmpSessionsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.PI_CODING_AGENT_SESSION_DIR) return expandHome(env.PI_CODING_AGENT_SESSION_DIR);
  const configDir = env.PI_CONFIG_DIR || ".omp";
  return join(expandHome("~"), configDir, "agent", "sessions");
}

export interface OmpParseResult {
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
  /** true if a session_exit was appended — process is definitely gone. */
  exited: boolean;
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
 * Single-pass parse of an omp session file. The title slot and session_exit
 * are omp-specific; every other entry shape is compatible with Pi's format.
 */
export function parseOmpSession(content: string): OmpParseResult {
  const out: OmpParseResult = { messageCount: 0, toolCount: 0, turnOpen: false, exited: false };
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e: any;
    try {
      e = JSON.parse(trimmed);
    } catch {
      continue;
    }
    switch (e?.type) {
      case "title":
        // 256-byte title slot before the header; overridden by header.title below.
        if (!out.name && typeof e.title === "string" && e.title) out.name = e.title;
        break;
      case "session":
        if (typeof e.id === "string") out.sessionId = e.id;
        if (typeof e.cwd === "string") out.cwd = e.cwd;
        // header.title wins over the title-slot name.
        if (typeof e.title === "string" && e.title) out.name = e.title;
        break;
      case "session_info":
        out.name = typeof e.name === "string" && e.name ? e.name : undefined;
        break;
      case "model_change":
        // omp uses `model` (Pi uses `modelId`). Role guard: only default/absent.
        if (typeof e.model === "string" && (!e.role || e.role === "default")) {
          out.model = e.model;
        }
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
      case "custom":
        // session_exit is flushed synchronously on disposal: process is gone.
        if (e.customType === "session_exit") {
          out.exited = true;
          out.turnOpen = false;
        }
        break;
    }
  }
  return out;
}

export function classifyOmpStatus(
  now: number,
  lastActivityMs: number,
  turnOpen: boolean,
  exited: boolean,
): AgentStatus {
  const age = now - lastActivityMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  if (exited || !turnOpen) return "dormant";
  return age > OMP_STALE_AFTER_MS ? "stale" : "live-busy";
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

/** `<timestamp>_<id>.jsonl` → id (16-char hex or UUID). */
function idFromFileName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.jsonl$/, "").split("_").pop() ?? base;
}

function firstLine(text: string | undefined): string | undefined {
  return text?.split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 60);
}

export function createOmpAdapter(
  sessionsDir = defaultOmpSessionsDir(),
  piSessionsDir = defaultPiSessionsDir(),
): AgentAdapter {
  const cache = new Map<string, { mtimeMs: number; size: number; parsed: OmpParseResult }>();

  function parseFile(f: SessionFile): OmpParseResult {
    const hit = cache.get(f.path);
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.parsed;
    let parsed: OmpParseResult;
    try {
      parsed = parseOmpSession(readFileSync(f.path, "utf-8"));
    } catch {
      parsed = { messageCount: 0, toolCount: 0, turnOpen: false, exited: false };
    }
    cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
    return parsed;
  }

  function discover(now: number): AgentSession[] {
    // Dedup: if omp shares the Pi sessions dir (via PI_CODING_AGENT_DIR), Pi covers it.
    if (sessionsDir === piSessionsDir) return [];
    if (!existsSync(sessionsDir)) return [];
    const files = listSessionFiles(sessionsDir);
    const sessions = files.map((f): AgentSession => {
      const p = parseFile(f);
      const sessionId = p.sessionId ?? idFromFileName(f.path);
      const cwd = p.cwd ?? "";
      const fallback = firstLine(p.firstUser);
      const id8 = sessionId.slice(0, 8);
      return {
        provider: "omp",
        sessionId,
        sourcePath: f.path,
        cwd,
        cwdShort: cwdShort(cwd),
        status: classifyOmpStatus(now, f.mtimeMs, p.turnOpen, p.exited),
        lastActivityMs: f.mtimeMs,
        customTitle: p.name,
        displayName: p.name ? p.name.slice(0, 60) : fallback ? `${fallback} · ${id8}` : id8,
        messageCount: p.messageCount,
        toolCount: p.toolCount,
        lastUser: p.lastUser,
        lastAssistant: p.lastAssistant,
        model: p.model,
        resumeCommand: `omp --resume ${sessionId}`,
        resumeArgv: ["omp", "--resume", sessionId],
      };
    });
    const live = new Set(files.map((f) => f.path));
    for (const path of cache.keys()) if (!live.has(path)) cache.delete(path);
    return sessions;
  }

  return {
    provider: "omp",
    watchPaths: () => [sessionsDir],
    discover,
  };
}
