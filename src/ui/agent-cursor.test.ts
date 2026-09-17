import { describe, expect, it } from "bun:test";

import type { AgentSession } from "~/store/agents";
import { followSelection } from "./agent-cursor";

const s = (sessionId: string) => ({ sessionId }) as AgentSession;
const before = [s("a"), s("b"), s("c")];

describe("followSelection", () => {
  it("follows the selected session when the list reorders", () => {
    const after = [s("new"), s("a"), s("b"), s("c")];
    expect(followSelection({ list: before, row: 1, id: "b" }, after, 1)).toBe(2);
  });

  it("never overrides a keypress (row changed)", () => {
    const after = [s("new"), s("a"), s("b"), s("c")];
    expect(followSelection({ list: before, row: 1, id: "b" }, after, 2)).toBe(2);
  });

  it("does nothing when the list didn't change or the row still matches", () => {
    expect(followSelection({ list: before, row: 1, id: "b" }, before, 1)).toBe(1);
    const same = [s("a"), s("b"), s("x")];
    expect(followSelection({ list: before, row: 1, id: "b" }, same, 1)).toBe(1);
  });

  it("stays in range when the selected session disappears", () => {
    expect(followSelection({ list: before, row: 2, id: "c" }, [s("a"), s("b")], 2)).toBe(1);
    expect(followSelection({ list: before, row: 0, id: "a" }, [], 0)).toBe(0);
  });

  it("does nothing before anything was selected", () => {
    expect(followSelection({ list: undefined, row: -1, id: undefined }, before, 0)).toBe(0);
  });
});
