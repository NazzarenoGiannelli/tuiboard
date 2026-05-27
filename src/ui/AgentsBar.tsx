/**
 * Compact agent status strip for the dashboard. Renders a windowed slice
 * of the non-archived sessions list so the cursor stays inside the view
 * even when the underlying list is far larger than the visible rows.
 *
 * The border color reflects activeZone === "agents" so the cursor
 * ring is visible. Clicking a row sets activeZone + agent cursor.
 */

import { For, Show, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface AgentsBarProps {
  store: TuiStore;
  /** Fixed row height in the dashboard layout. */
  height?: number;
  /** Max sessions to show in the compact strip. Default 5 (fits in height=7). */
  maxVisible?: number;
}

interface WindowedEntry {
  index: number;
  // We don't import AgentSession here; carrying through the For element is fine.
  // Solid will infer the type.
  session: ReturnType<TuiStore["agents"]["sessions"]>[number];
}

export function AgentsBar(props: AgentsBarProps) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;
  const maxVisible = () => props.maxVisible ?? 5;

  /** All visible (non-archived) sessions — full list. */
  const allShown = createMemo(() =>
    props.store.agents.sessions().filter((s) => s.status !== "archived"),
  );

  /**
   * Windowed slice that follows the cursor. When the cursor falls outside
   * the current window, we slide so it sits in the middle (when possible).
   */
  const windowed = createMemo<WindowedEntry[]>(() => {
    const all = allShown();
    const max = maxVisible();
    if (all.length <= max) {
      return all.map((session, index) => ({ index, session }));
    }
    const cursor = isActive() ? agentRow() : 0;
    const halfWin = Math.floor(max / 2);
    let start = Math.max(0, cursor - halfWin);
    let end = Math.min(all.length, start + max);
    if (end - start < max) start = Math.max(0, end - max);
    return all.slice(start, end).map((session, i) => ({
      index: start + i,
      session,
    }));
  });

  return (
    <box
      style={{
        flexDirection: "column",
        height: props.height,
        flexGrow: props.height ? 0 : 1,
        marginTop: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Agents (live) · ${allShown().length} ├`}
      titleAlignment="left"
    >
      <Show
        when={allShown().length > 0}
        fallback={
          <text>
            <span style={{ fg: T.textDim }}>No active sessions.</span>
          </text>
        }
      >
        <For each={windowed()}>
          {(entry) => (
            <AgentRow
              session={entry.session}
              cursor={isActive() && entry.index === agentRow()}
              nameMaxChars={48}
              onClick={() => {
                props.store.setActiveZone("agents");
                props.store.setCursor(0, entry.index);
              }}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
