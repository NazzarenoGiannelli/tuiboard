/**
 * Keep the Agents cursor on the same session while the list reorders.
 *
 * The cursor is a row index (`ui.row`), and sessions move all the time —
 * sorted by recency, a new one lands on top, a working one climbs. Without
 * this, the highlighted row silently became a different session and Enter /
 * H / c acted on it. Call once inside the component that renders the list.
 */

import { createEffect } from "solid-js";

import type { AgentSession } from "~/store/agents";
import type { TuiStore } from "~/store/index";

/** Pure decision, for tests: where the cursor should be after a change. */
export function followSelection(
  prev: { list: readonly AgentSession[] | undefined; row: number; id: string | undefined },
  list: readonly AgentSession[],
  row: number,
): number {
  // Only a list change (not a keypress) may move the cursor.
  if (list === prev.list || row !== prev.row || !prev.id) return row;
  if (list[row]?.sessionId === prev.id) return row;
  const idx = list.findIndex((s) => s.sessionId === prev.id);
  return idx >= 0 ? idx : Math.min(row, Math.max(0, list.length - 1));
}

export function useStickyAgentCursor(store: TuiStore, list: () => readonly AgentSession[]): void {
  const prev: { list: readonly AgentSession[] | undefined; row: number; id: string | undefined } = {
    list: undefined,
    row: -1,
    id: undefined,
  };
  createEffect(() => {
    const items = list();
    const row = store.state.ui.row;
    // `ui.row` belongs to whichever zone is active.
    if (store.state.ui.activeZone !== "agents") {
      prev.list = undefined;
      prev.id = undefined;
      return;
    }
    const next = followSelection(prev, items, row);
    prev.list = items;
    prev.row = next;
    prev.id = items[next]?.sessionId;
    if (next !== row) store.setCursor(0, next);
  });
}
