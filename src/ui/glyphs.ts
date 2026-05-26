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
export const T = {
  // Transparent — inherit terminal background.
  bg: undefined as string | undefined,
  panelBg: undefined as string | undefined,
  panelBgActive: undefined as string | undefined,
  cardBg: undefined as string | undefined,
  cardBgDone: undefined as string | undefined,
  /** Cursor row highlight — uses inverted/highlight via "brightBlack" terminal color. */
  cardBgCursor: "brightBlack",

  // Foreground (ANSI-named → respects terminal theme)
  text: undefined as string | undefined,    // default terminal fg
  textDim: "brightBlack",
  textDone: "brightBlack",
  accent: "cyan",
  border: "brightBlack",
  borderActive: "cyan",

  // Priority
  highest: "red",
  high: "yellow",
  medium: "yellow",
  low: "green",

  // Status-based colors
  overdue: "red",
  today: "yellow",
  scheduled: "yellow",
  future: "brightBlack",

  // Metadata
  assignee: "green",
  tag: "cyan",
  time: "magenta",

  // Banner colors
  bannerInfo: "cyan",
  bannerWarn: "yellow",
  bannerError: "red",
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
