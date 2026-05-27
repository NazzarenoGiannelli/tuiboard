# Phase 5.2 — Agent View MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AgentsBar / AgentsOnly stubs with a working agent view that discovers Claude Code sessions from `~/.claude/projects/**/*.jsonl`, classifies their status (live/idle/dormant/archived), and renders them as a reactive compact strip (dashboard) or fullscreen list (`--view=agents`).

**Architecture:** New `src/store/agents.ts` store with its own chokidar watcher for `~/.claude/projects/` and `~/.claude/sessions/`. Eager transcript parse on first discovery (~50–100 files, ~1s) then incremental re-parse only on file-change events. Solid `createMemo` keeps UI reactive without polling.

**Tech Stack:** Bun · TypeScript · SolidJS · chokidar (already a dep) · OpenTUI 0.2.15.

**Out of scope for this phase** (deferred to 5.2.x): rename action (write `custom-title` to jsonl), resume action (wezterm spawn), cross-machine session parsing from `Sessions.md`, user-archive flag (per-machine state.json).

---

## File Structure

**Created:**

| Path | Responsibility |
|------|----------------|
| `src/store/agents.ts` | Discovery, status classification, transcript parsing, reactive sessions list, chokidar watcher. |
| `src/store/agents.test.ts` | Unit tests for pure helpers (slug decoding, status classification, age formatting). |
| `src/ui/AgentRow.tsx` | Single-line render of an `AgentSession` (status dot + name + machine + cwd + age). Used by both AgentsBar and AgentsOnly. |

**Modified:**

| Path | Reason |
|------|--------|
| `src/ui/AgentsBar.tsx` | Replace stub with compact strip rendering top N sessions. |
| `src/views/AgentsOnly.tsx` | Replace stub with fullscreen scrollable list. |
| `src/store/index.ts` | Expose `agentsStore` on the TuiStore so views/components can access it. |
| `src/input/handleKey.ts` | Add `agents` zone navigation: j/k cursor, Enter opens detail modal. |
| `src/store/index.ts` | Add new `ModalKind` variant `{ kind: "agent-detail"; sessionId: string }`. |
| `src/ui/Modal.tsx` | Render the new `agent-detail` modal kind. |
| `src/app.tsx` | Dispose `agentsStore` on SIGINT/SIGTERM alongside the kanban store. |

---

## Task 1: AgentSession data model + pure helpers

**Files:** Create `src/store/agents.ts` (types + helpers only, no I/O), `src/store/agents.test.ts`.

- [ ] **Step 1: Write failing tests**

Create `src/store/agents.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import {
  classifyStatus,
  cwdFromSlug,
  cwdShort,
  formatAge,
  type LivePidRecord,
} from "./agents";

describe("cwdFromSlug", () => {
  it("decodes a Windows drive-letter slug", () => {
    expect(cwdFromSlug("C--Users-nazza-Documents-Repos-Blits")).toBe(
      "C:\\Users\\nazza\\Documents\\Repos\\Blits",
    );
  });

  it("handles a simple path without drive letter", () => {
    expect(cwdFromSlug("home-nazz-projects")).toBe("home\\nazz\\projects");
  });
});

describe("cwdShort", () => {
  it("returns the last 3 parts prefixed with ellipsis when path is long", () => {
    expect(cwdShort("C:\\Users\\nazza\\Documents\\Repos\\Blits")).toBe(
      "…Documents\\Repos\\Blits",
    );
  });

  it("returns the full path when 3 or fewer parts", () => {
    expect(cwdShort("C:\\Users\\nazza")).toBe("C:\\Users\\nazza");
  });
});

describe("classifyStatus", () => {
  const now = 1_700_000_000_000; // fixed instant
  const minutes = (n: number) => n * 60_000;
  const days = (n: number) => n * 86_400_000;

  it("returns live-busy when PID record fresh AND status busy", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("live-busy");
  });

  it("returns live-idle when PID record fresh AND status idle/missing", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1) };
    expect(classifyStatus(now, now, live)).toBe("live-idle");
  });

  it("returns stale-pid when PID record older than 5min", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(10), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("stale-pid");
  });

  it("returns dormant when no PID and jsonl mtime within 7 days", () => {
    expect(classifyStatus(now, now - days(2), undefined)).toBe("dormant");
  });

  it("returns archived when jsonl mtime older than 7 days and no PID", () => {
    expect(classifyStatus(now, now - days(10), undefined)).toBe("archived");
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000;

  it("formats seconds", () => {
    expect(formatAge(now - 30_000, now)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
  });

  it("formats hours", () => {
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("formats days", () => {
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("returns dash for zero", () => {
    expect(formatAge(0, now)).toBe("—");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store/agents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers in agents.ts (types + pure functions only)**

Create `src/store/agents.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/store/agents.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/agents.ts src/store/agents.test.ts
git commit -m "feat(agents): data model + pure helpers

