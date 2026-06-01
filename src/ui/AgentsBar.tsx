/**
 * Compact agent status strip for the dashboard. The non-archived sessions
 * render inside a vertical scrollbox so the list scrolls with the mouse wheel
 * (like the board / planner / timeline zones) AND follows the keyboard cursor
 * via scrollChildIntoView — same pattern as BoardView's columns.
 *
 * The border color reflects activeZone === "agents" so the cursor ring is
 * visible. Clicking a row sets activeZone + agent cursor.
 */

import { For, Show, createEffect, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

const AGENT_ROW_PREFIX = "tuiboard-agent-row-";
const agentRowId = (index: number) => `${AGENT_ROW_PREFIX}${index}`;

interface AgentsBarProps {
  store: TuiStore;
  /** Fixed row height in the dashboard layout. */
  height?: number;
}

export function AgentsBar(props: AgentsBarProps) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;

  /** All visible (non-archived) sessions. */
  const allShown = createMemo(() =>
    props.store.agents.sessions().filter((s) => s.status !== "archived"),
  );

  let scrollBoxRef: ScrollBoxLike | undefined;

  // Keep the cursor row visible as j/k moves it (mouse wheel scrolls freely
  // via the scrollbox itself). setTimeout(0) waits for layout to commit.
  createEffect(() => {
    const row = agentRow();
    if (!isActive() || !scrollBoxRef) return;
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(agentRowId(row));
      } catch {
        // Child not mounted yet — harmless.
      }
    }, 0);
  });

  return (
    <box
      style={{
        flexDirection: "column",
        height: props.height,
        flexGrow: props.height ? 0 : 1,
        // No top gap — the agents strip sits flush under the board columns so
        // the columns reclaim that row (the 1-row gap read as ~double the
        // timeline's 1-col gap because terminal cells are taller than wide).
        marginTop: 0,
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
        <scrollbox
          ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
          style={{
            width: "100%",
            flexGrow: 1,
            scrollX: false,
            scrollY: true,
            rootOptions: {},
            contentOptions: {},
            scrollbarOptions: { visible: false },
          }}
        >
          <For each={allShown()}>
            {(session, i) => (
              <box id={agentRowId(i())}>
                <AgentRow
                  session={session}
                  cursor={isActive() && i() === agentRow()}
                  nameMaxChars={48}
                  onClick={() => {
                    props.store.setActiveZone("agents");
                    props.store.setCursor(0, i());
                  }}
                />
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}
