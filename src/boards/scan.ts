/**
 * Find the boards already sitting in a directory.
 *
 * This is what the "I already have files" path of onboarding offers: point at
 * a folder, and see which of its markdown files are actually task boards.
 *
 * The recognition rule is deliberately the same one `loadConfig()` uses for
 * its zero-config fallback — a `.md` file containing a `- [ ]` or `- [x]`
 * line. Two rules would mean a file adopted by one path and ignored by the
 * other, so the loader delegates here rather than keeping its own copy.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

/** How much of a file is read to decide whether it is a board. */
const SNIFF_BYTES = 4096;

const RE_TASK = /^- \[[ xX]\] /m;
const RE_TASK_GLOBAL = /^- \[[ xX]\] /gm;

export interface BoardCandidate {
  /** Absolute path to the markdown file. */
  path: string;
  /** Filename without extension — what the board would be called. */
  suggestedName: string;
  /** Tasks found in the file, open and done. */
  taskCount: number;
  /** True when this file is already registered as a board. */
  alreadyInConfig: boolean;
}

export interface ScanOptions {
  /** Board paths already registered, so candidates can be marked. */
  existingPaths?: readonly string[];
}

/** True when the file looks like a task board: markdown holding checkboxes. */
export function isBoardFile(path: string): boolean {
  if (extname(path).toLowerCase() !== ".md") return false;
  try {
    if (!statSync(path).isFile()) return false;
    return RE_TASK.test(readFileSync(path, "utf-8").slice(0, SNIFF_BYTES));
  } catch {
    return false;
  }
}

/**
 * List the board files in `dir`, sorted by name.
 *
 * A missing or unreadable directory yields an empty list rather than an
 * error: onboarding asks the user to type a path, and a typo should redraw
 * the screen with "nothing here", not end the session.
 */
export function scanDirectory(dir: string, { existingPaths = [] }: ScanOptions = {}): BoardCandidate[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const known = new Set(existingPaths.map((p) => resolve(p)));

  return entries
    .map((name) => join(dir, name))
    .filter(isBoardFile)
    .sort()
    .map((path) => ({
      path,
      suggestedName: basename(path, extname(path)),
      taskCount: countTasks(path),
      alreadyInConfig: known.has(resolve(path)),
    }));
}

/** Tasks in the whole file — the sniff window is only for recognition. */
function countTasks(path: string): number {
  try {
    return readFileSync(path, "utf-8").match(RE_TASK_GLOBAL)?.length ?? 0;
  } catch {
    return 0;
  }
}
