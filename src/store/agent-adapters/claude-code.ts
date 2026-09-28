/**
 * Claude Code adapter for the agents store.
 *
 * Reads:
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl  — transcripts
 *   ~/.claude/sessions/<sessionId>.json          — live PID records
 *
 * Eager initial scan (1-2s for ~80 sessions) is acceptable startup cost.
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

const CLAUDE_HOME = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_HOME, "projects");
const SESSIONS_DIR = join(CLAUDE_HOME, "sessions");

/** Threshold: PID record older than this means the Claude process likely crashed. */
const LIVE_STALE_AFTER_MS = 5 * 60 * 1000;

export interface LivePidRecord {
  mtimeMs: number;
  /** "busy" | "idle" | undefined */
  status?: string;
  pid?: number;
  version?: string;
  cwd?: string;
}

/**
 * Reverse Claude Code's path-to-slug encoding (lossy on case).
 *
 * Claude Code encodes the cwd by replacing every `:`, `\` and `/` with `-`.
 *
 *   Windows  "C:\Users\foo"   → "C--Users-foo"
 *   POSIX    "/home/foo"      → "-home-foo"
 *
 * We can recognize a Windows-shaped slug by the `<letter>--` prefix
 * (drive letter followed by colon → two leading dashes). Anything else
 * is assumed POSIX. This works regardless of `process.platform`, so
 * decoding remote-shape paths (sessions originated on a different OS)
 * still produces something sensible.
 */
export function cwdFromSlug(slug: string): string {
  // Windows drive letter shape: "C--Users-foo" → "C:\Users\foo".
  if (slug.length >= 3 && /^[A-Za-z]--/.test(slug)) {
    return slug[0] + ":\\" + slug.slice(3).replaceAll("-", "\\");
  }
  // POSIX shape: "-home-foo" → "/home/foo".
  if (slug.startsWith("-")) {
    return "/" + slug.slice(1).replaceAll("-", "/");
  }
  // Fallback: bare directory name. Pick the separator from the host OS so
  // the result at least concatenates correctly when the user copies it.
  const sep = process.platform === "win32" ? "\\" : "/";
  return slug.replaceAll("-", sep);
}

/** Returns true if the OS confirms `pid` is still running. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function classifyStatus(
  now: number,
  jsonlMtimeMs: number,
  live: LivePidRecord | undefined,
  checkPid: (pid: number) => boolean = isPidAlive,
): AgentStatus {
  if (live) {
    if (now - live.mtimeMs > LIVE_STALE_AFTER_MS) {
      // Claude Code doesn't rewrite the PID record during a long turn, so a
      // stale-by-age record doesn't mean the process died. Check liveness
      // directly when we have the pid — only mark stale when the process is
      // actually gone or the pid is unknown.
      if (live.pid != null && checkPid(live.pid)) {
        return live.status === "busy" ? "live-busy" : "live-idle";
      }
      return "stale";
    }
    return live.status === "busy" ? "live-busy" : "live-idle";
  }
  const age = now - jsonlMtimeMs;
  if (age > DORMANT_AFTER_MS) return "archived";
  return "dormant";
}

export interface TranscriptParseResult {
  customTitle?: string;
  aiTitle?: string;
  /**
   * First user message that looks like a real human prompt — skill loaders,
   * system tags, and bare slash-command invocations are filtered. Used as
   * the displayName fallback when there is no custom/ai title.
   */
  firstHumanUser?: string;
  lastUser?: string;
  lastAssistant?: string;
  messageCount: number;
  toolCount: number;
  gitBranch?: string;
  /** Model of the latest real assistant turn. */
  model?: string;
}

/**
 * Heuristic: is this user "message" actually a skill/system bootstrap that
 * Claude Code injected on session start? Used to skip these when picking
 * a fallback displayName — otherwise N sessions opened by the same skill
 * all look identical in the list.
 */
