/**
 * Invented agent sessions for the pictures: the four harnesses tuiboard reads (Claude Code,
 * Codex, OpenCode, Pi) working on the demo team's made-up product.
 *
 * The real sessions on a machine carry client names, people and unreleased work, so the pictures
 * never read them: capture.tsx swaps this adapter in for the real ones. Nothing here touches
 * disk. Times are relative to `now`, so the ages on screen are always the same.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentAdapter, AgentProvider, AgentSession, AgentStatus } from "~/store/agents";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Spec {
  provider: AgentProvider;
  status: AgentStatus;
  name: string;
  /** How long ago the last activity was. */
  ago: number;
  model: string;
  branch?: string;
  /** Path under the demo "home", as shown (`~/code/nimbus`). */
  dir: string;
  messages: number;
  tools: number;
  lastUser?: string;
  lastAssistant?: string;
}

const SPECS: Spec[] = [
  { provider: "claude-code", status: "live-busy", name: "Migrate billing to the new provider", ago: 20_000, model: "claude-opus-5", branch: "feat/billing-migration", dir: "code/nimbus", messages: 214, tools: 96, lastUser: "Run the webhook replay against staging.", lastAssistant: "Replaying 40 events…" },
  { provider: "codex", status: "live-blocked", name: "Approve the usage-limits schema change", ago: 2 * MIN, model: "gpt-5-codex", branch: "feat/usage-limits", dir: "code/nimbus", messages: 61, tools: 27, lastUser: "Add a per-seat limit column.", lastAssistant: "Needs your OK to run the migration." },
  { provider: "opencode", status: "live-busy", name: "Draft the 0.9 release notes", ago: 45_000, model: "claude-sonnet-5-5", branch: "release/0.9", dir: "code/nimbus", messages: 38, tools: 12, lastUser: "Keep it short, lead with the dashboard.", lastAssistant: "Drafting the highlights section." },
  { provider: "claude-code", status: "live-done", name: "Fix the typo in the onboarding email", ago: 6 * MIN, model: "claude-sonnet-5-5", branch: "fix/onboarding-email", dir: "code/nimbus", messages: 18, tools: 9, lastUser: "Ship it to staging.", lastAssistant: "Done: the fix is on the branch." },
  { provider: "pi", status: "live-idle", name: "Sketch the landing page hero", ago: 14 * MIN, model: "claude-haiku-4-5", dir: "code/side-project", messages: 25, tools: 6, lastUser: "Try a shorter headline.", lastAssistant: "Three options are in the notes." },
  { provider: "claude-code", status: "live-idle", name: "Refactor the usage dashboard queries", ago: 31 * MIN, model: "claude-opus-5", branch: "refactor/usage-queries", dir: "code/nimbus", messages: 142, tools: 71, lastUser: "Good. Now the tests.", lastAssistant: "All 38 tests pass." },
  { provider: "codex", status: "dormant", name: "Port the prototype to Bun", ago: 2 * DAY, model: "gpt-5-codex", branch: "port/bun", dir: "code/side-project", messages: 77, tools: 40, lastUser: "Swap the test runner.", lastAssistant: "Runner swapped, 12 files touched." },
  { provider: "opencode", status: "dormant", name: "Translate the docs into Italian", ago: 4 * DAY, model: "claude-sonnet-5-5", dir: "code/nimbus-docs", messages: 52, tools: 18, lastUser: "Keep the code blocks as they are.", lastAssistant: "Chapters 1 to 4 are done." },
  { provider: "pi", status: "archived", name: "Try the new charting library", ago: 9 * DAY, model: "claude-haiku-4-5", dir: "code/side-project", messages: 14, tools: 5 },
  { provider: "claude-code", status: "archived", name: "Publish the changelog", ago: 11 * DAY, model: "claude-sonnet-5-5", branch: "docs/changelog", dir: "code/nimbus", messages: 29, tools: 14 },
];

const RESUME: Record<AgentProvider, (id: string) => string[]> = {
  "claude-code": (id) => ["claude", "--resume", id],
  codex: (id) => ["codex", "resume", id],
  opencode: (id) => ["opencode", "--session", id],
  pi: (id) => ["pi", "--session", id],
};

export function createDemoAgentAdapter(now: number): AgentAdapter {
  const sessions = (): AgentSession[] =>
    SPECS.map((s, i) => {
      const id = `demo-${String(i + 1).padStart(2, "0")}`;
      const argv = RESUME[s.provider](id);
      // Under $HOME, so a card shows it as ~\code\nimbus and never the real user name.
      const cwd = join(homedir(), ...s.dir.split("/"));
      return {
        provider: s.provider,
        sessionId: id,
        sourcePath: "",
        cwd,
        cwdShort: `~/${s.dir}`,
        status: s.status,
        lastActivityMs: now - s.ago,
        displayName: s.name,
        messageCount: s.messages,
        toolCount: s.tools,
        lastUser: s.lastUser,
        lastAssistant: s.lastAssistant,
        gitBranch: s.branch,
        model: s.model,
        resumeCommand: argv.join(" "),
        resumeArgv: argv,
      };
    });
  return { provider: "claude-code", watchPaths: () => [], discover: sessions };
}
