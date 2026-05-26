/**
 * Single-line task row — high-density rendering.
 *
 * Layout: left flex group (cursor + priority + title) takes available width
 * and truncates. Right flex group (compact suffix: today/tmrw/DD/MM/⌚time)
 * stays a fixed size and pins to the right.
 *
 * Inspired by the Python kanban view density: ~30-40 tasks visible per
 * column at typical terminal sizes, instead of 8-10 in the previous card
 * layout.
 */

import { Show, createMemo } from "solid-js";

import { PRIORITY_COLOR, PRIORITY_GLYPH, T, fmtMin } from "~/ui/glyphs";
import { isoToday, isoTomorrow } from "~/store/index";
import type { Task } from "~/types";

interface TaskRowProps {
  task: Task;
  cursor?: boolean;
  marked?: boolean;
  /** Optional `[board·col]` tag rendered as a separate small suffix. Used when
      the row is not already grouped under a `— board · col —` header. */
  contextTag?: string;
  /** If true, hide the date suffix (used when group header already conveys date). */
  hideDateSuffix?: boolean;
}

export function TaskRow(props: TaskRowProps) {
  const suffix = createMemo(() => buildSuffix(props.task, props.hideDateSuffix));
  const suffixColor = createMemo(() => suffixColorFor(props.task));

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: props.cursor
          ? T.cardBgCursor
          : props.task.done
            ? "transparent"
            : "transparent",
      }}
    >
      {/* Left: cursor + priority + title, flexGrow:1, truncate */}
      <text
        style={{ flexGrow: 1, flexShrink: 1 }}
        truncate
        wrapMode="none"
      >
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
      </text>

      {/* Right: compact date / time suffix */}
      <Show when={suffix()}>
        <text style={{ flexShrink: 0, marginLeft: 1 }} wrapMode="none">
          <span style={{ fg: suffixColor() }}>{suffix()!}</span>
        </text>
      </Show>

      <Show when={props.contextTag}>
        <text style={{ flexShrink: 0, marginLeft: 1 }} wrapMode="none">
          <span style={{ fg: T.textDim }}>{"["}{props.contextTag}{"]"}</span>
        </text>
      </Show>
    </box>
  );
}

/**
 * Build the compact right-side suffix shown on a task row.
 *
 * Examples:
 *   ⌚09:00 today    (today + time block)
 *   today            (scheduled today, no time block)
 *   tmrw             (tomorrow)
 *   ⌚09:00          (time block only)
 *   25/05            (scheduled some other day)
 *   25/05 ✓          (done; the date is the doneDate)
 */
function buildSuffix(task: Task, hideDate?: boolean): string | undefined {
  const parts: string[] = [];
  if (task.timeBlock) {
    parts.push(`⌚${fmtMin(task.timeBlock.startMin)}`);
  }
  if (!hideDate) {
    const date = task.scheduled ?? task.due ?? task.doneDate;
    if (date) {
      if (date === isoToday()) parts.push("today");
      else if (date === isoTomorrow()) parts.push("tmrw");
      else parts.push(date.slice(5).replace("-", "/")); // MM/DD → "MM/DD"
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join(" ");
}

function suffixColorFor(task: Task): string {
  if (task.done) return T.textDone;
  const date = task.scheduled ?? task.due;
  if (!date) return T.textDim;
  if (date < isoToday()) return T.overdue;
  if (date === isoToday()) return T.high;
  return T.scheduled;
}
