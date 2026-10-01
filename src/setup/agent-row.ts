/**
 * The detail text of an agent row in Setup. With the Agents zone off the store holds no
 * session list at all (an inert stub), so a count would read "0 sessions" for a tool that
 * may have hundreds: say only that it was found.
 */

import type { ZoneMode } from "~/config/loader";

export function agentRowDetail(a: { found: boolean; sessions: number }, agentsZone: ZoneMode): string {
  if (!a.found) return "not found: nothing to set up, it appears once you use it";
  if (agentsZone === "off") return "found";
  return `${a.sessions} session${a.sessions === 1 ? "" : "s"}`;
}
