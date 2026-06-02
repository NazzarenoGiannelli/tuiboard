/**
 * The default tuiboard view: a 4-zone dashboard.
 *
 *   ┌─Planner─┬─Board────────┬─Timeline─┐
 *   │         │              │          │
 *   │         │              │          │
 *   │         ├──────────────┤          │
 *   │         │   Agents     │          │
 *   └─────────┴──────────────┴──────────┘
 *
 * Zone visibility is governed by store.state.ui.visibleZones (F1/F2/F3
 * keys). The cursor lives in store.state.ui.activeZone and is cycled
 * by Shift+Tab via store.cycleActiveZone().
 *
 * Zoom (`z`): when ui.zoomed is true, only the active zone is rendered,
 * full-screen, by reusing the standalone --view=X wrapper for that zone.
 * For the board zone, ui.zoomed also propagates down to BoardView and
 * collapses the masonry to the active column (the legacy Python kanban
 * behavior — "zoom inside the zoom").
 */

import { Show, createMemo } from "solid-js";

import { AgentsBar } from "~/ui/AgentsBar";
import { BoardView } from "~/ui/BoardView";
import { TimelineView } from "~/ui/TimelineView";
import { PlannerPanel } from "~/ui/PlannerPanel";
import { ModalLayer } from "~/ui/Modal";
import { AGENDA_WIDTH, AGENTS_HEIGHT } from "~/ui/layout";
import { AgentsOnly } from "~/views/AgentsOnly";
import { BoardOnly } from "~/views/BoardOnly";
import { TimelineOnly } from "~/views/TimelineOnly";
import type { TuiStore } from "~/store/index";


export function Dashboard(props: { store: TuiStore }) {
  const ui = () => props.store.state.ui;

  return (
    <Show
      when={ui().zoomed}
      fallback={<FourZoneLayout store={props.store} />}
    >
      <ZoomedLayout store={props.store} />
    </Show>
  );
}

/**
 * Zoomed mode: full-screen the active zone. We reuse the existing
 * standalone view wrappers so a `z` press in the dashboard produces
 * the same visual as launching `tuiboard --view=<zone>`.
 *
 * Board + planner share BoardOnly because both live in the top-left
 * zone of the normal layout and BoardOnly already respects ui.zoomed
 * to render only the active panel between them.
 */
function ZoomedLayout(props: { store: TuiStore }) {
  const zone = () => props.store.state.ui.activeZone;

  return (
    <Show when={zone() === "timeline"} fallback={
      <Show when={zone() === "agents"} fallback={<BoardOnly store={props.store} />}>
        <AgentsOnly store={props.store} />
      </Show>
    }>
      <TimelineOnly store={props.store} />
    </Show>
  );
}

function FourZoneLayout(props: { store: TuiStore }) {
  const ui = () => props.store.state.ui;
  const visible = () => ui().visibleZones;
  const activeBoard = createMemo(
    () => props.store.state.boards[ui().activeBoardIndex]?.board,
  );

  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
      {/* Left column: planner + board on top, agents on bottom */}
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {/* Top zone */}
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          <Show when={visible().planner}>
            <PlannerPanel store={props.store} />
          </Show>
          <Show when={visible().board && activeBoard()}>
            <BoardView store={props.store} board={activeBoard()!} />
          </Show>
        </box>
        {/* Bottom zone */}
        <Show when={visible().agents}>
          <AgentsBar store={props.store} height={AGENTS_HEIGHT} />
        </Show>
      </box>
      {/* Right column: the Agenda — or, while a modal is open, the modal panel
          in the Agenda's exact slot (same parent, same width). Swapping them in
          place keeps the whole layout and every height constant; nothing
          shifts. The modal still appears here even if the Agenda is disabled. */}
      <Show
        when={ui().modal}
        fallback={
          <Show when={visible().timeline}>
            <TimelineView store={props.store} width={AGENDA_WIDTH} />
          </Show>
        }
      >
        <ModalLayer store={props.store} />
      </Show>
      {/* ModalLayer rendered at App level so it can sit beside any view */}
    </box>
  );
}
