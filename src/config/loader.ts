/**
 * Config loader.
 *
 * Looks for `.tuiboard/config.yaml` in cwd and walks up to the filesystem
 * root. Returns a normalized `Config` with sane defaults if not found.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as YAML from "js-yaml";

export interface BoardConfig {
  /** Path to the .md file, absolute or relative to the config directory. */
  path: string;
  /** Display name. Defaults to filename without extension. */
  name?: string;
}

export interface Config {
  /** Directory containing `.tuiboard/config.yaml`, or cwd if no config found. */
  root: string;
  /** True if a config file was actually loaded. */
  loaded: boolean;
  boards: BoardConfig[];
  assignees: string[];
  doneColumn: string;
  archiveColumn: string;
}

export const DEFAULT_CONFIG: Omit<Config, "root" | "loaded" | "boards"> = {
  assignees: [],
  doneColumn: "Done",
  archiveColumn: "Archive",
};

/**
 * Columns that exist in the markdown model but are never rendered in the
 * board view: the Done column (completed-work log) and the Archive column.
 * Their tasks stay in the file; the board just doesn't show them.
 */
export function isHiddenColumn(config: Config, columnName: string): boolean {
  return columnName === config.doneColumn || columnName === config.archiveColumn;
}

export interface LoadConfigOptions {
  /** Starting directory for upward search. Defaults to process.cwd(). */
  startDir?: string;
}

export function loadConfig({ startDir }: LoadConfigOptions = {}): Config {
  const start = resolve(startDir ?? process.cwd());
  const found = findConfigFile(start);

  if (found) {
    const raw = readFileSync(found.path, "utf-8");
    const data = (YAML.load(raw) ?? {}) as Partial<RawConfig>;
    return normalize(data, found.dir, true);
  }

  // Fallback: scan cwd for .md files containing tasks.
  return normalize({ boards: scanFallbackBoards(start) }, start, false);
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RawConfig {
  boards: Array<string | BoardConfig>;
  assignees: string[];
  done_column: string;
  archive_column: string;
}

interface FoundConfig {
  path: string;
  dir: string;
}

function findConfigFile(start: string): FoundConfig | undefined {
  let dir = start;
  // Hard guard against infinite loops on weird FS.
  for (let i = 0; i < 64; i++) {
    const candidate = join(dir, ".tuiboard", "config.yaml");
    if (existsSync(candidate)) return { path: candidate, dir };
    const altCandidate = join(dir, ".tuiboard", "config.yml");
    if (existsSync(altCandidate)) return { path: altCandidate, dir };
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function normalize(raw: Partial<RawConfig>, root: string, loaded: boolean): Config {
  const boards: BoardConfig[] = (raw.boards ?? []).map((entry) => {
    if (typeof entry === "string") return { path: entry };
    return entry;
  });

  // Resolve paths relative to config root.
  for (const b of boards) {
    if (!isAbsolute(b.path)) b.path = resolve(root, b.path);
  }

  return {
    root,
    loaded,
    boards,
    assignees: raw.assignees ?? DEFAULT_CONFIG.assignees,
    doneColumn: raw.done_column ?? DEFAULT_CONFIG.doneColumn,
    archiveColumn: raw.archive_column ?? DEFAULT_CONFIG.archiveColumn,
  };
}

function scanFallbackBoards(dir: string): BoardConfig[] {
  try {
    const entries = readdirSync(dir);
    return entries
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f))
      .filter((p) => {
        try {
          if (!statSync(p).isFile()) return false;
          const head = readFileSync(p, "utf-8").slice(0, 4096);
          return /^- \[[ xX]\] /m.test(head);
        } catch {
          return false;
        }
      })
      .map((path) => ({ path }));
  } catch {
    return [];
  }
}
