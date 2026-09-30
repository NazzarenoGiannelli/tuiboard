/**
 * `bun run demo:film [-- --audio track.mp3]`: rebuild the launch film.
 *
 *   1. capture the `promo` scene (the real app, resized from 182 to 64 columns)
 *   2. make the placeholder track if there is none in demo/promo/out/
 *   3. build.py: compose the 1080p frames against the cue sheet and mux the audio
 *
 * See README.md in this folder. Needs Python with Pillow and numpy, and ffmpeg.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const env = { ...process.env, PYTHONUTF8: "1" };

function run(cmd: string, a: string[]) {
  const r = spawnSync(cmd, a, { cwd: root, stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`${cmd} failed (${r.status ?? r.error?.message})`);
    process.exit(r.status ?? 1);
  }
}

run(process.execPath, ["--preload", "./node_modules/@opentui/solid/scripts/preload.ts", join("demo", "shots", "capture.tsx"), "promo"]);
// no track yet: make the placeholder one (put future-launch.mp3 in demo/promo/out/ to use the real one)
if (!args.includes("--audio") && !["future-launch.mp3", "music.wav"].some((f) => existsSync(join(here, "out", f)))) {
  run("python", [join("demo", "promo", "music.py")]);
}
run("python", [join("demo", "promo", "build.py"), ...args]);
