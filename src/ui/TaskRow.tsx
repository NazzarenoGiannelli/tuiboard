/** A single task line — compact one-row form for kanban view. */

import { For, Show, createMemo } from "solid-js";
import { PRIORITY_COLOR, PRIORITY_GLYPH, T, fmtMin } from "~/ui/glyphs";
import type { Task } from "~/types";

interface TaskRowProps {
  task: Task;
  cursor?: boolean;
  marked?: boolean;
  /** Optional `[board·col]` tag shown on the right (used by virtual panel). */
  contextTag?: string;
  /**
   * Max characters of the title shown on the card. Long titles are truncated
   * with an ellipsis so each card stays one (title) + one (meta) line tall.
   * Tune to column width minus glyphs/padding.
   */
  titleMaxChars?: number;
}

export function TaskRow(props: TaskRowProps) {
  const max = () => props.titleMaxChars ?? 30;
  const title = createMemo(() => {
    const raw = props.task.displayTitle || "(empty)";
    if (raw.length <= max()) return raw;
    return raw.slice(0, Math.max(1, max() - 1)) + "…";
  });

  const hasMeta = () =>
    Boolean(
      props.task.timeBlock ||
        props.task.scheduled ||
        props.task.assignee ||
        props.task.tags.length > 0 ||
        props.contextTag,
    );

  return (
    <box
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
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
          {title()}
        </span>
      </text>
      <Show when={hasMeta()}>
        <text>
          <span style={{ fg: T.textDim }}>{"   "}</span>
          <Show when={props.task.timeBlock}>
            <span style={{ fg: T.time }}>
              {"⌚ "}
              {fmtMin(props.task.timeBlock!.startMin)}
              {"-"}
              {fmtMin(props.task.timeBlock!.endMin)}
              {"  "}
            </span>
          </Show>
          <Show when={props.task.scheduled}>
            <span style={{ fg: T.scheduled }}>{"⏳ "}{props.task.scheduled}{"  "}</span>
          </Show>
          <Show when={props.task.assignee}>
            <span style={{ fg: T.assignee }}>{"@"}{props.task.assignee}{"  "}</span>
          </Show>
          <For each={props.task.tags}>
            {(tag) => <span style={{ fg: T.tag }}>{"#"}{tag}{"  "}</span>}
          </For>
          <Show when={props.contextTag}>
            <span style={{ fg: T.textDim }}>{"["}{props.contextTag}{"]"}</span>
          </Show>
        </text>
      </Show>
    </box>
  );
}
