/**
 * The rows of a block drawn as a box, like every other panel: a rounded border with
 * the time set into the top edge, `╭─┤ 09:00-09:30 ├────╮`.
 *
 * The grid is a ruler, so the top edge sits ON the row of the block's start and the
 * bottom edge on the row of its end: the physical edge of the box lines up with the
 * hour lines. Two blocks that touch share the line between them (`├─┤ … ├───┤`).
 *
 * Pure, and exact to the cell: every row comes out exactly `width` cells wide, so
 * the right-hand corner lands where the lane ends. Emoji count as two cells.
 */

import { cellWidth } from "~/ui/glyphs";

/** A run of text and the role it plays, so the view can colour it. */
export interface Seg {
  text: string;
  role: "border" | "label" | "text" | "pad" | "handle";
}

export const segsWidth = (segs: Seg[]): number => segs.reduce((n, s) => n + cellWidth(s.text), 0);

/** Cut `s` to at most `max` cells, ending in an ellipsis when something was dropped. */
export function fit(s: string, max: number): string {
  if (max <= 0) return "";
  if (cellWidth(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (cellWidth(out + ch) > max - 1) break;
    out += ch;
  }
  return out + "…";
}

/** `╭─┤ label ├──────╮` — or `├─┤ label ├──────┤` when it continues the block above. */
export function boxTop(label: string, width: number, joined: boolean): Seg[] {
  const l = fit(label, Math.max(1, width - 7));
  const fill = Math.max(0, width - 4 - cellWidth(l) - 2 - 1);
  return [
    { text: joined ? "├─┤ " : "╭─┤ ", role: "border" },
    { text: l, role: "label" },
    { text: " ├" + "─".repeat(fill) + (joined ? "┤" : "╮"), role: "border" },
  ];
}

/** `│ text          │`. `lead` (a tick, say) is drawn before the text and counts in the width. */
export function boxBody(text: string, width: number, lead = ""): Seg[] {
  const inner = Math.max(0, width - 4);
  const l = fit(lead, inner);
  const t = fit(text, inner - cellWidth(l));
  const pad = Math.max(0, inner - cellWidth(l) - cellWidth(t));
  return [
    { text: "│ ", role: "border" },
    ...(l ? [{ text: l, role: "handle" as const }] : []),
    { text: t, role: "text" },
    { text: " ".repeat(pad), role: "pad" },
    { text: " │", role: "border" },
  ];
}

/** `╰──────╯` — armed, `╰━ ↕ ━━━━╯`: the bottom edge is the handle that resizes the block. */
export function boxBottom(width: number, armed: boolean): Seg[] {
  if (!armed) return [{ text: "╰" + "─".repeat(Math.max(0, width - 2)) + "╯", role: "border" }];
  const grip = "━ ↕ ";
  return [
    { text: "╰", role: "border" },
    { text: grip, role: "handle" },
    { text: "━".repeat(Math.max(0, width - 2 - cellWidth(grip))) + "╯", role: "handle" },
  ];
}
