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
  /** Optional `[board]` tag rendered as a separate small suffix. Used when
      the row is not already grouped under a `— board · col —` header. */
  contextTag?: string;
  /** Custom fg color for the contextTag. Defaults to muted gray. */
  contextColor?: string;
  /** If true, hide the date suffix (used when group header already conveys date). */
  hideDateSuffix?: boolean;
  /** Max characters shown for the title before middle-truncation kicks in. */
  titleMaxChars?: number;
  /** Mouse click callback — called on left button down. */
  onClick?: () => void;
}

export function TaskRow(props: TaskRowProps) {
  const status = createMemo(() => statusOf(props.task));
  const suffix = createMemo(() => buildSuffix(props.task, props.hideDateSuffix));
  const titleColor = createMemo(() => titleColorFor(props.task, status()));
  const suffixColor = createMemo(() => suffixColorFor(props.task, status()));
  // Middle-truncate so the descriptive head AND the differentiating tail
  // remain visible (Python kanban shows tail-truncated; we go a step
  // further with `head…tail` to disambiguate near-duplicate tasks that
  // share a long common prefix).
  const visibleTitle = createMemo(() =>
    middleTruncate(props.task.displayTitle || "(empty)", props.titleMaxChars ?? 22),
  );

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: props.cursor ? T.cardBgCursor : undefined,
      }}
      onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
    >
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
        <span style={{ fg: titleColor() }}>
          {visibleTitle()}
        </span>
      </text>

      <Show when={suffix()}>
        <text style={{ flexShrink: 0 }} wrapMode="none">
          <span style={{ fg: suffixColor() }}>{" "}{suffix()!}</span>
        </text>
      </Show>

      <Show when={props.contextTag}>
        {/*
          flexShrink 5 (vs 1 on the title) — when the row is tight, the
          contextTag truncates aggressively while the title keeps as much
          space as possible. Truncate + wrapMode none guarantee we never
          wrap to a second line.
        */}
        <text style={{ flexShrink: 5 }} wrapMode="none" truncate>
          <span style={{ fg: props.contextColor ?? T.textDim }}>
            {" ["}{props.contextTag}{"]"}
          </span>
        </text>
      </Show>
    </box>
  );
}

type TaskStatus = "done" | "overdue" | "today" | "future" | "unscheduled";

function statusOf(t: Task): TaskStatus {
  if (t.done) return "done";
  const d = t.scheduled ?? t.due;
  if (!d) return "unscheduled";
  if (d < isoToday()) return "overdue";
  if (d === isoToday()) return "today";
  return "future";
}

function titleColorFor(task: Task, status: TaskStatus): string | undefined {
  if (status === "done") return T.textDone;
  if (status === "overdue") return T.overdue;
  if (status === "today") return T.today;
  // future / unscheduled: terminal default fg (looks right on any theme).
  return T.text;
  void task;
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

function suffixColorFor(task: Task, status: TaskStatus): string | undefined {
  if (status === "done") return T.textDone;
  if (status === "overdue") return T.overdue;
  if (status === "today") return T.today;
  if (status === "future") return T.scheduled;
  return T.textDim;
  void task;
}

/**
 * Truncate to `max` chars, but keep BOTH a head and a tail with `…` in the
 * middle when the string is too long. The head gets ~70% of the budget
 * because that's the most descriptive portion of a task title.
 *
 *   "Founder outreach LinkedIn — kickoff: estrai 5-15 paying users"
 *   middleTruncate(s, 22)  →  "Founder outreac…users"
 */
function middleTruncate(s: string, max: number): string {
  if (max < 4) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  const budget = max - 1; // reserve 1 for ellipsis
  const head = Math.max(1, Math.ceil(budget * 0.7));
  const tail = Math.max(1, budget - head);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}