Slug decoding, cwd shortening, status classification thresholds
(5min PID staleness, 7d dormancy), age formatting.

All helpers are pure and unit-tested. Discovery + watcher come
in the next commit."
```

---

## Task 2: Transcript parser

**Files:** Append to `src/store/agents.ts`, append tests to `src/store/agents.test.ts`.

- [ ] **Step 1: Write failing test**

Append to `src/store/agents.test.ts`:

```typescript
import { parseTranscript } from "./agents";

describe("parseTranscript", () => {
  const SAMPLE_JSONL = [
    JSON.stringify({ type: "user", message: { role: "user", content: "Ciao" }, gitBranch: "main" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello" }, { type: "tool_use", name: "Read" }] } }),
    JSON.stringify({ type: "custom-title", customTitle: "Refactor store" }),
  ].join("\n");

  it("extracts title, last messages, counts, branch", () => {
    const result = parseTranscript(SAMPLE_JSONL);
    expect(result.customTitle).toBe("Refactor store");
    expect(result.lastUser).toBe("Ciao");
    expect(result.lastAssistant).toBe("Hello");
    expect(result.messageCount).toBe(2);
    expect(result.toolCount).toBe(1);
    expect(result.gitBranch).toBe("main");
  });

  it("tolerates malformed lines", () => {
    const broken = SAMPLE_JSONL + "\n{this is not json\n";
    const result = parseTranscript(broken);
    expect(result.lastUser).toBe("Ciao"); // still got the good lines
  });

  it("handles empty input", () => {
    const result = parseTranscript("");
    expect(result.messageCount).toBe(0);
    expect(result.customTitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `bun test src/store/agents.test.ts`
Expected: FAIL — `parseTranscript` not exported.

- [ ] **Step 3: Implement parseTranscript**

Append to `src/store/agents.ts`:

```typescript
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
          if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
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

  return { customTitle, aiTitle, lastUser, lastAssistant, messageCount, toolCount, gitBranch };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test src/store/agents.test.ts`
Expected: 14 tests pass total (3 new).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/store/agents.ts src/store/agents.test.ts
git commit -m "feat(agents): transcript parser

Lightweight pass over jsonl: extracts title (custom/ai), last
user + assistant text, message + tool counts, git branch.
Defensive on malformed lines (Claude Code internal format
may drift between versions)."
```

---

## Task 3: Discovery + reactive store

**Files:** Append to `src/store/agents.ts`.

- [ ] **Step 1: Add discovery + Solid store**

Append to `src/store/agents.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chokidar from "chokidar";
import { createSignal } from "solid-js";

const CLAUDE_HOME = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_HOME, "projects");
const SESSIONS_DIR = join(CLAUDE_HOME, "sessions");

function discoverLivePids(): Map<string, LivePidRecord> {
  const out = new Map<string, LivePidRecord>();
  if (!existsSync(SESSIONS_DIR)) return out;
  for (const f of readdirSync(SESSIONS_DIR)) {
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

function discoverJsonlFiles(): Array<{ slug: string; sessionId: string; path: string; mtimeMs: number }> {
  const out: Array<{ slug: string; sessionId: string; path: string; mtimeMs: number }> = [];
  if (!existsSync(PROJECTS_DIR)) return out;
  for (const slug of readdirSync(PROJECTS_DIR)) {
    const slugDir = join(PROJECTS_DIR, slug);
    let slugStat;
    try {
      slugStat = statSync(slugDir);
    } catch {
      continue;
    }
    if (!slugStat.isDirectory()) continue;
    for (const f of readdirSync(slugDir)) {
      if (!f.endsWith(".jsonl")) continue;
      // Skip subagent transcripts — they're addressed by parent session.
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
  jsonl: { slug: string; sessionId: string; path: string; mtimeMs: number },
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
    const built = jsonlFiles.map((j) => buildSession(j, live.get(j.sessionId), now));
    setSessions(sortSessions(built));
  }

  refresh();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 200);
  };

  const watcher = chokidar.watch(
    [PROJECTS_DIR, SESSIONS_DIR],
    {
      ignoreInitial: true,
      depth: 3,
      // Use polling fallback so Windows file-system events under .claude
      // (which sometimes don't propagate via FSEvents-like APIs) still fire.
      usePolling: false,
    },
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
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke verify the store works in isolation**

Create a one-shot script `src/scripts/agents-check.ts`:

```typescript
import { createAgentsStore } from "~/store/agents";

const store = createAgentsStore();
const live = store.sessions().filter((s) => s.status === "live-busy" || s.status === "live-idle");
console.log(`Found ${store.sessions().length} sessions, ${live.length} live`);
for (const s of store.sessions().slice(0, 10)) {
  console.log(`  ${s.status.padEnd(10)}  ${s.displayName.padEnd(40)}  ${s.cwdShort}`);
}
await store.dispose();
```

Run: `bun run src/scripts/agents-check.ts`
Expected: prints session count + first 10 with status, name, cwd. Should match what you see in your filesystem.

- [ ] **Step 4: Add to package.json scripts**

In `package.json`, add to `scripts`:
```json
"agents:check": "bun run src/scripts/agents-check.ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/store/agents.ts src/scripts/agents-check.ts package.json
git commit -m "feat(agents): reactive discovery store

createAgentsStore() returns Solid signal-backed sessions(), with
chokidar watching ~/.claude/projects and ~/.claude/sessions.
Debounced refresh (200ms) on any change.

src/scripts/agents-check.ts provides a quick CLI to verify the
store sees what you expect on this machine."
```

---

## Task 4: Wire agentsStore into the main TuiStore

**Files:** Modify `src/store/index.ts`, modify `src/app.tsx`.

- [ ] **Step 1: Expose agentsStore on TuiStore**

Edit `src/store/index.ts`:

Add import at the top:
```typescript
import { createAgentsStore, type AgentsStore } from "./agents";
```

Inside `createTuiStore`, after `const watcher = createBoardWatcher(...)`, add:
```typescript
const agentsStore = createAgentsStore();
```

In the `dispose` function, await `agentsStore.dispose()` alongside the existing watcher disposal.

In the returned object, add `agents: agentsStore` so consumers can read `store.agents.sessions()`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke verify the kanban still launches with agentsStore in tow**

Run: `bun run dev`
Expected: same kanban as before. No crash on bootstrap. Quit with `q`.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(store): hang agentsStore off the main TuiStore

Lifecycle parity: kanban store and agents store share the same
dispose() boundary, so SIGINT cleans up both watchers.
Consumers reach the sessions list via store.agents.sessions()."
```

---

## Task 5: AgentRow component + AgentsBar real implementation

**Files:** Create `src/ui/AgentRow.tsx`, rewrite `src/ui/AgentsBar.tsx`.

- [ ] **Step 1: Create AgentRow component**

```tsx
/**
 * Single-line render of an AgentSession. Used in both AgentsBar (compact
 * dashboard strip) and AgentsOnly (fullscreen list).
 *
 * Layout: status-dot · name · machine · cwd_short · age
 */

import { Show, createMemo } from "solid-js";

import { T } from "~/ui/glyphs";
import { formatAge, type AgentSession, type AgentStatus } from "~/store/agents";

const STATUS_COLOR: Record<AgentStatus, string> = {
  "live-busy": T.today,     // bright accent for actively-running
  "live-idle": T.scheduled, // warm but quieter
  "stale-pid": T.bannerWarn,
  "dormant":   T.textDim,
  "archived":  T.textDone,
};

const STATUS_GLYPH: Record<AgentStatus, string> = {
  "live-busy": "●",
  "live-idle": "○",
  "stale-pid": "△",
  "dormant":   "·",
  "archived":  "·",
};

interface AgentRowProps {
  session: AgentSession;
  cursor?: boolean;
  /** Maximum chars for displayName before truncation. Default 40. */
  nameMaxChars?: number;
  onClick?: () => void;
}

export function AgentRow(props: AgentRowProps) {
  const ageStr = createMemo(() => formatAge(props.session.lastActivityMs, Date.now()));
  const nameMax = () => props.nameMaxChars ?? 40;
  const displayName = createMemo(() => {
    const n = props.session.displayName;
    return n.length > nameMax() ? n.slice(0, nameMax() - 1) + "…" : n;
  });

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: props.cursor ? T.cardBgCursor : undefined,
      }}
      onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
    >
      <text style={{ flexGrow: 1, flexShrink: 1 }} truncate wrapMode="none">
        <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
          {props.cursor ? "▶ " : "  "}
        </span>
        <span style={{ fg: STATUS_COLOR[props.session.status] }}>
          {STATUS_GLYPH[props.session.status]}{" "}
        </span>
        <span style={{ fg: T.text }}>
          {displayName()}
        </span>
        <Show when={props.session.gitBranch}>
          <span style={{ fg: T.textDim }}>{" "}{props.session.gitBranch}</span>
        </Show>
        <span style={{ fg: T.textDim }}>{"  "}{props.session.cwdShort}</span>
      </text>
      <text style={{ flexShrink: 0 }} wrapMode="none">
        <span style={{ fg: T.textDim }}>{" "}{ageStr()}</span>
      </text>
    </box>
  );
}
```

- [ ] **Step 2: Rewrite AgentsBar.tsx as compact real strip**

Replace the entire contents of `src/ui/AgentsBar.tsx`:

```tsx
/**
 * Compact agent status strip for the dashboard. Renders the top N
 * sessions (live + idle first, then dormant) inside a bordered box.
 *
 * The border color reflects activeZone === "agents" so the cursor
 * ring is visible. Clicking a row sets activeZone + agent cursor.
 */

import { For, Show, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface AgentsBarProps {
  store: TuiStore;
  /** Fixed row height in the dashboard layout. */
  height?: number;
  /** Max sessions to show in the compact strip. */
  maxVisible?: number;
}

export function AgentsBar(props: AgentsBarProps) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;

  const visibleSessions = createMemo(() => {
    const all = props.store.agents.sessions();
    // Compact strip hides archived; that's the fullscreen view's job.
    const shown = all.filter((s) => s.status !== "archived");
    return shown.slice(0, props.maxVisible ?? 6);
  });

  return (
    <box
      style={{
        flexDirection: "column",
        height: props.height,
        flexGrow: props.height ? 0 : 1,
        marginTop: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Agents (live) · ${visibleSessions().length} ├`}
      titleAlignment="left"
    >
      <Show
        when={visibleSessions().length > 0}
        fallback={
          <text>
            <span style={{ fg: T.textDim }}>No active sessions.</span>
          </text>
        }
      >
        <For each={visibleSessions()}>
          {(session, i) => (
            <AgentRow
              session={session}
              cursor={isActive() && i() === agentRow()}
              nameMaxChars={32}
              onClick={() => {
                props.store.setActiveZone("agents");
                props.store.setCursor(0, i());
              }}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Smoke verify in dashboard mode**

Run: `bun run dev`
Expected: the Agents zone shows real session rows (yours: ~80 sessions on this machine, so top 6 visible). Status glyph + name + cwd + age. Click a row → cursor jumps there. Shift+Tab cycles into agents zone → border highlights.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AgentRow.tsx src/ui/AgentsBar.tsx
git commit -m "feat(ui): AgentRow + AgentsBar real implementation

Compact one-line-per-session render with status dot, name, git
branch, cwd, age. Click-to-select. Top 6 non-archived sessions
visible in the dashboard strip; full list lives in
--view=agents (next task)."
```

---

## Task 6: AgentsOnly fullscreen view

**Files:** Rewrite `src/views/AgentsOnly.tsx`.

- [ ] **Step 1: Rewrite AgentsOnly.tsx**

```tsx
/**
 * Fullscreen list of every local Claude Code session.
 * `tuiboard --view=agents`. Shows ALL sessions (including archived),
 * scrollable, cursor-navigable.
 */

import { For, Show, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { ModalLayer } from "~/ui/Modal";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

export function AgentsOnly(props: { store: TuiStore }) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;
  const sessions = createMemo(() => props.store.agents.sessions());

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          border: true,
          borderStyle: "rounded",
          borderColor: isActive() ? T.borderActive : T.border,
          paddingLeft: 1,
          paddingRight: 1,
        }}
        title={`┤ Agents · ${sessions().length} sessions ├`}
        titleAlignment="left"
      >
        <Show
          when={sessions().length > 0}
          fallback={
            <text>
              <span style={{ fg: T.textDim }}>No sessions found in ~/.claude/projects.</span>
            </text>
          }
        >
          <scrollbox
            style={{
              width: "100%",
              flexGrow: 1,
              rootOptions: {},
              contentOptions: {},
              scrollbarOptions: { visible: false },
            }}
          >
            <For each={sessions()}>
              {(session, i) => (
                <AgentRow
                  session={session}
                  cursor={isActive() && i() === agentRow()}
                  nameMaxChars={80}
                  onClick={() => {
                    props.store.setActiveZone("agents");
                    props.store.setCursor(0, i());
                  }}
                />
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
      <ModalLayer store={props.store} />
    </box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke verify**

Run: `bun run dev -- --view=agents`
Expected: fullscreen scrollable list of every session (including archived). Cursor navigable with j/k.

- [ ] **Step 4: Commit**

```bash
git add src/views/AgentsOnly.tsx
git commit -m "feat(views): AgentsOnly fullscreen list

Replaces the placeholder with a scrollable real session list.
Shows all sessions including archived (the compact dashboard
strip hides those)."
```

---

## Task 7: Agents zone navigation + detail modal

**Files:** Modify `src/store/index.ts` (add ModalKind variant), `src/input/handleKey.ts` (add agents zone branch), `src/ui/Modal.tsx` (render detail modal).

- [ ] **Step 1: Add `agent-detail` ModalKind**

In `src/store/index.ts`, in the `ModalKind` union, add:
```typescript
| { kind: "agent-detail"; sessionId: string }
```

- [ ] **Step 2: Add agents zone navigation in handleKey**

Edit `src/input/handleKey.ts`. After the `if (ui.activeZone === "virtual")` block, add a new branch:

```typescript
// Agents zone navigation
if (ui.activeZone === "agents") {
  const sessions = store.agents.sessions();
  if (key.name === "j" || key.name === "down") {
    store.setCursor(0, Math.min(sessions.length - 1, ui.row + 1));
  } else if (key.name === "k" || key.name === "up") {
    store.setCursor(0, Math.max(0, ui.row - 1));
  } else if (key.name === "enter" || key.name === "return" || key.name === "o") {
    const target = sessions[ui.row];
    if (target) {
      setTimeout(
        () => store.openModal({ kind: "agent-detail", sessionId: target.sessionId }),
        0,
      );
    }
  } else if (key.name === "h" || key.name === "left") {
    // Bounce back to board
    store.setActiveZone("board");
  }
  return;
}
```

This branch must come BEFORE the `if (!board) return` line so it isn't swallowed by missing-board guard logic when only `agents` zone is visible.

- [ ] **Step 3: Render the agent-detail modal**

In `src/ui/Modal.tsx`, add a new branch in the ModalLayer/switch on `modal.kind`. Locate where existing modal kinds are rendered (e.g. the `detail` kind for tasks) and add a parallel structure for `agent-detail`:

```tsx
<Show when={modal()?.kind === "agent-detail"}>
  {(() => {
    const m = modal() as Extract<ModalKind, { kind: "agent-detail" }>;
    const session = props.store.agents.sessions().find((s) => s.sessionId === m.sessionId);
    return (
      <ModalBox title="Agent session detail">
        <Show when={session} fallback={<text><span>Session no longer present.</span></text>}>
          {(s) => (
            <box style={{ flexDirection: "column" }}>
              <text wrapMode="wrap">
                <span style={{ fg: T.textDim }}>session  </span>
                <span style={{ fg: T.accent }}>{s().sessionId}</span>
              </text>
              <text wrapMode="wrap">
                <span style={{ fg: T.textDim }}>status   </span>
                <span>{s().status}</span>
              </text>
              <text wrapMode="wrap">
                <span style={{ fg: T.textDim }}>name     </span>
                <span style={{ fg: T.text }}>{s().displayName}</span>
              </text>
              <text wrapMode="wrap">
                <span style={{ fg: T.textDim }}>cwd      </span>
                <span>{s().cwd}</span>
              </text>
              <Show when={s().gitBranch}>
                <text wrapMode="wrap">
                  <span style={{ fg: T.textDim }}>branch   </span>
                  <span style={{ fg: T.warm }}>{s().gitBranch}</span>
                </text>
              </Show>
              <text wrapMode="wrap">
                <span style={{ fg: T.textDim }}>messages </span>
                <span>{s().messageCount} ({s().toolCount} tool uses)</span>
              </text>
              <Show when={s().lastUser}>
                <box style={{ marginTop: 1 }}>
                  <text wrapMode="wrap">
                    <span style={{ fg: T.textDim }}>last user prompt:</span>
                  </text>
                </box>
                <text wrapMode="wrap">
                  <span style={{ fg: T.text }}>{(s().lastUser ?? "").slice(0, 400)}</span>
                </text>
              </Show>
              <Show when={s().lastAssistant}>
                <box style={{ marginTop: 1 }}>
                  <text wrapMode="wrap">
                    <span style={{ fg: T.textDim }}>last assistant reply:</span>
                  </text>
                </box>
                <text wrapMode="wrap">
                  <span style={{ fg: T.text }}>{(s().lastAssistant ?? "").slice(0, 400)}</span>
                </text>
              </Show>
              <box style={{ marginTop: 1 }}>
                <text wrapMode="wrap">
                  <span style={{ fg: T.textDim }}>resume command (copy by hand for now):</span>
                </text>
              </box>
              <text wrapMode="wrap">
                <span style={{ fg: T.scheduled }}>claude --resume {s().sessionId}</span>
              </text>
            </box>
          )}
        </Show>
      </ModalBox>
    );
  })()}
</Show>
```

Note: if `ModalBox` is not the exact name in the existing `Modal.tsx`, use whatever wrapper the existing detail kind uses for tasks.

- [ ] **Step 4: Handle `o`/`Esc` in modal dispatcher for agent-detail**

In `src/input/handleKey.ts`, in the modal dispatcher block, extend the existing detail-close branch:

```typescript
if ((ui.modal.kind === "help" || ui.modal.kind === "detail" || ui.modal.kind === "agent-detail") &&
    (key.name === "?" || key.sequence === "?" || key.name === "o")) {
  store.closeModal();
  return;
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Smoke verify**

Run: `bun run dev`
- Shift+Tab into agents zone, j/k moves cursor, Enter opens detail modal with session info, Esc/o closes.
- Same in `--view=agents`.

- [ ] **Step 7: Commit**

```bash
git add src/store/index.ts src/input/handleKey.ts src/ui/Modal.tsx
git commit -m "feat: agents zone navigation + detail modal

j/k moves cursor in agents zone; Enter/o opens an agent-detail
modal showing session id, status, cwd, branch, message count,
last user prompt, last assistant reply, and the resume command
string. Esc/o closes."
```

---

## Task 8: Final smoke verification

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: all tests pass (existing 18 + new ~14 agents tests = ~32).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Roundtrip check (kanban regression guard)**

Run: `bun run roundtrip:check`
Expected: all 3 boards OK.

- [ ] **Step 4: Manual UX checks**

`bun run dev` (dashboard):
- Agents strip shows real sessions, status dots colored, names truncated nicely.
- Sessions sort live first.
- Click + Shift+Tab navigation works.
- Enter opens detail modal.

`bun run dev -- --view=agents`:
- Fullscreen list, all sessions visible, scrollable.

Open and close a Claude Code session in another window — within ~2-3 seconds the AgentsBar should reflect the change (chokidar trigger).

- [ ] **Step 5: Phase 5.2 checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Day 5.2 agent view MVP complete

✓ store/agents.ts: discovery + reactive sessions + chokidar watcher
✓ ui/AgentRow: single-line render shared between bar + fullscreen
✓ ui/AgentsBar: compact dashboard strip, top 6 live-first
✓ views/AgentsOnly: fullscreen scrollable list
✓ Agents zone: j/k navigation + Enter detail modal
✓ ModalKind: agent-detail variant + Modal.tsx render
✓ Tests: ~14 new pure-helper + parser tests
✓ Deferred to 5.2.x: rename (custom-title write), resume (wezterm spawn),
   Sessions.md cross-machine parse, user-archive flag"
```

---

## Self-Review

**Spec coverage** (vs §7.3 of design doc):
- Compact list, 1 row per session ✓
- Status dot color: green/amber/gray ✓ (via STATUS_COLOR)
- Sorted live first ✓
- Scrollable if >visible ✓ (in AgentsOnly; bar caps at 6)
- Enter opens detail modal ✓
- Resume: shown as command string in detail (deferred shell-out per plan) ✓

**Placeholder scan:** none.

**Type consistency:** `AgentSession`, `AgentStatus`, `LivePidRecord`, `AgentsStore`, `createAgentsStore` used consistently.

**Stale references:** ModalBox name in Task 7 step 3 — must match what's already in `Modal.tsx`. If different, adjust during execution.
