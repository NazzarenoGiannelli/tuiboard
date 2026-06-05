#!/usr/bin/env bun
/**
 * Global entry point for `tuiboard` (after `bun install -g tuiboard`,
 * `bunx tuiboard`, or `bun link`).
 *
 * OpenTUI's Solid JSX runtime must be registered via `bun --preload` BEFORE
 * the module graph is parsed — otherwise app.tsx's JSX is transformed against
 * the wrong runtime and bun throws `Export named 'Fragment' not found`.
 * The `--preload` flag can't travel through a shebang cross-platform (Windows
 * global bins are .cmd shims), so we re-exec bun with the flag here, forward
 * any CLI args, and inherit stdio so the TUI keeps the real terminal.
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json";
import { animateBooting, printSplash, showCursor } from "../src/ui/splash.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, "..", "src", "app.tsx");

// Subcommands that run as a plain CLI (no TUI, no preload needed). Handle them
// here before re-exec'ing bun for the dashboard.
if (process.argv[2] === "calendar-setup") {
  const { runCalendarSetup } = await import("../src/calendar/setup.ts");
  process.exit(await runCalendarSetup(process.argv.slice(3)));
}
const preload = fileURLToPath(import.meta.resolve("@opentui/solid/preload"));

// Paint the splash from the (already-running) launcher and animate its booting
// dots while the child cold-starts. Using `spawn` (not `spawnSync`) keeps this
// process's event loop free to run the animation. We MUST stop animating the
// instant before the child enters OpenTUI's alternate screen, or our writes
// would land on the dashboard — so the child drops a "ready" flag file just
// before render() and we poll for it.
printSplash(pkg.version);
const stopAnim = animateBooting(pkg.version);
// The splash hides the cursor; make sure it comes back when the launcher exits
// (after the child has torn down), so the shell is never left cursor-less.
process.on("exit", showCursor);
const readyFlag = join(tmpdir(), `tuiboard-ready-${process.pid}`);
try { rmSync(readyFlag, { force: true }); } catch { /* ignore */ }

let poll: ReturnType<typeof setInterval> | undefined;
let safety: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
const stopSplash = () => {
  if (stopped) return;
  stopped = true;
  stopAnim();
  if (poll) clearInterval(poll);
  if (safety) clearTimeout(safety);
  try { rmSync(readyFlag, { force: true }); } catch { /* ignore */ }
};
poll = setInterval(() => { if (existsSync(readyFlag)) stopSplash(); }, 30);
safety = setTimeout(stopSplash, 4000); // fallback if the child never signals

// Ctrl-C reaches the child directly (same process group); it cleans up and
// exits, then we mirror its code below. Ignore the signal here so the launcher
// doesn't die first and orphan the child mid-teardown.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

const child = spawn(
  process.execPath, // the bun binary running this script
  ["--preload", preload, appPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, TUIBOARD_SPLASH_DONE: "1", TUIBOARD_READY_FLAG: readyFlag },
  },
);
child.on("exit", (code, signal) => {
  stopSplash();
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (err) => {
  stopSplash();
  console.error(String(err));
  process.exit(1);
});
