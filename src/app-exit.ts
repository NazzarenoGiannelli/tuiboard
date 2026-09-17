/**
 * The one way out of the TUI. Destroying the OpenTUI renderer is what gives
 * the terminal back — mouse tracking off, main screen, cooked input, cursor —
 * and a bare `process.exit` skips it (OpenTUI only cleans up on `beforeExit`
 * and its own signal/Ctrl+C handling), which left shells printing mouse
 * reports like `51;7;45M` after quitting.
 */

import type { CliRenderer } from "@opentui/core";

let renderer: CliRenderer | undefined;
let quitting = false;

export function registerRenderer(r: CliRenderer): void {
  renderer = r;
}

/** Restore the terminal, run `cleanup`, exit. Safe to call more than once. */
export async function quitApp(cleanup: () => Promise<void>, code = 0): Promise<never> {
  if (!quitting) {
    quitting = true;
    try {
      renderer?.destroy();
      // A destroy requested mid-frame completes when that frame ends.
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      // Never let a teardown error keep the process alive.
    }
    try {
      await cleanup();
    } catch {
      // Same.
    }
    process.exit(code);
  }
  return new Promise<never>(() => {});
}
