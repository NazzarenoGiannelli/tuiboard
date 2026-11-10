/**
 * Atomic, conflict-safe board file writer.
 *
 * Strategy:
 *   1. If `expectedMtimeMs` was provided, verify the target exists and matches.
 *   2. Write the complete content to a unique sibling `.tmp` file.
 *   3. Re-check the expected mtime immediately before commit.
 *   4. Rename over the original and remove the temporary file on any failure.
 *   5. Return the new mtime so the caller can update its watermark.
 *
 * A missing target is a conflict, never permission to recreate a board that
 * was deleted after the caller loaded it. The final stat/rename pair still has
 * the small race inherent in portable optimistic concurrency without a lock.
 *
 * Note on Windows: `fs.rename` is *not* atomic-overwrite by default. We use
 * `fs.renameSync` which on modern Node/Bun maps to `MoveFileExW` with the
 * `MOVEFILE_REPLACE_EXISTING` flag. If a third party has the target open
 * for exclusive write at that exact moment, the rename can fail — we surface
 * the error to the caller, which can retry.
 */

import {
  closeSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export class ConflictError extends Error {
  constructor(
    readonly filepath: string,
    readonly expectedMtimeMs: number,
    readonly actualMtimeMs: number | undefined,
  ) {
    super(
      actualMtimeMs === undefined
        ? `File ${filepath} was deleted on disk since last read (expected mtime ${expectedMtimeMs}).`
        : `File ${filepath} changed on disk since last read ` +
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
  /** Last known mtime in ms. If set and the target is missing or differs, throws ConflictError. */
  expectedMtimeMs?: number;
}

export function writeBoardFile(
  filepath: string,
  content: string,
  { expectedMtimeMs }: WriteOptions = {},
): WriteResult {
  if (typeof expectedMtimeMs === "number") {
    assertExpectedMtime(filepath, expectedMtimeMs);
  }

  const dir = dirname(filepath);
  const tmpName = `.${basename(filepath)}.tuiboard-${process.pid}-${randomUUID()}.tmp`;
  const tmpPath = join(dir, tmpName);
  let fd: number | undefined;
  let createdTemp = false;

  try {
    // wx avoids clobbering a stale temporary file from an earlier failed run.
    fd = openSync(tmpPath, "wx");
    createdTemp = true;
    const data = Buffer.from(content, "utf-8");
    let offset = 0;
    while (offset < data.length) {
      const written = writeSync(fd, data, offset, data.length - offset);
      if (written <= 0) throw new Error(`Could not finish writing temporary board file ${tmpPath}.`);
      offset += written;
    }
    closeSync(fd);
    fd = undefined;

    // Re-check immediately before commit. This narrows the race window between
    // the initial read and rename; the caller still owns retry/merge semantics.
    if (typeof expectedMtimeMs === "number") {
      assertExpectedMtime(filepath, expectedMtimeMs);
    }

    renameSync(tmpPath, filepath);
    return { mtimeMs: statSync(filepath).mtimeMs };
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* preserve the original error */ }
    }
    if (createdTemp) {
      try { unlinkSync(tmpPath); } catch { /* temp may already have been renamed */ }
    }
    throw error;
  }
}

function assertExpectedMtime(filepath: string, expectedMtimeMs: number): void {
  let currentMtimeMs: number;
  try {
    currentMtimeMs = statSync(filepath).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConflictError(filepath, expectedMtimeMs, undefined);
    }
    throw error;
  }

  // Allow a small tolerance (1ms) for filesystems with coarse mtime.
  if (Math.abs(currentMtimeMs - expectedMtimeMs) > 1) {
    throw new ConflictError(filepath, expectedMtimeMs, currentMtimeMs);
  }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function statMtime(filepath: string): number {
  return statSync(filepath).mtimeMs;
}
