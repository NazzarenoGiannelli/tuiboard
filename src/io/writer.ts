/**
 * Atomic, conflict-safe board file writer.
 *
 * Strategy:
 *   1. Read current mtime of target file.
 *   2. If `expectedMtimeMs` was provided and current ≠ expected → conflict.
 *      Caller should re-read and merge before retrying.
 *   3. Write content to a sibling `.tmp` file with a unique suffix.
 *   4. `rename` over the original (atomic on the same volume — POSIX +
 *      Windows ReplaceFile semantics).
 *   5. Return the new mtime so the caller can update its watermark.
 *
 * Note on Windows: `fs.rename` is *not* atomic-overwrite by default. We use
 * `fs.renameSync` which on modern Node/Bun maps to `MoveFileExW` with the
 * `MOVEFILE_REPLACE_EXISTING` flag. If a third party has the target open
 * for exclusive write at that exact moment, the rename can fail — we surface
 * the error to the caller, which can retry.
 */

import {
  closeSync,
  existsSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

export class ConflictError extends Error {
  constructor(
    readonly filepath: string,
    readonly expectedMtimeMs: number,
    readonly actualMtimeMs: number,
  ) {
    super(
      `File ${filepath} changed on disk since last read ` +
        `(expected mtime ${expectedMtimeMs}, found ${actualMtimeMs}).`,
    );
    this.name = "ConflictError";
  }
}

export interface WriteResult {
  /** New mtime in ms — caller should store this as the next watermark. */
  mtimeMs: number;
}

export interface WriteOptions {
  /** Last known mtime in ms. If set and disk mtime differs, throws ConflictError. */
  expectedMtimeMs?: number;
}

export function writeBoardFile(
  filepath: string,
  content: string,
  { expectedMtimeMs }: WriteOptions = {},
): WriteResult {
  if (typeof expectedMtimeMs === "number" && existsSync(filepath)) {
    const cur = statSync(filepath).mtimeMs;
    // Allow a small tolerance (1ms) for filesystems with coarse mtime.
    if (Math.abs(cur - expectedMtimeMs) > 1) {
      throw new ConflictError(filepath, expectedMtimeMs, cur);
    }
  }

  const dir = dirname(filepath);
  const tmpName = `.${basename(filepath)}.tuiboard-${process.pid}-${Date.now()}.tmp`;
  const tmpPath = join(dir, tmpName);

  // Write tmp file. Open with O_CREAT|O_WRONLY|O_TRUNC.
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }

  // Atomic-ish rename over target.
  renameSync(tmpPath, filepath);

  return { mtimeMs: statSync(filepath).mtimeMs };
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function statMtime(filepath: string): number {
  return statSync(filepath).mtimeMs;
}
