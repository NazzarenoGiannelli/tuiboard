/**
 * CLI smoke-test for the markdown parser.
 *
 * Usage:
 *   bun run src/scripts/parse-check.ts                # uses config-discovered boards
 *   bun run src/scripts/parse-check.ts <file.md>...   # parses specific files
 *
 * Prints per-board summary: columns, task counts, metadata coverage,
 * diagnostics, and a sample of parsed tasks so we can eyeball correctness.
 */

import { readFileSync } from "node:fs";
import { loadConfig } from "~/config/loader";
import { isTask, parseBoard } from "~/parser/markdown";
import type { Task } from "~/types";

const args = process.argv.slice(2);
const files: string[] = [];

if (args.length > 0) {
  files.push(...args);
} else {
  const cfg = loadConfig();
  if (!cfg.loaded) {
    console.error(
      `No .tuiboard/config.yaml found from ${cfg.root}. Using fallback scan of cwd.`,
    );
  }
  if (cfg.boards.length === 0) {
    console.error("No boards configured and none found via fallback scan.");
    process.exit(1);
  }
  files.push(...cfg.boards.map((b) => b.path));
}

let totalTasks = 0;
let totalDone = 0;
let totalWithSched = 0;
let totalWithTimeBlock = 0;
let totalLegacyTimeBlock = 0;
let totalWithPriority = 0;
let totalDiagnostics = 0;

for (const file of files) {
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch (e) {
    console.error(`✗ Cannot read ${file}: ${(e as Error).message}`);
    continue;
  }

  const { board, diagnostics } = parseBoard(content, { filepath: file });
  const tasks: Task[] = [];
  for (const col of board.columns) {
    for (const child of col.children) {
      if (isTask(child)) tasks.push(child);
    }
  }
  const done = tasks.filter((t) => t.done).length;
  const withSched = tasks.filter((t) => t.scheduled).length;
  const withTime = tasks.filter((t) => t.timeBlock).length;
  const legacyTime = tasks.filter((t) => t.timeBlockSource === "legacy-prefix").length;
  const withPrio = tasks.filter((t) => t.priority !== "none").length;

  totalTasks += tasks.length;
  totalDone += done;
  totalWithSched += withSched;
  totalWithTimeBlock += withTime;
  totalLegacyTimeBlock += legacyTime;
  totalWithPriority += withPrio;
  totalDiagnostics += diagnostics.length;

  console.log(`\n━━━ ${board.name} ━━━`);
  console.log(`  file:         ${file}`);
  console.log(`  frontmatter:  ${board.frontmatter ? "yes" : "no"}`);
  console.log(`  trailer:      ${board.trailer ? "yes" : "no"}`);
  console.log(`  columns:      ${board.columns.length} — ${board.columns.map((c) => c.name).join(" │ ")}`);
  console.log(`  tasks total:  ${tasks.length}  (${done} done, ${tasks.length - done} open)`);
  console.log(`  scheduled:    ${withSched}`);
  console.log(`  time blocks:  ${withTime}  (${legacyTime} legacy prefix, ${withTime - legacyTime} ⌚)`);
  console.log(`  priority:     ${withPrio}`);
  console.log(`  diagnostics:  ${diagnostics.length}`);

  // Show first 3 diagnostics
  for (const d of diagnostics.slice(0, 3)) {
    console.log(`    [L${d.line}] ${d.level}: ${d.message}`);
  }
  if (diagnostics.length > 3) console.log(`    … and ${diagnostics.length - 3} more`);

  // Show first 5 parsed open tasks for eyeballing
  const sample = tasks.filter((t) => !t.done).slice(0, 5);
  if (sample.length > 0) {
    console.log("\n  sample tasks:");
    for (const t of sample) {
      const tb = t.timeBlock
        ? ` ⌚${fmtMin(t.timeBlock.startMin)}-${fmtMin(t.timeBlock.endMin)}`
        : "";
      const sched = t.scheduled ? ` ⏳${t.scheduled}` : "";
      const prio = t.priority !== "none" ? ` [${t.priority}]` : "";
      const assignee = t.assignee ? ` @${t.assignee}` : "";
      const tags = t.tags.length ? ` ${t.tags.map((x) => "#" + x).join(" ")}` : "";
      console.log(`    • ${truncate(t.displayTitle, 60)}${prio}${assignee}${sched}${tb}${tags}`);
    }
  }
}

console.log("\n━━━ TOTALS ━━━");
console.log(`  files:        ${files.length}`);
console.log(`  tasks:        ${totalTasks}  (${totalDone} done)`);
console.log(`  scheduled:    ${totalWithSched}`);
console.log(`  time blocks:  ${totalWithTimeBlock}  (${totalLegacyTimeBlock} legacy, ${totalWithTimeBlock - totalLegacyTimeBlock} ⌚)`);
console.log(`  priority:     ${totalWithPriority}`);
console.log(`  diagnostics:  ${totalDiagnostics}`);

function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
