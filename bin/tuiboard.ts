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

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, "..", "src", "app.tsx");
const preload = fileURLToPath(import.meta.resolve("@opentui/solid/preload"));

const result = spawnSync(
  process.execPath, // the bun binary running this script
  ["--preload", preload, appPath, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
