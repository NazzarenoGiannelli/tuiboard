/** Centralized glyph + color tokens for the UI. */

import { TextAttributes } from "@opentui/core";

export const ATTR = {
  bold: TextAttributes.BOLD,
  dim: TextAttributes.DIM,
  italic: TextAttributes.ITALIC,
  underline: TextAttributes.UNDERLINE,
} as const;

export const T = {
  bg: "#16161e",
  panelBg: "#1f2335",
  panelBgActive: "#24283b",
  cardBg: "#292e42",
  cardBgDone: "#1a1b26",
  cardBgCursor: "#414868",
  border: "#414868",
  borderActive: "#7aa2f7",
  text: "#c0caf5",
  textDim: "#737aa2",
  textDone: "#565f89",
  accent: "#7aa2f7",
  highest: "#f7768e",
  high: "#ff9e64",
  medium: "#e0af68",
  low: "#9ece6a",
  scheduled: "#e0af68",
  overdue: "#f7768e",
  assignee: "#9ece6a",
  tag: "#7dcfff",
  time: "#bb9af7",
  bannerInfo: "#7aa2f7",
  bannerWarn: "#e0af68",
  bannerError: "#f7768e",
} as const;

export const PRIORITY_GLYPH: Record<string, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
  none: "",
};

export const PRIORITY_COLOR: Record<string, string> = {
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
