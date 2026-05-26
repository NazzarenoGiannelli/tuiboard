/**
 * Roundtrip integrity check.
 *
 * Parses each board, serializes it back, and verifies bit-for-bit equality
 * with the original (no tasks are dirty since we haven't mutated anything,
 * so `serializeTask` falls through to `rawLine`). Any diff indicates a bug
 * in the parser or serializer's handling of structural elements (frontmatter,
 * headings, section breaks, trailer).
 *
 * Usage:
 *   bun run src/scripts/roundtrip-check.ts [file.md ...]
 *
 * Exit code 0 on success, 1 on any mismatch.
 */

import { readFileSync } from "node:fs";
import { loadConfig } from "~/config/loader";
import { parseBoard } from "~/parser/markdown";
import { serializeBoard } from "~/parser/serialize";

const args = process.argv.slice(2);
const files = args.length > 0 ? args : loadConfig().boards.map((b) => b.path);

if (files.length === 0) {
  console.error("No boards to check.");
  process.exit(1);
}

let failures = 0;

for (const file of files) {
  let original: string;
  try {
    original = readFileSync(file, "utf-8");
  } catch (e) {
    console.error(`✗ ${file}: ${(e as Error).message}`);
    failures++;
    continue;
  }

  const { board } = parseBoard(original, { filepath: file });
  const serialized = serializeBoard(board);

  if (serialized === original) {
    console.log(`✓ ${file}  (${original.length} bytes, ${board.columns.length} cols)`);
    continue;
  }

  // Find the first difference for diagnostics.
  const minLen = Math.min(serialized.length, original.length);
  let diffAt = -1;
  for (let i = 0; i < minLen; i++) {
    if (serialized[i] !== original[i]) {
      diffAt = i;
      break;
    }
  }
  if (diffAt === -1) diffAt = minLen;

  const ctx = (s: string, at: number) => {
    const from = Math.max(0, at - 40);
    const to = Math.min(s.length, at + 40);
    return JSON.stringify(s.slice(from, to));
  };

  console.error(`✗ ${file}: roundtrip differs at offset ${diffAt}`);
  console.error(`  original size:    ${original.length}`);
  console.error(`  serialized size:  ${serialized.length}`);
  console.error(`  original    @ ${diffAt}: ${ctx(original, diffAt)}`);
  console.error(`  serialized  @ ${diffAt}: ${ctx(serialized, diffAt)}`);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} file(s) failed roundtrip.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} board(s) passed roundtrip.`);
