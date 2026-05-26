/** A single task line — compact one-row form for kanban view. */

import { For, Show } from "solid-js";
import { PRIORITY_COLOR, PRIORITY_GLYPH, T, fmtMin } from "~/ui/glyphs";
import type { Task } from "~/types";

interface TaskRowProps {
  task: Task;
  cursor?: boolean;
  marked?: boolean;
  /** Optional `[board·col]` tag shown on the right (used by virtual panel). */
  contextTag?: string;
}

export function TaskRow(props: TaskRowProps) {
  return (
    <box
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: props.cursor
          ? T.cardBgCursor
          : props.task.done
            ? T.cardBgDone
            : T.cardBg,
      }}
    >
      <text>
        <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
          {props.cursor ? "▶ " : "  "}
        </span>
        <Show when={props.marked}>
          <span style={{ fg: T.accent }}>● </span>
        </Show>
        <Show when={props.task.done}>
          <span style={{ fg: T.textDone }}>✓ </span>
        </Show>
        <Show when={props.task.priority !== "none"}>
          <span style={{ fg: PRIORITY_COLOR[props.task.priority] }}>
            {PRIORITY_GLYPH[props.task.priority]}{" "}
          </span>
        </Show>
        <span style={{ fg: props.task.done ? T.textDone : T.text }}>
          {props.task.displayTitle || "(empty)"}
        </span>
        <Show when={props.task.timeBlock}>
          <span style={{ fg: T.time }}>
            {"  ⌚ "}
            {fmtMin(props.task.timeBlock!.startMin)}
            {"-"}
            {fmtMin(props.task.timeBlock!.endMin)}
          </span>
        </Show>
        <Show when={props.task.scheduled}>
          <span style={{ fg: T.scheduled }}>{"  ⏳ "}{props.task.scheduled}</span>
        </Show>
        <Show when={props.task.assignee}>
          <span style={{ fg: T.assignee }}>{"  @"}{props.task.assignee}</span>
        </Show>
        <For each={props.task.tags}>
          {(tag) => <span style={{ fg: T.tag }}>{"  #"}{tag}</span>}
        </For>
        <Show when={props.contextTag}>
          <span style={{ fg: T.textDim }}>{"   ["}{props.contextTag}{"]"}</span>
        </Show>
      </text>
    </box>
  );
}
