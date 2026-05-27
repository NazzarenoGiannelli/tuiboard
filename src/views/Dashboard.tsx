/**
 * The default tuiboard view: a 4-zone dashboard.
 *
 *   ┌─Virtual─┬─Board────────┬─Timeline─┐
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
import { ModalLayer } from "~/ui/Modal";
import { TimelineView } from "~/ui/TimelineView";
import { VirtualPanel } from "~/ui/VirtualPanel";
import { AgentsOnly } from "~/views/AgentsOnly";
import { BoardOnly } from "~/views/BoardOnly";
import { TimelineOnly } from "~/views/TimelineOnly";
import type { TuiStore } from "~/store/index";

/** Width (in cells) for the right-column Timeline panel on a wide terminal. */
const TIMELINE_WIDTH = 50;
/** Row height for the bottom Agents strip — enough for ~5 sessions. */
const AGENTS_HEIGHT = 7;

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
 * Board + virtual share BoardOnly because both live in the top-left
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
      {/* Left column: virtual + board on top, agents on bottom */}
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {/* Top zone */}
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          <Show when={visible().virtual}>
            <VirtualPanel store={props.store} />
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
      {/* Right column: timeline (full height) */}
      <Show when={visible().timeline}>
        <TimelineView store={props.store} width={TIMELINE_WIDTH} />
      </Show>
      <ModalLayer store={props.store} />
    </box>
  );
}
