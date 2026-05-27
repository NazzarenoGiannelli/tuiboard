/**
 * Fullscreen list of every local Claude Code session.
 * `tuiboard --view=agents`. Shows ALL sessions (including archived),
 * scrollable, cursor-navigable.
 */

import { For, Show, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { ModalLayer } from "~/ui/Modal";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

export function AgentsOnly(props: { store: TuiStore }) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;
  const sessions = createMemo(() => props.store.agents.sessions());

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          border: true,
          borderStyle: "rounded",
          borderColor: isActive() ? T.borderActive : T.border,
          paddingLeft: 1,
          paddingRight: 1,
        }}
        title={`┤ Agents · ${sessions().length} sessions ├`}
        titleAlignment="left"
      >
        <Show
          when={sessions().length > 0}
          fallback={
            <text>
              <span style={{ fg: T.textDim }}>
                No sessions found in ~/.claude/projects.
              </span>
            </text>
          }
        >
          <scrollbox
            style={{
              width: "100%",
              flexGrow: 1,
              rootOptions: {},
              contentOptions: {},
              scrollbarOptions: { visible: false },
            }}
          >
            <For each={sessions()}>
              {(session, i) => (
                <AgentRow
                  session={session}
                  cursor={isActive() && i() === agentRow()}
                  nameMaxChars={80}
                  onClick={() => {
                    props.store.setActiveZone("agents");
                    props.store.setCursor(0, i());
                  }}
                />
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
      <ModalLayer store={props.store} />
    </box>
  );
}
