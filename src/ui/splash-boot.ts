/**
 * Side-effect module: paints the boot splash the moment it's imported.
 *
 * app.tsx imports this FIRST so the splash prints before `@opentui/solid`
 * (and the ~600ms store build) load — ES modules run imported modules in
 * source order, so a first-position side-effect import is the only way to
 * paint before the heavy imports execute.
 *
 * When launched via the `tuiboard` bin, the launcher already printed the splash
 * (and sets TUIBOARD_SPLASH_DONE), so this no-ops to avoid a double paint.
 */

import pkg from "../../package.json";
import { printSplash, showCursor } from "./splash";

if (!process.env.TUIBOARD_SPLASH_DONE) printSplash(pkg.version);

// The splash hides the cursor; guarantee it's restored on every exit path of
// this process, so quitting never leaves the shell without a cursor. (OpenTUI
// also restores on clean exit; this is the belt-and-suspenders backstop.)
process.on("exit", showCursor);
