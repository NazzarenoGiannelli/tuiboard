/**
 * Where a new board file should be born.
 *
 * The answer that serves the user best is "next to the boards you already
 * have": that is usually a synced, versioned folder — a vault — so a board
 * created here inherits replication, git history and Obsidian rendering
 * without anyone configuring anything.
 *
 * When there is nothing to learn from — no boards yet, or boards scattered
 * across unrelated folders — the fallback is a visible `tuiboard` folder
 * (in Documents when there is one). Someone who installed tuiboard five
 * minutes ago and has no vault still gets a working board.
 *
 * This only ever produces a *proposal*. The path is shown and editable before
 * anything is written, so a wrong guess costs a keystroke, not a lost file.
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Config } from "~/config/loader";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where a new board goes when there is nothing to learn from. A folder the user can
 * find in a file manager, not a hidden one:
 *
 *   1. `$XDG_DATA_HOME/tuiboard/boards` when XDG_DATA_HOME is set (they asked for it);
 *   2. `~/Documents/tuiboard` when `~/Documents` exists;
 *   3. `~/tuiboard`.
 */
export function defaultBoardsDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
  isDir: (path: string) => boolean = isDirectory,
): string {
  const xdg = env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) return join(xdg, "tuiboard", "boards");
  const documents = join(home, "Documents");
  return isDir(documents) ? join(documents, "tuiboard") : join(home, "tuiboard");
}

export function suggestBoardsDir(config: Pick<Config, "boards">): string {
  const dirs = new Set((config.boards ?? []).map((b) => dirname(resolve(b.path))));
  if (dirs.size === 1) return [...dirs][0]!;
  return defaultBoardsDir();
}
