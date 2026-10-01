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
  /**
   * Task lines to start the board with, written under the first column that is not
   * Done or Archive (the first column when every column is one of those).
   */
  examples?: readonly string[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/**
 * A few tasks that teach by doing. All dated today; one carries a 30-minute time block
 * so the Agenda has something in it. The block starts at the next half hour that is at
 * least 10 minutes away; after 22:30 that would be too late to be useful, so it becomes
 * 09:00 to 09:30 tomorrow.
 */
export function exampleTasks(now: Date = new Date()): string[] {
  const today = isoDate(now);
  let start = Math.ceil((now.getHours() * 60 + now.getMinutes() + 10) / 30) * 30;
  let blockDay = today;
  if (start > 22 * 60 + 30) {
    start = 9 * 60;
    blockDay = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }
  return [
    `- [ ] Press n to add a task of your own ⏳ ${today}`,
    `- [ ] Press Enter on a task to tick it off ⏳ ${today}`,
    `- [ ] Press b to give a task an hour, then look at the Agenda ⌚ ${hm(start)}-${hm(start + 30)} ⏳ ${blockDay}`,
    `- [ ] Press ? for every key, and d to delete these examples ⏳ ${today}`,
  ];
}

const HIDDEN = new Set(["done", "archive"]);

function exampleColumn(names: readonly string[]): number {
  const i = names.findIndex((n) => !HIDDEN.has(n.trim().toLowerCase()));
  return i === -1 ? 0 : i;
}

/** Columns offered when the caller has no opinion. */
export const DEFAULT_COLUMNS = ["Todo", "Doing", "Done"] as const;

export function createBoardFile(path: string, options: CreateBoardOptions): void {
  const { columns } = options;
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
  writeFileSync(path, render(names, options.examples ?? []), "utf-8");
}

/**
 * The blank-line placement matches what Obsidian Kanban itself writes, so a
 * board created here and one created there are the same document.
 */
function render(columns: readonly string[], examples: readonly string[]): string {
  const frontmatter = ["---", "", "kanban-plugin: board", "", "---", ""].join("\n");
  const target = examples.length > 0 ? exampleColumn(columns) : -1;
  const body = columns
    .map((name, i) => (i === target ? `\n## ${name}\n\n${examples.join("\n")}\n` : `\n## ${name}\n`))
    .join("");
  // The trailing blank line is what `serializeBoard` produces for a board
  // whose last column is empty. Matching it means a file created here and the
  // same file after tuiboard writes to it are byte-identical — so a fresh
  // board never shows up as a spurious diff in the vault's git history.
  return `${frontmatter}${body}\n`;
}
