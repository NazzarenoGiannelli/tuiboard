/**
 * Config loader.
 *
 * Resolution order (first hit wins):
 *   1. $TUIBOARD_CONFIG — explicit path to a config file.
 *   2. Project-local — `.tuiboard/config.(yaml|yml)` in cwd, walking up.
 *   3. Global — `~/.config/tuiboard/config.(yaml|yml)` or `~/.tuiboard/…`.
 *   4. Fallback — scan cwd for `.md` files containing tasks.
 *
 * The global step is what lets `tuiboard` run from ANY directory and still
 * show your boards: drop one config in your home dir (with absolute board
 * paths) and it's found regardless of cwd. A project-local config still wins
 * when you're inside a project that has its own.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
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
  /**
   * Optional override for "open the selected agent session" (Enter in the
   * agents zone). An argv array; the tokens `{cwd}` and `{sessionId}` are
   * substituted, then it's spawned directly (no shell). Point it at your own
   * script to launch a custom terminal layout — e.g.
   *   ["pwsh", "-NoProfile", "-File", "C:/.../code-resume.ps1", "{cwd}", "{sessionId}"]
   * When unset, tuiboard falls back to opening a tab + `claude --resume <id>`.
   */
  resumeCommand?: string[];
  /**
   * Optional read-only calendar feeds merged into the Agenda (timeline) zone.
   * Paths support `~` and are resolved against the config dir if relative.
   * Tokens are produced by `tuiboard calendar-setup`.
   */
  calendars?: CalendarsConfig;
}

export interface GoogleCalendarConfig {
  enabled?: boolean;
  /** Path to the google_token.json authorized-user file. */
  token: string;
  /** Path to the OAuth client google_credentials.json (used by setup only). */
  credentials?: string;
  /** Fallback color when a calendar has none of its own. */
  color?: string;
}

export interface MicrosoftCalendarConfig {
  enabled?: boolean;
  /** Path to azure_config.json ({ client_id, authority }). */
  config: string;
  /** Path to the MSAL serialized ms_token_cache.json. */
  tokenCache: string;
  color?: string;
}

export interface CalendarsConfig {
  google?: GoogleCalendarConfig;
  microsoft?: MicrosoftCalendarConfig;
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

  const found =
    findEnvConfigFile() ?? // 1. $TUIBOARD_CONFIG
    findConfigFile(start) ?? // 2. project-local, walking up from cwd
    findGlobalConfigFile(); // 3. ~/.config/tuiboard or ~/.tuiboard

  if (found) {
    const raw = readFileSync(found.path, "utf-8");
    const data = (YAML.load(raw) ?? {}) as Partial<RawConfig>;
    return normalize(data, found.dir, true);
  }

  // 4. Fallback: scan cwd for .md files containing tasks.
  return normalize({ boards: scanFallbackBoards(start) }, start, false);
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RawConfig {
  boards: Array<string | BoardConfig>;
  assignees: string[];
  done_column: string;
  archive_column: string;
  resume_command: string[];
  calendars: {
    google?: {
      enabled?: boolean;
      token?: string;
      credentials?: string;
      color?: string;
    };
    microsoft?: {
      enabled?: boolean;
      config?: string;
      token_cache?: string;
      color?: string;
    };
  };
}

/** Expand `~` to the home dir; resolve relative paths against the config dir. */
function expandPath(p: string, root: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return isAbsolute(p) ? p : resolve(root, p);
}

function normalizeCalendars(
  raw: RawConfig["calendars"] | undefined,
  root: string,
): CalendarsConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: CalendarsConfig = {};
  const g = raw.google;
  if (g && g.token) {
    out.google = {
      enabled: g.enabled !== false,
      token: expandPath(g.token, root),
      credentials: g.credentials ? expandPath(g.credentials, root) : undefined,
      color: g.color,
    };
  }
  const m = raw.microsoft;
  if (m && m.config && m.token_cache) {
    out.microsoft = {
      enabled: m.enabled !== false,
      config: expandPath(m.config, root),
      tokenCache: expandPath(m.token_cache, root),
      color: m.color,
    };
  }
  return out.google || out.microsoft ? out : undefined;
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

/** Explicit config path via $TUIBOARD_CONFIG (points at the file itself). */
function findEnvConfigFile(): FoundConfig | undefined {
  const envPath = process.env.TUIBOARD_CONFIG;
  if (!envPath) return undefined;
  const abs = resolve(envPath);
  return existsSync(abs) ? { path: abs, dir: dirname(abs) } : undefined;
}

/** User-global config in the home dir — found regardless of cwd. */
function findGlobalConfigFile(): FoundConfig | undefined {
  const home = homedir();
  const candidates = [
    join(home, ".config", "tuiboard", "config.yaml"),
    join(home, ".config", "tuiboard", "config.yml"),
    join(home, ".tuiboard", "config.yaml"),
    join(home, ".tuiboard", "config.yml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, dir: dirname(candidate) };
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
    resumeCommand:
      Array.isArray(raw.resume_command) && raw.resume_command.length > 0
        ? raw.resume_command.map(String)
        : undefined,
    calendars: normalizeCalendars(raw.calendars, root),
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
