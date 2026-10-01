/**
 * "A newer tuiboard is on npm" — the logic behind the toast shown at startup.
 *
 * It asks the npm registry for the latest version at most once a day, in the
 * background, keeps the answer in a small cache file, and tells the user about a
 * given version only once. Everything that touches the outside world (the
 * network, the cache file, the clock) is passed in, so the rules are testable
 * without any of them.
 *
 * The one request is `GET https://registry.npmjs.org/tuiboard/latest`: no
 * identifier, nothing about the user or their boards. It is on by default and
 * off with `update_check: off` in the config or TUIBOARD_NO_UPDATE_CHECK=1.
 */

export const REGISTRY_URL = "https://registry.npmjs.org/tuiboard/latest";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 3000;

export interface UpdateCache {
  /** When the registry was last asked (ms since the epoch). */
  checkedAt: number;
  /** What it said. */
  latest: string;
  /** The version the user has already been told about. */
  notifiedFor?: string;
}

// ─── Versions ────────────────────────────────────────────────────────────────

/** `[major, minor, patch]`, or undefined when it does not look like a version. */
function parse(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/**
 * -1, 0 or 1. A pre-release suffix is ignored, and anything that is not a version
 * compares equal to everything, so odd input can never produce a notice.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]! ? 1 : -1;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) === 1;
}

// ─── How it was installed, and so what to run ────────────────────────────────

export type InstallKind = "bun-global" | "bunx" | "source" | "unknown";

/**
 * Where the running copy lives tells how it got there. `exists` is the file check
 * (a `.git` folder beside the package means a checkout).
 */
export function installKind(packageRoot: string, exists: (path: string) => boolean): InstallKind {
  const p = packageRoot.replaceAll("\\", "/");
  if (exists(`${p}/.git`)) return "source";
  if (p.includes("/.bun/install/global/")) return "bun-global";
  if (p.includes("/.bun/install/cache/") || /\/bunx-[^/]*tuiboard/.test(p)) return "bunx";
  return "unknown";
}

/**
 * The command that brings it up to date. `--no-cache` because bun's manifest cache
 * can keep answering with the old version for a while after a release.
 */
export function upgradeHint(kind: InstallKind): string {
  switch (kind) {
    case "bunx":
      return "bunx tuiboard@latest";
    case "source":
      return "git pull && bun install";
    default:
      return "bun add -g tuiboard@latest --no-cache";
  }
}

// ─── When to look ────────────────────────────────────────────────────────────

export function shouldCheck(now: number, cache: UpdateCache | undefined, intervalMs: number): boolean {
  if (!cache) return true;
  if (cache.checkedAt > now) return true; // the clock moved back: do not wait for it
  return now - cache.checkedAt >= intervalMs;
}

/** Off by config or environment, and never in CI or without a terminal to show it on. */
export function updateCheckDisabled(opts: {
  configOff: boolean;
  env: Record<string, string | undefined>;
  stdout: { isTTY?: boolean };
}): boolean {
  if (opts.configOff) return true;
  const flag = opts.env.TUIBOARD_NO_UPDATE_CHECK;
  if (flag !== undefined && flag !== "" && flag !== "0") return true;
  if (opts.env.CI) return true;
  return !opts.stdout.isTTY;
}

// ─── The registry ────────────────────────────────────────────────────────────

/** The latest published version, or undefined for any kind of failure. */
export async function fetchLatestVersion(
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(REGISTRY_URL, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && parse(body.version) ? body.version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Putting it together ─────────────────────────────────────────────────────

export interface CheckDeps {
  current: string;
  now: number;
  intervalMs?: number;
  readCache: () => UpdateCache | undefined;
  writeCache: (cache: UpdateCache) => void;
  fetchLatest: () => Promise<string | undefined>;
}

/**
 * The version to tell the user about, or undefined. Asks the registry only when the
 * last answer is a day old, and marks a version as told so it is mentioned once.
 */
export async function checkForUpdate(deps: CheckDeps): Promise<string | undefined> {
  let cache = deps.readCache();
  if (shouldCheck(deps.now, cache, deps.intervalMs ?? CHECK_INTERVAL_MS)) {
    const latest = await deps.fetchLatest();
    if (latest) {
      cache = { ...cache, checkedAt: deps.now, latest };
      deps.writeCache(cache);
    }
  }
  if (!cache?.latest) return undefined;
  if (!isNewer(cache.latest, deps.current)) return undefined;
  if (cache.notifiedFor === cache.latest) return undefined;
  deps.writeCache({ ...cache, notifiedFor: cache.latest });
  return cache.latest;
}
