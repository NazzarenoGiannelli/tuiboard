/**
 * Headless mutations on a board, for scripts and widgets.
 *
 *   tuiboard task done  --board <name> --column <col> --match <text>
 *   tuiboard task add   --board <name> --column <col> --text <text>
 *   tuiboard task defer --board <name> --column <col> --match <text> [--days N|--to DATE]
 *   ... --dry-run     report what would change, write nothing
 *
 * Why match by text and not by index: a task's id is `${column}:${position}`,
 * which is only valid inside one render pass. Anything outside the TUI — a
 * widget polling every two minutes, a cron job — holds a stale snapshot, and
 * acting on a stale index silently hits the wrong task. Matching on the
 * rendered title instead makes a moved task a miss rather than a mistake.
 *
 * Concurrency is handled by writeBoardFile()'s mtime watermark: if the file
 * changed since we read it, it throws ConflictError and we refuse the write.
 */

import { readFileSync } from "node:fs";

import { loadConfig } from "~/config/loader";
import { ConflictError, statMtime, writeBoardFile } from "~/io/writer";
import { isTask, parseBoard } from "~/parser/markdown";
import { serializeBoard } from "~/parser/serialize";
import type { Board, Column, Task } from "~/types";

interface Args {
  board?: string;
  column?: string;
  match?: string;
  text?: string;
  days?: number;
  to?: string;
  dryRun: boolean;
}

function parse(argv: readonly string[]): Args {
  const a: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const take = () => argv[++i];
    if (arg === "--board") a.board = take();
    else if (arg === "--column") a.column = take();
    else if (arg === "--match") a.match = take();
    else if (arg === "--text") a.text = take();
    else if (arg === "--days") a.days = Number(take());
    else if (arg === "--to") a.to = take();
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg.startsWith("--board=")) a.board = arg.slice(8);
    else if (arg.startsWith("--column=")) a.column = arg.slice(9);
    else if (arg.startsWith("--match=")) a.match = arg.slice(8);
    else if (arg.startsWith("--text=")) a.text = arg.slice(7);
    else if (arg.startsWith("--days=")) a.days = Number(arg.slice(7));
    else if (arg.startsWith("--to=")) a.to = arg.slice(5);
    else throw new Error(`unknown argument "${arg}"`);
  }
  return a;
}

function isoToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isoShift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Resolve a board by configured name, then by path suffix. */
function resolveBoard(needle: string) {
  const cfg = loadConfig();
  const lower = needle.toLowerCase();
  const hit =
    cfg.boards.find((b) => (b.name ?? "").toLowerCase() === lower) ??
    cfg.boards.find((b) => b.path.toLowerCase().endsWith(lower));
  if (!hit) {
    const names = cfg.boards.map((b) => b.name ?? b.path).join(", ");
    throw new Error(`board "${needle}" not found. Configured: ${names || "(none)"}`);
  }
  return hit;
}

function findColumn(board: Board, name: string): Column {
  const lower = name.toLowerCase();
  const col = board.columns.find((c) => c.name.toLowerCase() === lower);
  if (!col) {
    throw new Error(
      `column "${name}" not found. Available: ${board.columns.map((c) => c.name).join(", ")}`,
    );
  }
  return col;
}

/** Exactly one match or nothing: an ambiguous title must not be guessed at. */
function findTask(col: Column, needle: string): Task {
  const lower = needle.toLowerCase();
  const tasks = col.children.filter(isTask);
  let hits = tasks.filter((t) => t.displayTitle.toLowerCase() === lower);
  if (hits.length === 0) {
    hits = tasks.filter((t) => t.displayTitle.toLowerCase().includes(lower));
  }
  if (hits.length === 0) throw new Error(`no task in "${col.name}" matching "${needle}"`);
  if (hits.length > 1) {
    throw new Error(
      `"${needle}" matches ${hits.length} tasks in "${col.name}"; be more specific`,
    );
  }
  return hits[0]!;
}

export async function runTask(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== "done" && sub !== "add" && sub !== "defer") {
    console.error(
      "usage: tuiboard task <done|add|defer> --board <b> --column <c> [--match|--text] <s>",
    );
    return 2;
  }

  let a: Args;
  try {
    a = parse(argv.slice(1));
  } catch (e) {
    console.error(`tuiboard task: ${(e as Error).message}`);
    return 2;
  }

  if (!a.board || !a.column) {
    console.error("tuiboard task: --board and --column are required");
    return 2;
  }
  if ((sub === "done" || sub === "defer") && !a.match) {
    console.error(`tuiboard task ${sub}: --match is required`);
    return 2;
  }
  if (sub === "defer" && a.days !== undefined && !Number.isFinite(a.days)) {
    console.error("tuiboard task defer: --days must be a number");
    return 2;
  }
  if (sub === "defer" && a.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(a.to)) {
    console.error("tuiboard task defer: --to must be YYYY-MM-DD");
    return 2;
  }
  if (sub === "add" && !a.text) {
    console.error("tuiboard task add: --text is required");
    return 2;
  }

  try {
    const ref = resolveBoard(a.board);
    const mtime = statMtime(ref.path);
    const { board } = parseBoard(readFileSync(ref.path, "utf-8"), { filepath: ref.path });
    const col = findColumn(board, a.column);

    let summary: string;

    if (sub === "done") {
      const task = findTask(col, a.match!);
      if (task.done) {
        console.log(`already done: ${task.displayTitle}`);
        return 0;
      }
      // Same semantics as the TUI's toggleDone: keep an existing completion
      // date if one was already recorded, otherwise stamp today.
      task.done = true;
      task.dirty = true;
      task.doneDate = task.doneDate ?? isoToday();
      summary = `done: ${task.displayTitle}`;
    } else if (sub === "defer") {
      const task = findTask(col, a.match!);
      const target = a.to ?? isoShift(a.days ?? 1);

      // Move the field the planner actually reads. buildPlannerItems() buckets
      // on `scheduled ?? due`, so shifting `due` on a task that also carries a
      // `scheduled` date would write a change that never moves the row.
      // A task with neither date gets a scheduled one, which is what puts it
      // on the agenda in the first place.
      if (task.scheduled !== undefined) task.scheduled = target;
      else if (task.due !== undefined) task.due = target;
      else task.scheduled = target;

      task.dirty = true;
      summary = `deferred to ${target}: ${task.displayTitle}`;
    } else {
      const task: Task = {
        id: `${board.columns.indexOf(col)}:${col.children.filter(isTask).length}`,
        done: false,
        rawBody: a.text!,
        rawLine: `- [ ] ${a.text!}`,
        dirty: true,
        displayTitle: a.text!,
        tags: [],
        wikilinks: [],
        priority: "none",
      };
      col.children.push(task);
      summary = `added to ${col.name}: ${a.text}`;
    }

    if (a.dryRun) {
      console.log(`[dry-run] ${summary}`);
      return 0;
    }

    writeBoardFile(ref.path, serializeBoard(board), { expectedMtimeMs: mtime });
    console.log(summary);
    return 0;
  } catch (e) {
    if (e instanceof ConflictError) {
      console.error(`tuiboard task: the board changed on disk — refresh and retry.`);
      return 3;
    }
    console.error(`tuiboard task: ${(e as Error).message}`);
    return 1;
  }
}
