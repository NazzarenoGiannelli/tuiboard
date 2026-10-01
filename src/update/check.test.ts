import { describe, expect, test } from "bun:test";

import {
  checkForUpdate,
  compareVersions,
  fetchLatestVersion,
  installKind,
  isNewer,
  shouldCheck,
  updateCheckDisabled,
  upgradeHint,
  type UpdateCache,
} from "./check";

const DAY = 24 * 60 * 60 * 1000;

describe("compareVersions / isNewer", () => {
  test("compares numerically, not as strings", () => {
    expect(compareVersions("0.15.1", "0.15.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.15.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.15.10", "0.15.9")).toBe(1);
  });

  test("ignores a pre-release suffix and a leading v", () => {
    expect(compareVersions("v0.16.0", "0.15.1")).toBe(1);
    expect(compareVersions("0.16.0-beta.1", "0.16.0")).toBe(0);
  });

  test("anything that is not a version compares equal, so it never nags", () => {
    expect(compareVersions("latest", "0.15.1")).toBe(0);
    expect(compareVersions("", "0.15.1")).toBe(0);
    expect(isNewer("garbage", "0.15.1")).toBe(false);
  });

  test("isNewer is strictly greater", () => {
    expect(isNewer("0.16.0", "0.15.1")).toBe(true);
    expect(isNewer("0.15.1", "0.15.1")).toBe(false);
    expect(isNewer("0.15.0", "0.15.1")).toBe(false);
  });
});

describe("installKind and upgradeHint", () => {
  test("a bun global install", () => {
    expect(installKind("/home/me/.bun/install/global/node_modules/tuiboard", () => false)).toBe("bun-global");
    expect(installKind("C:\\Users\\me\\.bun\\install\\global\\node_modules\\tuiboard", () => false)).toBe("bun-global");
  });

  test("bunx runs from a cache or a temp folder", () => {
    expect(installKind("/home/me/.bun/install/cache/tuiboard@0.15.1", () => false)).toBe("bunx");
    expect(installKind("/tmp/bunx-1000-tuiboard@latest/node_modules/tuiboard", () => false)).toBe("bunx");
  });

  test("a checkout with a .git next to it is a source install", () => {
    expect(installKind("/home/me/code/tuiboard", (p) => p.endsWith(".git"))).toBe("source");
  });

  test("anything else is unknown", () => {
    expect(installKind("/opt/somewhere/tuiboard", () => false)).toBe("unknown");
  });

  test("each kind gets the command that works for it", () => {
    expect(upgradeHint("bun-global")).toBe("bun add -g tuiboard@latest --no-cache");
    expect(upgradeHint("unknown")).toBe("bun add -g tuiboard@latest --no-cache");
    expect(upgradeHint("bunx")).toBe("bunx tuiboard@latest");
    expect(upgradeHint("source")).toBe("git pull && bun install");
  });
});

describe("shouldCheck", () => {
  test("no cache: check", () => {
    expect(shouldCheck(1_000_000, undefined, DAY)).toBe(true);
  });
  test("a fresh check: wait", () => {
    expect(shouldCheck(1_000_000 + DAY - 1, { checkedAt: 1_000_000, latest: "0.15.1" }, DAY)).toBe(false);
  });
  test("a stale check: go again", () => {
    expect(shouldCheck(1_000_000 + DAY, { checkedAt: 1_000_000, latest: "0.15.1" }, DAY)).toBe(true);
  });
  test("a clock that went backwards does not block checks forever", () => {
    expect(shouldCheck(500, { checkedAt: 1_000_000, latest: "0.15.1" }, DAY)).toBe(true);
  });
});

