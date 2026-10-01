/**
 * What is set up, in one place. The Setup dialog (`S`) and `tuiboard doctor` both show
 * this, so they cannot disagree. Pure: every fact about the machine (files, adapters,
 * sessions, the update cache) is passed in, so it is tested without a machine.
 */

import { basename, extname } from "node:path";

import type { ZoneMode } from "~/config/loader";
import { HARNESS, type AgentProvider } from "~/store/agents";

export interface SetupStatus {
  version: string;
  paths: { config: string | undefined; boardsDir: string };
  boards: { name: string; path: string; exists: boolean }[];
  agents: { provider: AgentProvider; label: string; found: boolean; sessions: number; lastActivityMs?: number }[];
  herdr: { installed: boolean };
  calendars: { provider: "google" | "microsoft"; label: string; connected: boolean; hint: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  updates: { enabled: boolean; latest?: string; checkedAt?: number };
}

export interface SetupDeps {
  version: string;
  /** The config file in use, or undefined when there is none yet. */
  configPath: string | undefined;
  boardsDir: string;
  boards: { name?: string; path: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  calendars: { google?: { token: string }; microsoft?: { tokenCache: string } };
  adapters: { provider: AgentProvider; watchPaths(): string[] }[];
  sessions: { provider: AgentProvider; lastActivityMs: number }[];
  herdrBin: string | undefined;
  updateCheckEnabled: boolean;
  updateCache: { latest?: string; checkedAt?: number } | undefined;
  exists: (path: string) => boolean;
}

function sourceFound(adapter: SetupDeps["adapters"][number], exists: (p: string) => boolean): boolean {
  try {
    return adapter.watchPaths().some((p) => exists(p));
  } catch {
    return false;
  }
}

export function collectSetupStatus(d: SetupDeps): SetupStatus {
  return {
    version: d.version,
    paths: { config: d.configPath, boardsDir: d.boardsDir },
    boards: d.boards.map((b) => ({
      name: b.name ?? basename(b.path, extname(b.path)),
      path: b.path,
      exists: d.exists(b.path),
    })),
    agents: d.adapters.map((a) => {
      const mine = d.sessions.filter((s) => s.provider === a.provider);
      return {
        provider: a.provider,
        label: HARNESS[a.provider].name,
        found: sourceFound(a, d.exists),
        sessions: mine.length,
        lastActivityMs: mine.length ? Math.max(...mine.map((s) => s.lastActivityMs)) : undefined,
      };
    }),
    herdr: { installed: !!d.herdrBin },
    calendars: [
      {
        provider: "google",
        label: "Google Calendar",
        connected: !!d.calendars.google && d.exists(d.calendars.google.token),
        hint: "tuiboard calendar-setup google",
      },
      {
        provider: "microsoft",
        label: "Microsoft 365",
        connected: !!d.calendars.microsoft && d.exists(d.calendars.microsoft.tokenCache),
        hint: "tuiboard calendar-setup microsoft",
      },
    ],
    zones: d.zones,
    updates: { enabled: d.updateCheckEnabled, latest: d.updateCache?.latest, checkedAt: d.updateCache?.checkedAt },
  };
}
