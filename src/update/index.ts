/**
 * Starts the update notice: a quiet background check that, when a newer tuiboard is
 * on npm, hands one short line to `announce` (the app shows it as a toast). The
 * decisions live in ./check.ts; this file only connects them to the real network,
 * cache file, clock and environment.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkForUpdate,
  fetchLatestVersion,
  installKind,
  updateCheckDisabled,
  upgradeHint,
  type UpdateCache,
} from "./check";

const CACHE_FILE = join(homedir(), ".cache", "tuiboard", "update.json");

/** The last answer of the update check, or undefined when there is none. Read-only: for Setup and `doctor`. */
export function readUpdateCache(): UpdateCache | undefined {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Partial<UpdateCache>;
    if (typeof raw.checkedAt === "number" && typeof raw.latest === "string") {
      return { checkedAt: raw.checkedAt, latest: raw.latest, notifiedFor: typeof raw.notifiedFor === "string" ? raw.notifiedFor : undefined };
    }
  } catch {
    // no file, or one we cannot read: as if there were none
  }
  return undefined;
}

function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // a cache we cannot write only means we ask again next time
  }
}

/** How long after launch to look, so the check never competes with the first paint. */
const START_DELAY_MS = 1500;

export function startUpdateCheck(opts: {
  current: string;
  /** `update_check: off` in the config. */
  configOff: boolean;
  /** Called with the line to show, only when there is something to say. */
  announce: (text: string) => void;
}): void {
  if (updateCheckDisabled({ configOff: opts.configOff, env: process.env, stdout: process.stdout })) return;
  const timer = setTimeout(() => {
    void checkForUpdate({
      current: opts.current,
      now: Date.now(),
      readCache: readUpdateCache,
      writeCache,
      fetchLatest: () => fetchLatestVersion(),
    })
      .then((latest) => {
        if (!latest) return;
        const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
        opts.announce(`tuiboard ${latest} is out · ${upgradeHint(installKind(root, existsSync))}`);
      })
      .catch(() => {});
  }, START_DELAY_MS);
  timer.unref?.();
}
