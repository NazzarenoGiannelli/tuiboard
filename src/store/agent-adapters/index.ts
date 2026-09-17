/**
 * Every agent CLI the Agents zone knows how to read. Order doesn't matter —
 * the store sorts the merged list by status and recency.
 */

import type { AgentAdapter } from "~/store/agents";
import { claudeCodeAdapter } from "./claude-code";
import { createCodexAdapter } from "./codex";
import { createOpenCodeAdapter } from "./opencode";

export const AGENT_ADAPTERS: AgentAdapter[] = [
  claudeCodeAdapter,
  createCodexAdapter(),
  createOpenCodeAdapter(),
];
