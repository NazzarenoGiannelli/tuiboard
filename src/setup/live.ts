/**
 * The real machine behind `collectSetupStatus`: the config, the agent adapters, the file
 * system, the update cache. The dialog and `tuiboard doctor` build their input here.
 */

import { existsSync } from "node:fs";

import { suggestBoardsDir } from "~/boards/suggest";
import { findConfigPath, type Config } from "~/config/loader";
import { AGENT_ADAPTERS } from "~/store/agent-adapters";
import type { AgentSession } from "~/store/agents";
import { herdrBin } from "~/store/herdr";
import { readUpdateCache } from "~/update";
import pkg from "../../package.json";
import type { SetupDeps } from "./status";

export function liveSetupDeps(config: Config, sessions: Pick<AgentSession, "provider" | "lastActivityMs">[]): SetupDeps {
  const found = findConfigPath();
  const cache = readUpdateCache();
  return {
    version: pkg.version,
    configPath: found.exists ? found.path : undefined,
    boardsDir: suggestBoardsDir(config),
    boards: config.boards,
    zones: config.zones,
    calendars: {
      google: config.calendars?.google ? { token: config.calendars.google.token } : undefined,
      microsoft: config.calendars?.microsoft ? { tokenCache: config.calendars.microsoft.tokenCache } : undefined,
    },
    adapters: AGENT_ADAPTERS,
    sessions: [...sessions],
    herdrBin: herdrBin(),
    updateCheckEnabled: config.updateCheck,
    updateCache: cache ? { latest: cache.latest, checkedAt: cache.checkedAt } : undefined,
    exists: existsSync,
  };
}
