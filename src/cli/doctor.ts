/**
 * `tuiboard doctor`: what is set up, as plain text (or JSON). The same facts the Setup
 * dialog (`S`) shows, from the same function, for a terminal, a script or a bug report.
 * Read-only: it changes no file and opens nothing.
 */

import { loadConfig } from "~/config/loader";
import { agentRowDetail } from "~/setup/agent-row";
import { liveSetupDeps } from "~/setup/live";
import { collectSetupStatus, type SetupStatus } from "~/setup/status";

const mark = (ok: boolean) => (ok ? "✓" : "○");

/**
 * `sessionsKnown: false` is for callers that did not read any sessions (the CLI does not
 * start the agents store): a count would always be 0, so a found source reads "found".
 */
export function formatDoctor(s: SetupStatus, sessionsKnown = true): string {
  const lines: string[] = [`tuiboard ${s.version}`, ""];
  lines.push(`${mark(s.boards.length > 0)} Boards  ${s.boards.length === 0 ? "none yet: run tuiboard and press + to add one" : String(s.boards.length)}`);
  for (const b of s.boards) lines.push(`    ${b.exists ? "" : "(file missing) "}${b.name}  ${b.path}`);
  lines.push(`    config: ${s.paths.config ?? "(none yet)"}`, `    new boards go in: ${s.paths.boardsDir}`, "");
  for (const a of s.agents) {
    // The "off" zone mode makes agentRowDetail print "found" instead of a count.
    lines.push(`${mark(a.found)} ${a.label}  ${agentRowDetail(a, sessionsKnown ? s.zones.agents : "off")}`);
  }
  lines.push(`${mark(s.herdr.installed)} herdr  ${s.herdr.installed ? "installed" : "optional"}`, "");
  for (const c of s.calendars) lines.push(`${mark(c.connected)} ${c.label}  ${c.connected ? "connected" : "optional: " + c.hint}`);
  lines.push("");
  lines.push(`${mark(s.updates.enabled)} Update notice  ${s.updates.enabled ? "on" + (s.updates.latest ? `, latest known ${s.updates.latest}` : "") : "off (update_check: off)"}`);
  lines.push(`    zones: planner ${s.zones.planner}, agenda ${s.zones.agenda}, agents ${s.zones.agents}`);
  return lines.join("\n") + "\n";
}

export function runDoctor(argv: readonly string[]): number {
  const unknown = argv.find((a) => a !== "--json");
  if (unknown) {
    console.error(`tuiboard doctor: unknown argument "${unknown}"\nusage: tuiboard doctor [--json]`);
    return 2;
  }
  const status = collectSetupStatus(liveSetupDeps(loadConfig(), []));
  console.log(argv.includes("--json") ? JSON.stringify(status, null, 2) : formatDoctor(status, false).trimEnd());
  return 0;
}
