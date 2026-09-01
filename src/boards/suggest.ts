/**
 * Where a new board file should be born.
 *
 * The answer that serves the user best is "next to the boards you already
 * have": that is usually a synced, versioned folder — a vault — so a board
 * created here inherits replication, git history and Obsidian rendering
 * without anyone configuring anything.
 *
 * When there is nothing to learn from — no boards yet, or boards scattered
 * across unrelated folders — the fallback is an XDG data directory the app
 * owns. Someone who installed tuiboard five minutes ago and has no vault
 * still gets a working board.
 *
 * This only ever produces a *proposal*. The path is shown and editable before
 * anything is written, so a wrong guess costs a keystroke, not a lost file.
 */

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Config } from "~/config/loader";

/** The app-owned directory, honouring XDG_DATA_HOME when set. */
export function defaultBoardsDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), ".local", "share");
  return join(base, "tuiboard", "boards");
}

export function suggestBoardsDir(config: Pick<Config, "boards">): string {
  const dirs = new Set((config.boards ?? []).map((b) => dirname(resolve(b.path))));
  if (dirs.size === 1) return [...dirs][0]!;
  return defaultBoardsDir();
}
