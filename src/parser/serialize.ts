/**
 * Markdown board serializer.
 *
 * Design: each line of the original board (heading, task, section break,
 * blank line, unrecognized) is preserved verbatim unless a task has been
 * marked `dirty: true`. In that case the serializer rebuilds *only* that
 * line from structured fields, emitting the new canonical metadata format
 * (e.g. `⌚ HH:MM-HH:MM`). Everything else round-trips bit-for-bit.
 */

import type { Board, Task, TimeBlock } from "~/types";
import {
  isBlankLine,
  isRawOther,
  isSectionBreak,
  isTask,
} from "~/parser/markdown";

const PRIORITY_TO_EMOJI: Record<string, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
  none: "",
};

export function serializeBoard(board: Board): string {
  const eol = board.lineEnding;
  const parts: string[] = [];

  if (board.frontmatter) parts.push(board.frontmatter);
  if (board.preamble) parts.push(board.preamble);

  for (const col of board.columns) {
    parts.push(col.rawHeading);
    parts.push(eol);
    for (const child of col.children) {
      if (isTask(child)) {
        parts.push(serializeTask(child));
      } else if (isSectionBreak(child) || isBlankLine(child) || isRawOther(child)) {
        parts.push(child.rawLine);
      }
      parts.push(eol);
    }
  }

  if (board.trailer) {
    parts.push(board.trailer);
  }

  return parts.join("");
}

export function serializeTask(task: Task): string {
  if (!task.dirty) return task.rawLine;
  return rebuildTaskLine(task);
}

/**
 * Rebuild a task line from structured fields in canonical format:
 *
 *   - [ ] <title> 🔺 @assignee #tag1 ⌚ HH:MM-HH:MM 🛫 D ⏳ D 📅 D ✅ D
 */
function rebuildTaskLine(task: Task): string {
  const checkbox = task.done ? "x" : " ";
  const parts: string[] = [`- [${checkbox}]`];

  const title = task.displayTitle.trim();
  if (title) parts.push(title);

  if (task.priority !== "none") {
    const glyph = PRIORITY_TO_EMOJI[task.priority];
    if (glyph) parts.push(glyph);
  }

  if (task.assignee) parts.push(`@${task.assignee}`);
  for (const tag of task.tags) parts.push(`#${tag}`);

  if (task.timeBlock) parts.push(`⌚ ${fmtTimeBlock(task.timeBlock)}`);
  if (task.start) parts.push(`🛫 ${task.start}`);
  if (task.scheduled) parts.push(`⏳ ${task.scheduled}`);
  if (task.due) parts.push(`📅 ${task.due}`);
  if (task.doneDate) parts.push(`✅ ${task.doneDate}`);

  return parts.join(" ");
}

function fmtTimeBlock(tb: TimeBlock): string {
  return `${fmtMin(tb.startMin)}-${fmtMin(tb.endMin)}`;
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
