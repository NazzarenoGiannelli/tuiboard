/**
 * The single-pane ring: what `h` and `l` walk through when only one pane fits
 * on screen.
 *
 * Pure geometry over "which zones are enabled" and "which board columns are
 * drawn", so it is tested without a terminal — the same treatment as
 * board-scroll.ts.
 */

import { describe, expect, it } from "bun:test";

import { buildRing, stepRing, type Pane } from "./pane-ring";

const ALL = { planner: true, board: true, timeline: true, agents: true };

const zone = (z: "planner" | "timeline" | "agents"): Pane => ({ kind: "zone", zone: z });
const col = (index: number): Pane => ({ kind: "column", index });

describe("buildRing", () => {
  it("puts the planner first, the board's columns next, then agenda and agents", () => {
    expect(buildRing({ enabledZones: ALL, renderedColumns: [0, 1] })).toEqual([
      zone("planner"),
      col(0),
      col(1),
      zone("timeline"),
      zone("agents"),
    ]);
  });

  it("leaves out zones disabled in the config", () => {
    const ring = buildRing({
      enabledZones: { ...ALL, timeline: false, agents: false },
      renderedColumns: [0, 1],
    });
    expect(ring).toEqual([zone("planner"), col(0), col(1)]);
  });

  it("carries only the columns actually drawn — Done and Archive are not stops", () => {
    // The caller filters hidden columns; the ring must not invent indexes
    // between the ones it was handed.
    expect(buildRing({ enabledZones: ALL, renderedColumns: [0, 3] })).toEqual([
      zone("planner"),
      col(0),
      col(3),
      zone("timeline"),
      zone("agents"),
    ]);
  });

  it("survives a board with no drawn columns at all", () => {
    expect(buildRing({ enabledZones: ALL, renderedColumns: [] })).toEqual([
      zone("planner"),
      zone("timeline"),
      zone("agents"),
    ]);
  });
});

describe("stepRing", () => {
  const ring = buildRing({ enabledZones: ALL, renderedColumns: [0, 1] });

  it("walks forward through zones and columns alike", () => {
    expect(stepRing(ring, zone("planner"), 1)).toEqual(col(0));
    expect(stepRing(ring, col(0), 1)).toEqual(col(1));
    expect(stepRing(ring, col(1), 1)).toEqual(zone("timeline"));
    expect(stepRing(ring, zone("timeline"), 1)).toEqual(zone("agents"));
  });

  it("wraps at both ends — the ring closes", () => {
    expect(stepRing(ring, zone("agents"), 1)).toEqual(zone("planner"));
    expect(stepRing(ring, zone("planner"), -1)).toEqual(zone("agents"));
  });

  it("walks backward", () => {
    expect(stepRing(ring, col(0), -1)).toEqual(zone("planner"));
    expect(stepRing(ring, zone("timeline"), -1)).toEqual(col(1));
  });

  it("stands still on a ring of one — no flash, no wrap onto itself", () => {
    const single = buildRing({
      enabledZones: { planner: false, board: true, timeline: false, agents: false },
      renderedColumns: [2],
    });
    expect(single).toEqual([col(2)]);
    expect(stepRing(single, col(2), 1)).toEqual(col(2));
    expect(stepRing(single, col(2), -1)).toEqual(col(2));
  });

  it("falls back to the first pane when the current one is no longer in the ring", () => {
    // A column can vanish under the cursor: a filter change, or an external
    // edit that removed it. Stepping must land somewhere real rather than
    // returning a pane that cannot be rendered.
    expect(stepRing(ring, col(9), 1)).toEqual(zone("planner"));
  });

  it("returns the only pane when asked to step an empty ring", () => {
    expect(stepRing([], col(0), 1)).toEqual(col(0));
  });
});
