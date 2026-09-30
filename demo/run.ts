/**
 * `bun run demo`: write the demo boards for today, then open tuiboard on them.
 * Extra arguments go to tuiboard (`bun run demo -- --view=timeline`).
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { seedDemo, todayLocal } from "./seed";

const here = dirname(fileURLToPath(import.meta.url));
seedDemo();

const result = spawnSync(
  process.execPath,
  [join(here, "..", "bin", "tuiboard.ts"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, TUIBOARD_CONFIG: join(here, "config.yaml") },
  },
);
if (result.error) console.error(`Could not start tuiboard for ${todayLocal()}: ${result.error.message}`);
process.exit(result.status ?? 1);
