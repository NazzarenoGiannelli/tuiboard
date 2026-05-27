/**
 * Smoke check for the agents store. Lists the first 10 sessions
 * discovered on this machine with status, display name, and short cwd.
 *
 * Usage: bun run agents:check
 */

import { createAgentsStore } from "~/store/agents";

const store = createAgentsStore();
const all = store.sessions();
const live = all.filter(
  (s) => s.status === "live-busy" || s.status === "live-idle",
);

console.log(`Found ${all.length} sessions, ${live.length} live`);
console.log("");
for (const s of all.slice(0, 10)) {
  console.log(
    `  ${s.status.padEnd(10)}  ${s.displayName.padEnd(40)}  ${s.cwdShort}`,
  );
}

await store.dispose();
