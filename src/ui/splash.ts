/**
 * Boot splash — a raw-ANSI "tuiboard" wordmark printed the instant the process
 * starts, so the ~1s cold-start window (Bun init + module load + store build +
 * first calendar/agents read) isn't a blank terminal.
 *
 * Why raw ANSI and not an OpenTUI component: the slow part is *synchronous* and
 * happens BEFORE OpenTUI mounts (createTuiStore alone is ~600ms), so a reactive
 * component can't paint during it. We print straight to stdout first; when
 * OpenTUI mounts it enters the alternate screen buffer (`?1049h`), which hides
 * this splash and shows the dashboard. No animation — the main thread is busy
 * the whole time — so we lean on a static wordmark with a subtle colour ramp.
 *
 * The wordmark is the FIGlet "Rectangles" font; the colour is the tool's light
 * "today" yellow (#eaf6ad), rendered as a gentle top-to-bottom gradient.
 */

/** "tuiboard" in the FIGlet Rectangles font (4 glyph rows, 31 cols). */
const WORDMARK = [
  " _       _ _                 _ ",
  "| |_ _ _|_| |_ ___ ___ ___ _| |",
  "|  _| | | | . | . | .'|  _| . |",
  "|_| |___|_|___|___|__,|_| |___|",
];

/** Top→bottom gradient of light yellows around the #eaf6ad "today" accent. */
const GRADIENT: Array<[number, number, number]> = [
  [244, 250, 200], // #f4fac8
  [238, 247, 182], // #eef7b6
  [234, 246, 173], // #eaf6ad  (the tool's todayPale)
  [224, 239, 154], // #e0ef9a
];

const SUBTITLE = "terminal kanban · agenda · agents";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const fg = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`;
const DIM = `${ESC}38;2;110;120;110m`; // muted grey-green for the sub-lines

/** Visible width of a string (the wordmark/subtitle are plain ASCII). */
function center(line: string, cols: number): string {
  const pad = Math.max(0, Math.floor((cols - line.length) / 2));
  return " ".repeat(pad) + line;
}

/**
 * Build the full splash frame for a terminal of `cols`×`rows`. Clears the
 * screen, vertically centres the block, and colours each wordmark row with its
 * gradient shade. Returns the raw string to write.
 */
export function splashFrame(cols: number, rows: number, version: string): string {
  const blockHeight = WORDMARK.length + 3; // wordmark + blank + subtitle + version
  const top = Math.max(0, Math.floor((rows - blockHeight) / 2));

  let out = `${ESC}2J${ESC}H`; // clear + home
  out += "\n".repeat(top);

  WORDMARK.forEach((line, i) => {
    const [r, g, b] = GRADIENT[Math.min(i, GRADIENT.length - 1)]!;
    out += fg(r, g, b) + center(line, cols) + RESET + "\n";
  });
  out += "\n";
  out += DIM + center(SUBTITLE, cols) + RESET + "\n";
  out += DIM + center(bootingLine(version, 0), cols) + RESET;
  return out;
}

/** Cycling dot suffixes for the booting line — a gentle left-to-right wave.
 *  All frames are the same visible width so the centred line never jitters. */
const BOOT_FRAMES = ["   ", "·  ", "·· ", "···", " ··", "  ·"];

/** The booting line text for animation frame `f` (without colour/centering). */
function bootingLine(version: string, f: number): string {
  return `booting v${version} ${BOOT_FRAMES[f % BOOT_FRAMES.length]}`;
}

/**
 * Animate the booting line in place (the launcher calls this while the child
 * cold-starts). Rewrites just that one line — the cursor is already parked on
 * it after `printSplash`. Returns a `stop` function the caller MUST invoke
 * before the child takes the screen, so we never draw onto the dashboard.
 * No-ops (returns a no-op stop) when output isn't an animatable TTY.
 */
export function animateBooting(version: string): () => void {
  if (!process.stdout.isTTY || process.env.TUIBOARD_NO_SPLASH) return () => {};
  const cols = process.stdout.columns ?? 0;
  const rows = process.stdout.rows ?? 0;
  if (cols < 34 || rows < 9) return () => {};
  let f = 1;
  const tick = () => {
    try {
      process.stdout.write(`\r${ESC}2K` + DIM + center(bootingLine(version, f), cols) + RESET);
      f++;
    } catch {
      /* ignore */
    }
  };
  const handle = setInterval(tick, 230);
  return () => clearInterval(handle);
}

/**
 * Print the splash to stdout if it makes sense to: an interactive TTY, wide and
 * tall enough not to garble, and not disabled via `TUIBOARD_NO_SPLASH`. Safe to
 * call more than once; safe to call when not a TTY (it just no-ops).
 */
export function printSplash(version: string): void {
  try {
    if (!process.stdout.isTTY) return;
    if (process.env.TUIBOARD_NO_SPLASH) return;
    const cols = process.stdout.columns ?? 0;
    const rows = process.stdout.rows ?? 0;
    if (cols < 34 || rows < 9) return; // too small — skip rather than mangle
    // Hide the terminal cursor so its blinking bar doesn't sit next to the
    // booting dots. ALWAYS paired with showCursor() on exit (see splash-boot.ts
    // and the bin launcher) so the shell never ends up cursor-less.
    process.stdout.write(HIDE_CURSOR + splashFrame(cols, rows, version));
  } catch {
    // Cosmetic only — never let the splash break startup.
  }
}

/** Restore the terminal cursor that the splash hid. Idempotent; safe to call on
 *  every exit path and when no splash was ever shown. */
export function showCursor(): void {
  try {
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
  } catch {
    /* ignore */
  }
}
