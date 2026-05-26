/**
 * File watcher wrapping chokidar.
 *
 * Emits a debounced `change` event when any tracked board file is modified
 * on disk. Use to refresh state when the user edits a board externally
 * (Obsidian, vim, sync conflict resolution, etc.).
 *
 * Self-writes are filtered: every `writeBoardFile` call should be followed
 * by `markSelfWrite(path)` so the watcher ignores the resulting event.
 */

import chokidar, { type FSWatcher } from "chokidar";

export type ChangeListener = (filepath: string) => void;

export interface BoardWatcher {
  /** Start watching. Returns a stop function. */
  start: () => void;
  /** Stop watching and release file handles. */
  stop: () => Promise<void>;
  /** Subscribe to debounced change events. Returns an unsubscribe fn. */
  onChange: (listener: ChangeListener) => () => void;
  /** Mark the next change event for `filepath` as a self-write, to be ignored. */
  markSelfWrite: (filepath: string) => void;
}

export interface WatcherOptions {
  /** Debounce window in ms. Default 150. */
  debounceMs?: number;
}

export function createBoardWatcher(
  filepaths: string[],
  { debounceMs = 150 }: WatcherOptions = {},
): BoardWatcher {
  const listeners = new Set<ChangeListener>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const selfWrites = new Set<string>();
  let watcher: FSWatcher | null = null;

  function emit(filepath: string) {
    if (selfWrites.delete(filepath)) return; // ignore our own writes
    for (const l of listeners) l(filepath);
  }

  function schedule(filepath: string) {
    const existing = pending.get(filepath);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      pending.delete(filepath);
      emit(filepath);
    }, debounceMs);
    pending.set(filepath, t);
  }

  return {
    start() {
      if (watcher) return;
      watcher = chokidar.watch(filepaths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
      });
      watcher.on("change", schedule);
      watcher.on("add", schedule);
    },
    async stop() {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markSelfWrite(filepath) {
      selfWrites.add(filepath);
      // Guard against the watcher missing the event — clear after a short delay.
      setTimeout(() => selfWrites.delete(filepath), 1000);
    },
  };
}
