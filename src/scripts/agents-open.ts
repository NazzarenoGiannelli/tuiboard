/**
 * Diagnose Enter ("open session") outside the TUI: prints the detected
 * terminal and shell, the exact launch plan (PowerShell scripts decoded) and
 * the outcome, for the session whose id starts with the given prefix.
 *
 * Usage: bun run agents:open <session-id-prefix> [--dry-run]
 *   Honors TUIBOARD_CONFIG / the usual config lookup for resume_terminal and
 *   resume_shell, so run it from where you run tuiboard.
 */

import { loadConfig } from "~/config/loader";
import {
  describePlan,
  detectLauncher,
  planLaunch,
  resolveShell,
  runLaunchPlan,
  systemLaunchEnv,
} from "~/input/open-session";
import { AGENT_ADAPTERS } from "~/store/agent-adapters";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prefix = args.find((a) => !a.startsWith("--"));
if (!prefix) {
  console.error("usage: bun run agents:open <session-id-prefix> [--dry-run]");
  process.exit(2);
}

const now = Date.now();
const matches = AGENT_ADAPTERS.flatMap((a) => a.discover(now)).filter((s) =>
  s.sessionId.startsWith(prefix),
);
if (matches.length !== 1) {
  console.error(
    matches.length === 0
      ? `no session starts with "${prefix}"`
      : `"${prefix}" is ambiguous:\n${matches.map((s) => `  ${s.provider} ${s.sessionId}`).join("\n")}`,
  );
  process.exit(1);
}
const session = matches[0]!;
const config = loadConfig();
const le = systemLaunchEnv();
const launcher = config.resumeTerminal === "auto" ? detectLauncher(le) : config.resumeTerminal;

console.log(`session   ${session.provider} ${session.sessionId}`);
console.log(`cwd       ${session.cwd}`);
console.log(`resume    ${session.resumeCommand}`);
console.log(`terminal  ${launcher ?? "(none detected)"}  [resume_terminal: ${config.resumeTerminal}]`);
console.log(`shell     ${JSON.stringify(resolveShell(config.resumeShell, le))}  [resume_shell: ${config.resumeShell}]`);
if (config.resumeCommand) console.log(`NOTE      resume_command is set — the TUI uses it instead of all this`);
if (!launcher) process.exit(1);

const plan = planLaunch(
  launcher,
  { cwd: session.cwd, resume: session.resumeCommand, shell: config.resumeShell },
  le,
);
console.log(`plan\n${describePlan(plan)}`);
if (dryRun) process.exit(0);
try {
  await runLaunchPlan(plan);
  console.log("result    OK");
} catch (e) {
  console.log(`result    ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
