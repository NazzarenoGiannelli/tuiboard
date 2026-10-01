/**
 * `tuiboard doctor`: what is set up, as plain text (or JSON). The same facts the Setup
 * dialog (`S`) shows, from the same function, for a terminal, a script or a bug report.
 * Read-only: it changes no file and opens nothing.
 */

import { findConfigPath, loadConfig, type Config } from "~/config/loader";
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
  lines.push(`${mark(s.updates.enabled)} Update notice  ${s.updates.enabled ? "on" + (s.updates.latest ? `, latest known ${s.updates.latest}` : "") : "off (update_check, TUIBOARD_NO_UPDATE_CHECK or CI)"}`);
  lines.push(`    zones: planner ${s.zones.planner}, agenda ${s.zones.agenda}, agents ${s.zones.agents}`);
  return lines.join("\n") + "\n";
}

/**
 * The `--json` object. JSON.stringify drops keys whose value is undefined, so the config
 * path and the update cache would come and go between machines: they are `null` instead,
 * and a script can rely on the shape. No sessions are read here, so the per-agent count and
 * last activity would be invented zeros: they are left out rather than report a measurement
 * never made.
 */
export function doctorJson(status: SetupStatus) {
  const agents = status.agents.map(({ sessions: _sessions, lastActivityMs: _last, ...a }) => a);
  return {
    ...status,
    paths: { ...status.paths, config: status.paths.config ?? null },
    agents,
    updates: {
      ...status.updates,
      latest: status.updates.latest ?? null,
      checkedAt: status.updates.checkedAt ?? null,
    },
  };
}

export function runDoctor(argv: readonly string[]): number {
  const unknown = argv.find((a) => a !== "--json");
  if (unknown) {
    console.error(`tuiboard doctor: unknown argument "${unknown}"\nusage: tuiboard doctor [--json]`);
    return 2;
  }
  const json = argv.includes("--json");
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    // A malformed or unreadable config is exactly what doctor should be able to name.
    const message = err instanceof Error ? err.message : String(err);
    if (json) console.log(JSON.stringify({ error: message }));
    else console.error(`tuiboard doctor: cannot read config ${findConfigPath().path}: ${message}`);
    return 1;
  }
  const status = collectSetupStatus(liveSetupDeps(config, []));
  if (json) {
    console.log(JSON.stringify(doctorJson(status), null, 2));
  } else {
    console.log(formatDoctor(status, false).trimEnd());
  }
  return 0;
}
