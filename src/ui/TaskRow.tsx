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
  /** True when grab mode is on AND this row is the cursor (about to move). */
  grabbed?: boolean;
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
  // Tail-truncate so the descriptive head of the title is fully visible —
  // mirrors Python kanban behavior. Readability beat the earlier "middle
  // truncate" attempt at disambiguating common prefixes, which left tasks
  // looking like "Foo b…s 3" with the meaning chopped out of the middle.
  const visibleTitle = createMemo(() =>
    tailTruncate(props.task.displayTitle || "(empty)", props.titleMaxChars ?? 22),
  );

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        // Grab mode tints the cursor row warm orange so the user always
        // knows which task is "in transit". Plain cursor stays neutral.
        backgroundColor: props.grabbed
          ? T.warmDim
          : props.cursor
            ? T.cardBgCursor
            : undefined,
      }}
      onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
    >
      {/*
        IMPORTANT: NO `truncate` flag on the title <text>.
        OpenTUI's native truncate algorithm inserts `head…middle…tail`
        ellipses when its multi-span content exceeds the flex-shrunk cell
        width, overriding our clean tail-only truncation. By omitting
        the flag, OpenTUI simply hard-clips at the cell boundary. Our
        own tailTruncate(title, titleMaxChars) is the only source of
        ellipsis insertion — the `…` it adds is visible whenever the
        cell is wide enough; when the cell is tighter than that, the
        right side (including the `…`) is clipped cleanly without any
        middle-ellipsis garbage.
      */}
      <text
        style={{ flexGrow: 1, flexShrink: 1 }}
        wrapMode="none"
      >
        <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
          {props.grabbed ? "⤤ " : props.cursor ? "▶ " : "  "}
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
          contextTag is the first thing to lose space. Same `truncate`
          off as on the title text: OpenTUI's middle-ellipsis would turn
          [R3PLICA] into [...A] when squeezed. Hard-clipping gives
          [R3PLI or similar — readable, no fake-ellipsis noise.
        */}
        <text style={{ flexShrink: 5 }} wrapMode="none">
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
 * Truncate to `max` chars, preserving as much of the head as possible.
 * When the string fits, return it untouched. Otherwise show the first
 * `max - 1` characters followed by an ellipsis.
 *
 *   "Founder outreach LinkedIn — kickoff: estrai 5-15 paying users"
 *   tailTruncate(s, 22)  →  "Founder outreach Link…"
 *
 * The ellipsis counts toward `max`, so the visible glyph width never
 * exceeds the available column budget.
 */
function tailTruncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max < 2) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}
