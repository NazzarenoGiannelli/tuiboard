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
 */

import { Show, createMemo } from "solid-js";

import { AgentsBar } from "~/ui/AgentsBar";
import { BoardView } from "~/ui/BoardView";
import { ModalLayer } from "~/ui/Modal";
import { TimelineView } from "~/ui/TimelineView";
import { VirtualPanel } from "~/ui/VirtualPanel";
import type { TuiStore } from "~/store/index";

/** Width (in cells) for the right-column Timeline panel on a wide terminal. */
const TIMELINE_WIDTH = 50;
/** Row height for the bottom Agents strip — enough for ~5 sessions. */
const AGENTS_HEIGHT = 7;

export function Dashboard(props: { store: TuiStore }) {
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
          <Show when={visible().virtual && (!ui().zoomed || ui().activeZone === "virtual")}>
            <VirtualPanel store={props.store} />
          </Show>
          <Show when={visible().board && (!ui().zoomed || ui().activeZone !== "virtual") && activeBoard()}>
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
