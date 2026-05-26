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
  accent: "#88a7c5",         // soft blue-cyan (active border / brand)
  border: "#3b3f51",          // dim border default
  borderActive: "#88a7c5",   // same as accent

  // Warm accents — Today/Tomorrow identity
  warm: "#d6a06a",           // muted warm peach (today)
  warmActive: "#e0b378",     // slightly brighter when panel is focused
  warmDim: "#8a7458",        // dim version for inactive states

  // Priority emoji colors (kept moderately saturated for visibility)
  highest: "#cf7a6e",        // muted coral
  high: "#d6a06a",           // warm peach (same as today)
  medium: "#c9b67c",         // muted gold
  low: "#9fb98a",            // muted sage

  // Status-based row colors
  overdue: "#c97b6e",        // muted coral red (less alarming than pure red)
  today: "#d6a06a",          // warm peach
  scheduled: "#b39573",      // dimmer warm (future scheduled)
  future: "#6b7089",         // dim

  // Metadata
  assignee: "#9fb98a",
  tag: "#88a7c5",
  time: "#a99ac7",

  // Banner colors
  bannerInfo: "#88a7c5",
  bannerWarn: "#d6a06a",
  bannerError: "#c97b6e",
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