function looksSyntheticUser(text: string): boolean {
  const t = text.trimStart();
  if (!t) return true;
  // Skill bootstrap: "Base directory for this skill: ..."
  if (t.startsWith("Base directory for this skill")) return true;
  // System-injected tags: <command-name>, <task-notification>, <system-reminder>, <local-command-stdout>
  if (/^<[a-z][a-z0-9-]*>/i.test(t)) return true;
  // Bare slash-command invocation (the literal "/morning", "/log", etc.)
  if (/^\/[a-z][a-z0-9-]*\s*$/i.test(t)) return true;
  return false;
}

/**
 * Lightweight pass over a jsonl transcript. Defensive: malformed lines
 * are skipped silently because the format is internal to Claude Code
 * and may drift between versions.
 */
export function parseTranscript(content: string): TranscriptParseResult {
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let firstHumanUser: string | undefined;
  let lastUser: string | undefined;
  let lastAssistant: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let messageCount = 0;
  let toolCount = 0;

  const recordUserText = (text: string) => {
    lastUser = text;
    if (firstHumanUser === undefined && !looksSyntheticUser(text)) {
      firstHumanUser = text;
    }
  };

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
        recordUserText(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            part.type === "text" &&
            typeof part.text === "string"
          ) {
            recordUserText(part.text);
          }
        }
      }
    } else if (role === "assistant") {
      messageCount++;
      if (typeof msg.model === "string" && !msg.model.startsWith("<")) model = msg.model;
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
    firstHumanUser,
    lastUser,
    lastAssistant,
    messageCount,
    toolCount,
    gitBranch,
    model,
  };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Last successfully parsed record per PID file. Claude Code rewrites these
 * files in place, so a read can land mid-write; reusing the previous record
 * keeps the session's live state from flickering for one scan.
 */
const lastGoodPid = new Map<string, { sessionId: string; record: LivePidRecord }>();

function discoverLivePids(): Map<string, LivePidRecord> {
  const out = new Map<string, LivePidRecord>();
  if (!existsSync(SESSIONS_DIR)) return out;
  let entries: string[];
  try {
    entries = readdirSync(SESSIONS_DIR);
  } catch {
    return out;
  }
  const seen = new Set<string>();
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    const path = join(SESSIONS_DIR, f);
    seen.add(path);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const sid = raw.sessionId;
      if (!sid) continue;
      const stat = statSync(path);
      const record: LivePidRecord = {
        mtimeMs: stat.mtimeMs,
        status: raw.status?.toLowerCase(),
        pid: raw.pid,
        version: raw.version,
        cwd: raw.cwd,
      };
      lastGoodPid.set(path, { sessionId: sid, record });
      out.set(sid, record);
    } catch {
      // Mid-write (or vanished): fall back to the last good read of this file.
      const prev = lastGoodPid.get(path);
      if (prev) out.set(prev.sessionId, prev.record);
    }
  }
  for (const path of lastGoodPid.keys()) if (!seen.has(path)) lastGoodPid.delete(path);
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
  const hasRealTitle = Boolean(parsed.customTitle || parsed.aiTitle);
  const fallbackText =
    parsed.firstHumanUser?.split("\n").find((l) => l.trim().length > 0)?.slice(0, 60) ??
    parsed.lastUser?.split("\n").find((l) => l.trim().length > 0)?.slice(0, 60);
  const uuid8 = jsonl.sessionId.slice(0, 8);
  // When no human-authored title is available, suffix the uuid8 so visually
  // identical fallback titles (e.g. many sessions started by the same /skill)
  // still produce distinct rows.
  const displayName = hasRealTitle
    ? (parsed.customTitle ?? parsed.aiTitle)!.slice(0, 60)
    : fallbackText
      ? `${fallbackText} · ${uuid8}`
      : uuid8;
  return {
    provider: "claude-code",
    sessionId: jsonl.sessionId,
    sourcePath: jsonl.path,
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
    model: parsed.model,
    resumeCommand: `claude --resume ${jsonl.sessionId}`,
    resumeArgv: ["claude", "--resume", jsonl.sessionId],
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  provider: "claude-code",
  watchPaths: () => [PROJECTS_DIR, SESSIONS_DIR],
  discover(now) {
    const live = discoverLivePids();
    return discoverJsonlFiles().map((j) =>
      buildSession(j, live.get(j.sessionId), now),
    );
  },
};
