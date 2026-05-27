/**
 * Fullscreen list of every local Claude Code session.
 * `tuiboard --view=agents`. Shows ALL sessions (including archived),
 * scrollable, cursor-navigable. The scrollbox follows the cursor via
 * scrollChildIntoView (same trick used in BoardView for active columns).
 */

import { For, Show, createEffect, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

function rowId(sessionId: string): string {
  // Sanitize sessionId for use as an OpenTUI box id. UUIDs are already safe
  // (alphanumeric + dashes), but defensive belt-and-braces doesn't hurt.
  return `tuiboard-agent-${sessionId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export function AgentsOnly(props: { store: TuiStore }) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;
  const sessions = createMemo(() => props.store.agents.sessions());
  let scrollBoxRef: ScrollBoxLike | undefined;

  // Auto-scroll the list so the active row is visible. setTimeout(0) waits
  // for OpenTUI to finish layout before requesting scroll.
  createEffect(() => {
    const row = agentRow();
    if (!isActive() || !scrollBoxRef) return;
    const target = sessions()[row];
    if (!target) return;
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(rowId(target.sessionId));
      } catch {
        // Child not mounted yet — harmless.
      }
    }, 0);
  });

  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
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
            <For each={sessions()}>
              {(session, i) => (
                <box id={rowId(session.sessionId)}>
                  <AgentRow
                    session={session}
                    cursor={isActive() && i() === agentRow()}
                    nameMaxChars={120}
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
    </box>
  );
}
