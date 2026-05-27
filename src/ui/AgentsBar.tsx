/**
 * Compact agent status strip for the dashboard. Renders the top N
 * sessions (live + idle first, then dormant) inside a bordered box.
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
  /** Max sessions to show in the compact strip. Default 6. */
  maxVisible?: number;
}

export function AgentsBar(props: AgentsBarProps) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;

  const visibleSessions = createMemo(() => {
    const all = props.store.agents.sessions();
    // Compact strip hides archived; that's the fullscreen view's job.
    const shown = all.filter((s) => s.status !== "archived");
    return shown.slice(0, props.maxVisible ?? 6);
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
      title={`┤ Agents (live) · ${visibleSessions().length} ├`}
      titleAlignment="left"
    >
      <Show
        when={visibleSessions().length > 0}
        fallback={
          <text>
            <span style={{ fg: T.textDim }}>No active sessions.</span>
          </text>
        }
      >
        <For each={visibleSessions()}>
          {(session, i) => (
            <AgentRow
              session={session}
              cursor={isActive() && i() === agentRow()}
              nameMaxChars={32}
              onClick={() => {
                props.store.setActiveZone("agents");
                props.store.setCursor(0, i());
              }}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
