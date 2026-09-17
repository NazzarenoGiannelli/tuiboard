/**
 * Smoke check for the agents store. Lists the first 10 sessions
 * discovered on this machine with status, display name, and short cwd —
 * plus where each is open in herdr, when herdr is running.
 *
 * Usage: bun run agents:check
 */

import { AGENT_ADAPTERS } from "~/store/agent-adapters";
import { createAgentsStore, isLive, sortSessions } from "~/store/agents";
import { linkHerdrSessions, readHerdrSnapshotOnce } from "~/store/herdr";

const store = createAgentsStore(AGENT_ADAPTERS);
const herdr = readHerdrSnapshotOnce();
const all = sortSessions(linkHerdrSessions(store.sessions(), herdr));
const live = all.filter((s) => isLive(s.status));

console.log(
  `Found ${all.length} sessions, ${live.length} live` +
    (herdr ? `, ${all.filter((s) => s.herdr).length} open in herdr` : " (herdr not reachable)"),
);
console.log("");
for (const s of all.slice(0, 10)) {
  const where = s.herdr
    ? `  [herdr ${s.herdr.workspaceLabel}·${s.herdr.tabNumber} ${s.herdr.status} by ${s.herdr.matchedBy}]`
    : "";
  console.log(
    `  ${s.provider.padEnd(12)}  ${s.status.padEnd(12)}  ${s.displayName.slice(0, 40).padEnd(40)}  ${s.cwdShort}${where}`,
  );
}

await store.dispose();
