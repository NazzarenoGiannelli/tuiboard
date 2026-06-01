/**
 * Standalone fullscreen view for the kanban board (with planner panel).
 * Mounted when the user launches `tuiboard --view=board`, AND used inside
 * the dashboard via composition.
 *
 * The cursor and modals are governed by the same store as the dashboard;
 * only the layout differs (no Timeline / Agents zones).
 *
 * The modal side-panel is rendered at App level, so this view just lays
 * out its zones in a single row and lets the parent slot the modal in.
 */

import { Show, createMemo } from "solid-js";

import { BoardView } from "~/ui/BoardView";
import { PlannerPanel } from "~/ui/PlannerPanel";
import type { TuiStore } from "~/store/index";

export function BoardOnly(props: { store: TuiStore }) {
  const ui = () => props.store.state.ui;
  const activeBoard = createMemo(
    () => props.store.state.boards[ui().activeBoardIndex]?.board,
  );

  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
      <Show when={!ui().zoomed || ui().activeZone === "planner"}>
        <PlannerPanel store={props.store} />
      </Show>
      <Show when={(!ui().zoomed || ui().activeZone !== "planner") && activeBoard()}>
        <BoardView store={props.store} board={activeBoard()!} />
      </Show>
    </box>
  );
}
