/**
 * `bun run demo:film [-- --audio track.mp3]`: rebuild the launch film.
 *
 *   1. capture the `promo` scene (the real app, resized from 182 to 64 columns)
 *   2. shorten the track to fit (edit_audio.py), or make the placeholder one
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
// the track: Future Launch (demo/promo/out/future-launch.mp3) shortened to fit the film, or else
// the synthesised placeholder
if (existsSync(join(here, "out", "future-launch.mp3"))) {
  run("python", [join("demo", "promo", "edit_audio.py")]);
} else if (!existsSync(join(here, "out", "film-audio.wav"))) {
  run("python", [join("demo", "promo", "music.py")]);
}
run("python", [join("demo", "promo", "build.py"), ...args]);
