/** Centralized glyph + color tokens for the UI. */

import { TextAttributes } from "@opentui/core";

export const ATTR = {
  bold: TextAttributes.BOLD,
  dim: TextAttributes.DIM,
  italic: TextAttributes.ITALIC,
  underline: TextAttributes.UNDERLINE,
} as const;

/**
 * Theme tokens.
 *
 * Foreground colors use ANSI names (`"red"`, `"yellow"`, `"brightBlack"`,
 * …) so they pick up the user's configured terminal palette. The terminal
 * theme — Nord, Tokyo Night, Gruvbox, Solarized, whatever — decides what
 * those names look like.
 *
 * Backgrounds are mostly `undefined` (transparent → terminal default).
 * The only opaque backgrounds we paint are the cursor row highlight and
 * the banner row.
 */
/**
 * Palette philosophy:
 *
 *  - Backgrounds stay transparent so the terminal theme bleeds through.
 *  - The few accent colors are *muted hex* (mid-saturation, mid-luminance)
 *    instead of raw ANSI names like "red"/"yellow" — those tend to render
 *    as fully-saturated traffic-light colors in most themes and clash
 *    with everything around them.
 *  - The Today/Tomorrow virtual panel has its own *warm* identity
 *    (peach/orange) so the user instantly knows "this is the time zone";
 *    everything else uses a *cool* identity (soft cyan) for active focus.
 *  - Cursor row highlight is the only opaque paint outside the modal.
 */
export const T = {
  // Backgrounds
  bg: undefined as string | undefined,
  panelBg: undefined as string | undefined,
  panelBgActive: undefined as string | undefined,
  cardBg: undefined as string | undefined,
  cardBgDone: undefined as string | undefined,
  cardBgCursor: "#2a2f3c",

  // Foreground neutrals — ANSI-named, respect terminal theme
  text: undefined as string | undefined,    // terminal default fg
  textDim: "#6b7089",
  textDone: "#4a4f63",

  // Cool accents — used for active board columns and generic focus
  accent: "#7eb6d6",         // clearer blue-cyan, hue ~200°
  border: "#3b3f51",          // dim border default
  borderActive: "#7eb6d6",   // same as accent

  // Warm accents — Today/Tomorrow identity (hue ~30°)
  warm: "#e8a05c",           // clear warm orange, distinct from red
  warmActive: "#f2b272",     // brighter peach when panel is focused
  warmDim: "#a07a52",        // dim version for tomorrow header

  // Priority emoji colors
  highest: "#e26a6a",        // clearly red (hue 0°)
  high: "#e8a05c",           // warm orange (same as today)
  medium: "#d8c074",         // gold (hue 50°)
  low: "#a4c98a",            // sage (hue 95°)

  // Status-based row colors — kept clearly distinct in hue + brightness
  overdue: "#e26a6a",        // hue 0°, sat 65%, light 65% — clearly red
  today: "#e8a05c",          // hue 30°, sat 75%, light 64% — clearly orange
  scheduled: "#c89a6a",      // dimmer warm for non-today future
  future: "#6b7089",

  // Metadata
  assignee: "#a4c98a",
  tag: "#7eb6d6",
  time: "#b3a3d8",

  // Banner colors
  bannerInfo: "#7eb6d6",
  bannerWarn: "#e8a05c",
  bannerError: "#e26a6a",
} as const;

export const PRIORITY_GLYPH: Record<string, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
  none: "",
};

export const PRIORITY_COLOR: Record<string, string | undefined> = {
  highest: T.highest,
  high: T.high,
  medium: T.medium,
  low: T.low,
  lowest: T.low,
  none: T.text,
};

export function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
