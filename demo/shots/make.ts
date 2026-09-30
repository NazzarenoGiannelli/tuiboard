/**
 * `bun run demo:shots [scene ...]`: capture the scenes and render them into pictures and video.
 *
 *   capture.tsx  the real app, headless, on the demo boards   -> demo/out/frames/
 *   render.py    frames drawn as a Windows Terminal acrylic window -> demo/out/images/, demo/out/video/
 *
 * Needs Python with Pillow and numpy, and ffmpeg on PATH for the video. Nothing on the
 * desktop is touched and nothing is posted anywhere.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const scenes = process.argv.slice(2);

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONUTF8: "1" } });
  if (r.status !== 0) {
    console.error(`${cmd} failed (${r.status ?? r.error?.message})`);
    process.exit(r.status ?? 1);
  }
}

run(process.execPath, [
  "--preload",
  "./node_modules/@opentui/solid/scripts/preload.ts",
  join("demo", "shots", "capture.tsx"),
  ...scenes,
]);
run("python", [join("demo", "shots", "render.py"), ...scenes]);
console.log("\nPictures: demo/out/images/   Video: demo/out/video/   (git-ignored, review before using)");
