/**
 * Fullscreen list of every local agent session (Claude Code, Codex, OpenCode, Pi).
 * `tuiboard --view=agents`. Shows ALL sessions (including archived),
 * scrollable, cursor-navigable, as two-line cards (see AgentRow). The scrollbox follows the cursor via
 * scrollChildIntoView (same trick used in BoardView for active columns).
 */

import { Index, Show, createEffect, createMemo } from "solid-js";

import { AgentRow } from "~/ui/AgentRow";
import { useStickyAgentCursor } from "~/ui/agent-cursor";
import { T } from "~/ui/glyphs";
import { HARNESS } from "~/store/agents";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/** Rows are keyed by position (see the <Index> below), and so are their ids. */
function rowId(index: number): string {
  return `tuiboard-agent-card-${index}`;
}

export function AgentsOnly(props: { store: TuiStore }) {
  const isActive = () => props.store.state.ui.activeZone === "agents";
  const agentRow = () => props.store.state.ui.row;
  const sessions = createMemo(() => props.store.agentSessions());
  const filter = () => props.store.state.ui.agentsFilter;
  const filterTag = () => (filter() === "all" ? "" : ` · ${HARNESS[filter() as keyof typeof HARNESS].code}`);
  let scrollBoxRef: ScrollBoxLike | undefined;
  useStickyAgentCursor(props.store, sessions);

  // Auto-scroll the list so the active row is visible. setTimeout(0) waits
  // for OpenTUI to finish layout before requesting scroll.
  createEffect(() => {
    const row = agentRow();
    if (!isActive() || !scrollBoxRef) return;
    if (row >= sessions().length) return;
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(rowId(row));
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
        title={`┤ Agents${filterTag()} · ${sessions().length} sessions ├`}
        titleAlignment="left"
      >
        <Show
          when={sessions().length > 0}
          fallback={
            <text>
              <span style={{ fg: T.textDim }}>
                {filter() === "all"
                  ? "No agent sessions found (Claude Code, Codex, OpenCode, Pi)."
                  : `No ${HARNESS[filter() as keyof typeof HARNESS].name} sessions — press f to change the filter.`}
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
            {/*
              <Index>, not <For>: one stable row per position whose data
              updates in place. Sessions are re-created on every refresh and
              reorder by recency, and moving children inside OpenTUI's
              scrollbox left stale/duplicate rows on screen (#52).
            */}
            <Index each={sessions()}>
              {(session, i) => (
                <box id={rowId(i)}>
                  <AgentRow
                    session={session()}
                    cursor={isActive() && i === agentRow()}
                    nameMaxChars={120}
                    variant="card"
                    indicators={props.store.agentIndicators}
                    onClick={() => {
                      props.store.setActiveZone("agents");
                      props.store.setCursor(0, i);
                    }}
                  />
                </box>
              )}
            </Index>
          </scrollbox>
        </Show>
      </box>
    </box>
  );
}
