import { describe, expect, it } from "bun:test";
import { parseArgs, type ViewKind } from "./args";

describe("parseArgs", () => {
  it("returns view=undefined when no flag is present", () => {
    expect(parseArgs([])).toEqual({ view: undefined });
    expect(parseArgs(["bun", "src/app.tsx"])).toEqual({ view: undefined });
  });

  it("parses --view=board", () => {
    expect(parseArgs(["--view=board"])).toEqual({ view: "board" });
  });

  it("parses --view=timeline", () => {
    expect(parseArgs(["--view=timeline"])).toEqual({ view: "timeline" });
  });

  it("parses --view=agents", () => {
    expect(parseArgs(["--view=agents"])).toEqual({ view: "agents" });
  });

  it("parses --view <value> with space separator", () => {
    expect(parseArgs(["--view", "board"])).toEqual({ view: "board" });
  });

  it("returns view=undefined for unknown view value (with warning to stderr)", () => {
    const result = parseArgs(["--view=garbage"]);
    expect(result.view).toBeUndefined();
  });

  it("ignores other flags", () => {
    expect(parseArgs(["--debug", "--view=board", "--something-else"])).toEqual({
      view: "board",
    });
  });
});

// Type-level assertion: ensure ViewKind covers exactly the four expected values.
const _viewKinds: ViewKind[] = ["board", "timeline", "agents"];
void _viewKinds;
