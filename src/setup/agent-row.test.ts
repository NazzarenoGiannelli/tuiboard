import { describe, expect, it } from "bun:test";

import { agentRowDetail } from "./agent-row";

describe("agentRowDetail", () => {
  it("counts sessions when the agents zone is running", () => {
    expect(agentRowDetail({ found: true, sessions: 0 }, "on")).toBe("0 sessions");
    expect(agentRowDetail({ found: true, sessions: 1 }, "on")).toBe("1 session");
    expect(agentRowDetail({ found: true, sessions: 7 }, "hidden")).toBe("7 sessions");
  });

  it("says only 'found' when the zone is off: the count would be a lie", () => {
    expect(agentRowDetail({ found: true, sessions: 0 }, "off")).toBe("found");
  });

  it("explains a missing tool regardless of the zone", () => {
    for (const zone of ["on", "off", "hidden"] as const) {
      expect(agentRowDetail({ found: false, sessions: 0 }, zone)).toContain("not found");
    }
  });
});
