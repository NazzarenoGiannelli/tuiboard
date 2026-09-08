/**
 * Task notes: finding the file a task's link points at, and reading it.
 *
 * The convention is tuiboard's own, not Obsidian's: a task's note is the link
 * that wraps its title, written either way —
 *
 *     - [ ] [[Nome nota|Titolo mostrato]]        wiki style
 *     - [ ] [Titolo mostrato](Tasks/Nome.md)     plain markdown
 *
 * The second form is how any markdown document links another, so a board that
 * has never heard of wikilinks gets the feature too. The parser decides which
 * link qualifies (see `titleNoteLink`); this module only turns it into a file.
 *
 * Pure except for the filesystem reads it exists to perform: no store, no
 * renderer, testable against a temp directory.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

import type { TaskNoteLink } from "~/types";

/** Directories never worth walking for notes. */
const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash", ".stversions"]);

/** How deep the scan goes. Deeper than any sane note layout, shallow enough to end. */
const MAX_DEPTH = 8;

/** Note name (lowercased, without extension) → every file carrying that name. */
export type NoteIndex = Record<string, string[]>;

export interface ResolvedNote {
  path: string;
  /** Same-named files that lost to the winner, nearest-first. Absent when unique. */
  shadowed?: string[];
}

export interface MissingNote {
  missing: string;
}

/**
 * Index every markdown file under `root`, by name.
 *
 * Obsidian resolves `[[Name]]` by name rather than by path, and notes written
 * by hand rely on that, so tuiboard does the same instead of demanding paths.
 * A missing or unreadable directory yields an empty index rather than an
 * error: a broken note link must never stop the board from opening.
 */
export function buildNoteIndex(root: string): NoteIndex {
  const index: NoteIndex = {};

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && SKIP_DIRS.has(entry)) continue;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
      } else if (extname(entry).toLowerCase() === ".md") {
        const key = noteKey(entry);
        (index[key] ??= []).push(full);
      }
    }
  };

  walk(resolve(root), 0);
  return index;
}

/** The name a link and a filename are compared by: no extension, no case. */
function noteKey(name: string): string {
  return basename(name, extname(name)).trim().toLowerCase();
}

/**
 * Turn a task's link into a file.
 *
 * A `path` link is a real path and resolves against the board that carries the
 * task — the same way a relative link works in any markdown document. A
 * `wikilink` is only a name, so it goes through the index.
 *
 * When several files share a name the nearest to the board wins, and the ones
 * it shadowed are returned: proximity is a guess, and a guess should be
 * visible rather than silently applied.
 */
export function resolveNote(
  link: TaskNoteLink,
  { index, boardPath }: { index: NoteIndex; boardPath: string },
): ResolvedNote | MissingNote {
  const boardDir = dirname(resolve(boardPath));

  if (link.kind === "path") {
    const path = resolve(boardDir, link.target);
    try {
      if (statSync(path).isFile()) return { path };
    } catch {
      /* fall through to missing */
    }
    return { missing: link.target };
  }

  const hits = index[noteKey(link.target)];
  if (!hits || hits.length === 0) return { missing: link.target };

  const ranked = [...hits].sort((a, b) => distanceFrom(boardDir, a) - distanceFrom(boardDir, b));
  const [winner, ...rest] = ranked;
  return rest.length > 0 ? { path: winner!, shadowed: rest } : { path: winner! };
}

/** How far a file sits from a directory, in path segments. Lower is nearer. */
function distanceFrom(dir: string, file: string): number {
  const from = dir.split(sep).filter(Boolean);
  const to = dirname(file).split(sep).filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return from.length - common + (to.length - common);
}

/**
 * The note's text, without its frontmatter — that is configuration, and the
 * detail view is showing context.
 *
 * Throws when the file cannot be read: the caller has a frame to put the
 * message in, and swallowing it would show an empty note instead of a reason.
 */
export function readNoteBody(path: string): string {
  const raw = readFileSync(path, "utf-8");
  const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return withoutFrontmatter.trim();
}