describe("updateCheckDisabled", () => {
  const tty = { isTTY: true };
  test("on by default in a terminal", () => {
    expect(updateCheckDisabled({ configOff: false, env: {}, stdout: tty })).toBe(false);
  });
  test("the config can turn it off", () => {
    expect(updateCheckDisabled({ configOff: true, env: {}, stdout: tty })).toBe(true);
  });
  test("so can the environment", () => {
    expect(updateCheckDisabled({ configOff: false, env: { TUIBOARD_NO_UPDATE_CHECK: "1" }, stdout: tty })).toBe(true);
  });
  test("never in CI or without a terminal", () => {
    expect(updateCheckDisabled({ configOff: false, env: { CI: "true" }, stdout: tty })).toBe(true);
    expect(updateCheckDisabled({ configOff: false, env: {}, stdout: { isTTY: false } })).toBe(true);
  });
  test("an empty or '0' variable does not turn it off", () => {
    expect(updateCheckDisabled({ configOff: false, env: { TUIBOARD_NO_UPDATE_CHECK: "" }, stdout: tty })).toBe(false);
    expect(updateCheckDisabled({ configOff: false, env: { TUIBOARD_NO_UPDATE_CHECK: "0" }, stdout: tty })).toBe(false);
  });
});

describe("fetchLatestVersion", () => {
  test("reads the version from the registry's answer", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ name: "tuiboard", version: "0.16.0" }))) as unknown as typeof fetch;
    expect(await fetchLatestVersion(fetchFn, 1000)).toBe("0.16.0");
  });
  test("a bad status, a bad body or a network error is just no answer", async () => {
    expect(await fetchLatestVersion((async () => new Response("nope", { status: 500 })) as unknown as typeof fetch, 1000)).toBeUndefined();
    expect(await fetchLatestVersion((async () => new Response("{}")) as unknown as typeof fetch, 1000)).toBeUndefined();
    expect(await fetchLatestVersion((async () => { throw new Error("offline"); }) as unknown as typeof fetch, 1000)).toBeUndefined();
  });
  test("gives up after the timeout", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await fetchLatestVersion(hang, 50)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("checkForUpdate", () => {
  function setup(opts: { cache?: UpdateCache; latest?: string; now?: number }) {
    let cache = opts.cache;
    const calls = { fetch: 0, writes: [] as UpdateCache[] };
    return {
      calls,
      run: (current = "0.15.1") =>
        checkForUpdate({
          current,
          now: opts.now ?? 10 * DAY,
          intervalMs: DAY,
          readCache: () => cache,
          writeCache: (c) => {
            cache = c;
            calls.writes.push(c);
          },
          fetchLatest: async () => {
            calls.fetch++;
            return opts.latest;
          },
        }),
    };
  }

  test("a newer version on a first run: announce it once", async () => {
    const s = setup({ latest: "0.16.0" });
    expect(await s.run()).toBe("0.16.0");
    expect(s.calls.fetch).toBe(1);
    expect(s.calls.writes.at(-1)).toMatchObject({ latest: "0.16.0", notifiedFor: "0.16.0" });
  });

  test("the same version is not announced again on the next launch", async () => {
    const s = setup({ latest: "0.16.0" });
    await s.run();
    expect(await s.run()).toBeUndefined();
    expect(s.calls.fetch).toBe(1); // the second launch reuses the day's check
  });

  test("a still newer version is announced again", async () => {
    const cache: UpdateCache = { checkedAt: 0, latest: "0.16.0", notifiedFor: "0.16.0" };
    const s = setup({ cache, latest: "0.17.0", now: 5 * DAY });
    expect(await s.run()).toBe("0.17.0");
  });

  test("nothing to say when you are up to date", async () => {
    const s = setup({ latest: "0.15.1" });
    expect(await s.run("0.15.1")).toBeUndefined();
  });

  test("a fresh cache means no request at all", async () => {
    const cache: UpdateCache = { checkedAt: 10 * DAY - 1000, latest: "0.16.0" };
    const s = setup({ cache, latest: "0.99.0" });
    expect(await s.run()).toBe("0.16.0"); // announced from the cache
    expect(s.calls.fetch).toBe(0);
  });

  test("offline: no announcement, no error, and the next launch tries again", async () => {
    const s = setup({ latest: undefined });
    expect(await s.run()).toBeUndefined();
    expect(s.calls.writes).toHaveLength(0);
  });

  test("a registry answer older than the installed version stays quiet (a dev build)", async () => {
    const s = setup({ latest: "0.15.1" });
    expect(await s.run("0.16.0-dev")).toBeUndefined();
  });
});
