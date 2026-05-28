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
  /**
   * Optional title tint (e.g. the source-board accent in the virtual panel).
   * Applies only to non-done, non-overdue, non-today rows — those keep their
   * status color. Done-green always wins over any tint.
   */
  tintColor?: string;
  /**
   * Total cell width available to this row, in terminal columns. When set,
   * TaskRow computes the exact title budget from this width minus the row's
   * actual overhead (cursor, marked dot, done check, priority emoji, context
   * tag, suffix). This guarantees the tail-truncate `…` is always visible
   * inside the cell — OpenTUI never needs to chop the row further.
   */
  availableWidth?: number;
  /** Hard cap on title chars regardless of availableWidth. Defaults to 60. */
  titleMaxChars?: number;
  /** Mouse click callback — called on left button down. */
  onClick?: () => void;
}

export function TaskRow(props: TaskRowProps) {
  const status = createMemo(() => statusOf(props.task));
  const suffix = createMemo(() => buildSuffix(props.task, props.hideDateSuffix));
  const titleColor = createMemo(() =>
    titleColorFor(props.task, status(), props.tintColor),
  );
  const suffixColor = createMemo(() => suffixColorFor(props.task, status()));

  // Compute the title budget from availableWidth + this row's actual overhead
  // so the tail-truncate `…` is always visible inside the cell. If the parent
  // didn't pass a width, fall back to the legacy titleMaxChars-based behavior.
  const titleBudget = createMemo(() => {
    const hardCap = props.titleMaxChars ?? 60;
    if (props.availableWidth === undefined) {
      return hardCap;
    }
    let overhead = 2; // cursor "▶ " or "  "
    if (props.marked) overhead += 2;
    if (props.task.done) overhead += 2;
    if (props.task.priority !== "none") overhead += 3; // emoji 2 cells + space
    if (props.contextTag) overhead += props.contextTag.length + 3; // " [" + tag + "]"
    const sfx = suffix();
    if (sfx) overhead += sfx.length + 1; // leading space + suffix
    const computed = props.availableWidth - overhead;
    return Math.max(6, Math.min(hardCap, computed));
  });

  const visibleTitle = createMemo(() =>
    tailTruncate(props.task.displayTitle || "(empty)", titleBudget()),
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
        `truncate` is on as a SAFETY NET. The titleBudget memo above
        sizes our own tailTruncate so the text content fits exactly
        in the flex-shrunk cell — when that calculation is right (the
        common case), OpenTUI has nothing to truncate and our `…` is
        the only ellipsis. When emoji width or terminal quirks throw
        off the math by 1-2 cells, OpenTUI's truncate clips at the
        cell boundary instead of letting the text overflow into
        adjacent renderables (which produced visible 'Linktoday'
        merges and bleed-into-neighbor-zone glitches before this).
      */}
      <text
        style={{ flexGrow: 1, flexShrink: 1 }}
        truncate
        wrapMode="none"
      >
        <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
          {props.grabbed ? "⤤ " : props.cursor ? "▶ " : "  "}
        </span>
        <Show when={props.marked}>
          <span style={{ fg: T.accent }}>● </span>
        </Show>
        <Show when={props.task.done}>
          <span style={{ fg: T.done }}>✓ </span>
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
          contextTag is the first thing to lose space. `truncate` ON
          as safety so the tag doesn't overflow into neighboring zones
          when the cell shrinks below its content width.
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

function titleColorFor(
  task: Task,
  status: TaskStatus,
  tintColor?: string,
): string | undefined {
  // Done-green always wins so a completed task reads as "done" at a glance,
  // regardless of which board it came from.
  if (status === "done") return T.done;
  // A board tint (virtual panel) takes precedence over the date-status colors:
  // the panel's section headers (Overdue/Today/Tomorrow) already convey the
  // date, so the row color is freed up to signal the *source board* instead.
  if (tintColor) return tintColor;
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
