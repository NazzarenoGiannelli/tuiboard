/**
 * Opt-in performance log, for chasing "the app is slow" reports.
 *
 * Off unless `TUIBOARD_PERF` is set: a file path, or `1` for
 * `<tmpdir>/tuiboard-perf.log`. One JSON object per line:
 *
 *   start      version, pid, runtime, where the log is
 *   sample     every 5 s: CPU % of one core, rss / heap in MB, the worst
 *              event-loop lag of the window, keys pressed
 *   lag        the event loop was blocked for `ms` (>= 150 ms), with the last
 *              keys pressed and how long before the lag they arrived
 *   slow-key   a key handler itself took >= 30 ms
 *   note       something code left on purpose to trace what the terminal delivers
 *              (the Agenda writes the press, drag, over and release of a carried block)
 *
 * "Lag" is how late a 100 ms timer fires: while JavaScript is busy nothing
 * else runs, so it is exactly the delay a keypress would have felt. Reading a
 * `lag` line next to the keys before it says what set the loop off.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PerfSink = (line: string) => void;

/** The running recorder, if the log is on, so code far from app.tsx can leave a note. */
let active: { note(kind: string, data: Record<string, unknown>): void } | undefined;

/**
 * Leave a note in the performance log (a no-op unless TUIBOARD_PERF is set). For
 * tracing what the terminal actually delivers, e.g. the mouse events of a drag.
 */
export function perfNote(kind: string, data: Record<string, unknown> = {}): void {
  active?.note(kind, data);
}

export interface PerfThresholds {
  /** A key handler slower than this is logged as `slow-key`. */
  slowKeyMs: number;
  /** An event-loop stall longer than this is logged as `lag`. */
  lagMs: number;
  /** How many recent keys are kept to explain a lag. */
  keepKeys: number;
}

const DEFAULTS: PerfThresholds = { slowKeyMs: 30, lagMs: 150, keepKeys: 6 };

export class PerfRecorder {
  private recent: { t: number; key: string }[] = [];
  private windowKeys = 0;
  private windowMaxLag = 0;

  constructor(
    private readonly sink: PerfSink,
    private readonly now: () => number = Date.now,
    private readonly limits: PerfThresholds = DEFAULTS,
  ) {}

  private emit(obj: Record<string, unknown>): void {
    this.sink(JSON.stringify({ at: new Date(this.now()).toISOString(), ...obj }));
  }

  /** A key was handled, and `handlerMs` is how long the handler ran. */
  key(name: string, handlerMs: number): void {
    this.windowKeys++;
    this.recent.push({ t: this.now(), key: name });
    if (this.recent.length > this.limits.keepKeys) this.recent.shift();
    if (handlerMs >= this.limits.slowKeyMs) {
      this.emit({ type: "slow-key", key: name, ms: Math.round(handlerMs) });
    }
  }

  /** A timer fired `ms` late. */
  lag(ms: number): void {
    if (ms > this.windowMaxLag) this.windowMaxLag = ms;
    if (ms < this.limits.lagMs) return;
    const t = this.now();
    this.emit({
      type: "lag",
      ms: Math.round(ms),
      keys: this.recent.map((k) => `${k.key} -${t - k.t}ms`),
    });
  }

  /** Close the current window and report it with the process numbers. */
  sample(stats: { cpuPct: number; rssMB: number; heapMB: number }): void {
    this.emit({
      type: "sample",
      cpuPct: Math.round(stats.cpuPct),
      rssMB: Math.round(stats.rssMB),
      heapMB: Math.round(stats.heapMB),
      maxLagMs: Math.round(this.windowMaxLag),
      keys: this.windowKeys,
    });
    this.windowKeys = 0;
    this.windowMaxLag = 0;
  }

  note(kind: string, data: Record<string, unknown>): void {
    this.emit({ type: "note", kind, ...data });
  }

  start(info: Record<string, unknown>): void {
    this.emit({ type: "start", ...info });
  }
}

/** Where the log goes for a `TUIBOARD_PERF` value, or undefined when it is off. */
export function perfLogPath(value: string | undefined): string | undefined {
  if (!value || value === "0" || value.toLowerCase() === "false") return undefined;
  if (value === "1" || value.toLowerCase() === "true") return join(tmpdir(), "tuiboard-perf.log");
  return value;
}

/** A readable key name for the log: modifiers, then the key. */
export function perfKeyName(key: { name?: string; sequence?: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): string {
  const mods = `${key.ctrl ? "C-" : ""}${key.meta ? "M-" : ""}${key.shift ? "S-" : ""}`;
  return `${mods}${key.name ?? JSON.stringify(key.sequence ?? "?")}`;
}

/**
 * Start the log if `TUIBOARD_PERF` asks for it. Returns the recorder to feed
 * key events, or undefined (and no timers at all) when the log is off. Never
 * throws: a diagnostic must not be the reason the app does not start.
 */
export function startPerfLog(version: string, env: NodeJS.ProcessEnv = process.env): PerfRecorder | undefined {
  const path = perfLogPath(env.TUIBOARD_PERF);
  if (!path) return undefined;
  try {
    writeFileSync(path, "");
    const rec = new PerfRecorder((line) => {
      try {
        appendFileSync(path, line + "\n");
      } catch {
        // Full disk, locked file — drop the line.
      }
    });
    rec.start({ version, pid: process.pid, runtime: `bun ${Bun.version}`, log: path });
    active = rec;

    const TICK = 100;
    let last = performance.now();
    setInterval(() => {
      const t = performance.now();
      rec.lag(Math.max(0, t - last - TICK));
      last = t;
    }, TICK).unref();

    const WINDOW = 5000;
    let cpu = process.cpuUsage();
    let wall = performance.now();
    setInterval(() => {
      const t = performance.now();
      const used = process.cpuUsage(cpu);
      const cpuPct = ((used.user + used.system) / 1000 / (t - wall)) * 100;
      cpu = process.cpuUsage();
      wall = t;
      const m = process.memoryUsage();
      rec.sample({ cpuPct, rssMB: m.rss / 1048576, heapMB: m.heapUsed / 1048576 });
    }, WINDOW).unref();
    return rec;
  } catch {
    return undefined;
  }
}
