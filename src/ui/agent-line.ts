/**
 * Width-aware text layout for AgentRow. Pure (no JSX) so it's unit-testable.
 *
 * OpenTUI's own `truncate` elides in the MIDDLE of a text run, which mangles a
 * row made of several fields ("Review the harn...badge-23 gpt-5.5…"). We fit
 * the fields ourselves, dropping the least important ones first and always
 * cutting at the tail.
 */

import { cellWidth } from "~/ui/glyphs";

/** "▶ " + "● " + "cc " — cursor, status glyph, harness badge. */
export const LEAD_CELLS = 7;
/** Row box paddingLeft + paddingRight. */
const ROW_PADDING = 2;
/** Cells kept free for width-measurement drift (same margin as zoomed TaskRow). */
const DRIFT_MARGIN = 2;
const GAP = "  ";

/** Cut `s` to at most `max` cells, ending in "…" when cut. */
export function fitCells(s: string, max: number): string {
  if (max <= 0) return "";
  if (cellWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = cellWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export interface LineFields {
  name: string;
  branch?: string;
  model?: string;
  /** Right-pinned, e.g. "…Repos/Personal/tuiboard". */
  cwd: string;
  /** Right-pinned, already padded, e.g. " 3m". */
  age: string;
}

export interface LineLayout {
  name: string;
  branch?: string;
  model?: string;
  /** Right-pinned text, empty cwd when there's no room for it. */
  right: string;
}

/** Below this many cells for the name, the cwd gives way first. */
const MIN_NAME_CELLS = 16;

/**
 * Fit a one-line row into `width` cells (the row box's full width).
 * Drop order when space runs out: model, then branch (a short model still
 * shows if only a long branch doesn't fit), then cwd; the name is shortened
 * last. Unknown width (not measured yet) → everything, uncut.
 */
export function layoutLine(f: LineFields, width: number | undefined): LineLayout {
  if (!width) return { name: f.name, branch: f.branch, model: f.model, right: `${f.cwd}${GAP}${f.age}` };
  const inner = width - ROW_PADDING - DRIFT_MARGIN - LEAD_CELLS;

  let right = `${f.cwd}${GAP}${f.age}`;
  if (inner - cellWidth(right) - cellWidth(GAP) < MIN_NAME_CELLS) right = f.age;
  const budget = inner - cellWidth(right) - cellWidth(GAP);

  const extras = (b?: string, m?: string) =>
    (b ? cellWidth(GAP + b) : 0) + (m ? cellWidth(GAP + m) : 0);
  const nameW = cellWidth(f.name);
  for (const [b, m] of [
    [f.branch, f.model],
    [f.branch, undefined],
    [undefined, f.model],
    [undefined, undefined],
  ] as const) {
    if (nameW + extras(b, m) <= budget) return { name: f.name, branch: b, model: m, right };
  }
  return { name: fitCells(f.name, budget), right };
}

/** Fit the card's detail line (`model · branch · cwd`) with a tail cut. */
export function layoutCardDetails(parts: (string | undefined)[], width: number | undefined): string {
  const text = parts.filter((p): p is string => Boolean(p)).join("  ·  ");
  if (!width) return text;
  return fitCells(text, width - ROW_PADDING - DRIFT_MARGIN - LEAD_CELLS);
}

/** Fit the card's title (the age takes GAP + 3 cells on the right). */
export function layoutCardName(name: string, width: number | undefined): string {
  if (!width) return name;
  return fitCells(name, width - ROW_PADDING - DRIFT_MARGIN - LEAD_CELLS - cellWidth(GAP) - 3);
}
