/**
 * Write a new board file.
 *
 * The file is a plain Obsidian Kanban board: YAML frontmatter carrying
 * `kanban-plugin: board`, then one `## Column` heading per column. Those two
 * frontmatter lines are what make Obsidian render the file as a board instead
 * of as a wall of text — which matters because these files are read on a
 * phone as often as in this program.
 *
 * No `%% kanban:settings %%` trailer is written. Obsidian adds its own on the
 * first setting change, and inventing one here would mean guessing at a
 * format this project does not control.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CreateBoardOptions {
  /** Column headings, in order. At least one.  */
  columns: readonly string[];
}

/** Columns offered when the caller has no opinion. */
export const DEFAULT_COLUMNS = ["Todo", "Doing", "Done"] as const;

export function createBoardFile(path: string, { columns }: CreateBoardOptions): void {
  const names = columns.map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) {
    // A board with no columns has nowhere to put a task, and the TUI cannot
    // yet add one. Refusing here beats handing back something unusable.
    throw new Error("a board needs at least one column");
  }

  // Never overwrite: the target may be a file someone else wrote, and the
  // caller's next best move — adopting it instead — is only possible if it
  // still exists.
  if (existsSync(path)) {
    throw new Error(`${path} already exists`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render(names), "utf-8");
}

/**
 * The blank-line placement matches what Obsidian Kanban itself writes, so a
 * board created here and one created there are the same document.
 */
function render(columns: readonly string[]): string {
  const frontmatter = ["---", "", "kanban-plugin: board", "", "---", ""].join("\n");
  const body = columns.map((name) => `\n## ${name}\n`).join("");
  // The trailing blank line is what `serializeBoard` produces for a board
  // whose last column is empty. Matching it means a file created here and the
  // same file after tuiboard writes to it are byte-identical — so a fresh
  // board never shows up as a spurious diff in the vault's git history.
  return `${frontmatter}${body}\n`;
}
