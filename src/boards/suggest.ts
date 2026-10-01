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
import { basename, dirname, join, resolve } from "node:path";

import type { Config } from "~/config/loader";

/**
 * The home folder, the way Node's `os.homedir()` resolves it: `USERPROFILE` on Windows,
 * `HOME` everywhere else, and the system lookup only when that variable is unset or empty.
 * Bun's own `os.homedir()` on Linux reads the account database and ignores a `HOME` set
 * after startup, so anything that redirects the home folder (tests, a wrapper script)
 * would silently be ignored. Every home lookup in the first-run feature goes through here.
 */
export function userHome(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  fallback: () => string = homedir,
): string {
  const fromEnv = platform === "win32" ? env.USERPROFILE : env.HOME;
  return fromEnv ? fromEnv : fallback();
}

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
  home: string = userHome(),
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

/** `~` is what people type; node's fs does not know it. Accepts both separators after it. */
export function expandHomePath(p: string, home: string = userHome()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

export type BoardTarget =
  | { ok: true; name: string; dir?: string }
  | { ok: false; error: string };

/**
 * What the wizard's name field holds. A plain name is just a name and the proposed
 * folder stands. A value with a path separator, or ending in `.md`, is a path: `~` is
 * expanded, it is resolved, its folder becomes the board's folder and its last part
 * (without `.md`) the board's name. A bare `Work.md` has no folder in it, so it only
 * loses its extension: guessing the working folder would put the file somewhere the
 * user never looked.
 */
export function parseBoardTarget(input: string, home: string = userHome()): BoardTarget {
  const value = input.trim();
  const hasSeparator = /[\\/]/.test(value);
  const hasExt = /\.md$/i.test(value);
  if (!hasSeparator && !hasExt) return { ok: true, name: value };

  const stripped = (n: string) => n.replace(/\.md$/i, "").trim();
  if (!hasSeparator) {
    const name = stripped(value);
    return name ? { ok: true, name } : { ok: false, error: "the board needs a name" };
  }
  const full = resolve(expandHomePath(value, home));
  const name = /[\\/]$/.test(value) ? "" : stripped(basename(full));
  if (!name) return { ok: false, error: "that path has no board name in it, e.g. ~/notes/Work" };
  return { ok: true, dir: dirname(full), name };
}
