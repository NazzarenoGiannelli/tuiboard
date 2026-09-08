/**
 * The single-pane ring.
 *
 * When only one pane fits on screen, the zones stop being a layout — left and
 * right no longer mean anything geometric — and become a sequence. This module
 * builds that sequence and steps through it.
 *
 * The board is not one stop but many: in single-pane it renders a single
 * column at full width, so each drawn column is its own pane. The result reads
 * planner → column → column → … → agenda → agents, and closes into a ring.
 *
 * Pure: no store, no renderer, no terminal. The caller decides which zones are
 * enabled and which columns are drawn — this only decides what comes next.
 */

export type RingZone = "planner" | "timeline" | "agents";

export type Pane =
  | { kind: "zone"; zone: RingZone }
  | { kind: "column"; index: number };

export interface RingInput {
  /** Which zones the config enables. `board` is implied by renderedColumns. */
  enabledZones: Record<"planner" | "board" | "timeline" | "agents", boolean>;
  /**
   * Board column indexes actually drawn, in order. Hidden columns (Done,
   * Archive) must already be filtered out by the caller: a pane you cannot
   * see is a dead end to step onto.
   */
  renderedColumns: readonly number[];
}

export function buildRing({ enabledZones, renderedColumns }: RingInput): Pane[] {
  const ring: Pane[] = [];
  if (enabledZones.planner) ring.push({ kind: "zone", zone: "planner" });
  if (enabledZones.board) {
    for (const index of renderedColumns) ring.push({ kind: "column", index });
  }
  if (enabledZones.timeline) ring.push({ kind: "zone", zone: "timeline" });
  if (enabledZones.agents) ring.push({ kind: "zone", zone: "agents" });
  return ring;
}

/**
 * The next pane in `delta`'s direction, wrapping at both ends.
 *
 * A ring of one returns itself: stepping should feel like nothing happened,
 * not like a wrap. If `current` is no longer in the ring — a column removed by
 * a filter change or an external edit — the first pane is returned rather than
 * something unrenderable.
 */
export function stepRing(ring: readonly Pane[], current: Pane, delta: 1 | -1): Pane {
  if (ring.length === 0) return current;
  if (ring.length === 1) return ring[0]!;

  const at = ring.findIndex((p) => samePane(p, current));
  if (at < 0) return ring[0]!;

  const next = (at + delta + ring.length) % ring.length;
  return ring[next]!;
}

export function samePane(a: Pane, b: Pane): boolean {
  if (a.kind === "zone" && b.kind === "zone") return a.zone === b.zone;
  if (a.kind === "column" && b.kind === "column") return a.index === b.index;
  return false;
}

/** Where the current pane sits in the ring, for the position indicator. */
export function ringPosition(ring: readonly Pane[], current: Pane): { at: number; of: number } {
  const at = ring.findIndex((p) => samePane(p, current));
  return { at: at < 0 ? 0 : at, of: ring.length };
}
