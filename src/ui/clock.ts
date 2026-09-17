/**
 * A shared, coarse clock for relative times ("5m", "3h"). Rows used to compute
 * their age only when their data changed, so ages jumped irregularly while
 * agents worked; one timer for the whole UI keeps them ticking evenly.
 */

import { createSignal } from "solid-js";

export const CLOCK_TICK_MS = 30_000;

const [now, setNow] = createSignal(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

/** Current time, updated every CLOCK_TICK_MS. Starts on first use. */
export function clockNow(): number {
  if (!timer) {
    timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    timer.unref?.();
  }
  return now();
}
