/**
 * Headless JSON snapshot of the configured boards.
 *
 * Usage:
 *   tuiboard summary              # compact JSON on stdout
 *   tuiboard summary --pretty     # indented, for humans
 *   tuiboard summary --next 8     # how many upcoming tasks per board (default 5)
 *
 * Written for status bars, widgets and scripts: no TUI, no OpenTUI preload.
 * It deliberately reuses `loadConfig` and `parseBoard` rather than re-reading
 * the markdown itself, so these numbers can never drift from what the
 * dashboard shows — the parser stays the single source of truth.
 */

import { readFileSync } from "node:fs";

import { isHiddenColumn, loadConfig } from "~/config/loader";
import { isTask, parseBoard } from "~/parser/markdown";
import type { PriorityLevel, Task } from "~/types";

/** Lower sorts first, so "highest" leads an ascending sort. */
const PRIORITY_RANK: Record<PriorityLevel, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
  none: 5,
};

export interface SummaryTask {
  title: string;
  board: string;
  column: string;
  priority: PriorityLevel;
  due?: string;
  scheduled?: string;
  assignee?: string;
  tags: string[];
  /** Negative when overdue, 0 today, positive in the future, null when undated. */
  daysUntil: number | null;
}

export interface SummaryColumn {
  name: string;
  open: number;
}

export interface SummaryBoard {
  name: string;
  path: string;
  open: number;
  done: number;
  overdue: number;
  today: number;
  columns: SummaryColumn[];
  next: SummaryTask[];
  /** Parser complaints, so a malformed board is visible instead of silently empty. */
  diagnostics: number;
}

export interface Summary {
  generatedAt: string;
  totals: { open: number; done: number; overdue: number; today: number };
  boards: SummaryBoard[];
}

/** Local calendar date as YYYY-MM-DD — never UTC, or "today" flips at the wrong hour. */
function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days between two YYYY-MM-DD dates, midday-anchored to dodge DST. */
function daysBetween(from: string, to: string): number {
  const at = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0).getTime();
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** The date a task is judged by: an explicit due date wins over a scheduled one. */
function effectiveDate(task: Task): string | undefined {
  return task.due ?? task.scheduled;
}

export function buildSummary(options: { next?: number; today?: string } = {}): Summary {
  const nextCount = options.next ?? 5;
  const today = options.today ?? localToday();
  const config = loadConfig();

  const boards: SummaryBoard[] = [];
  const totals = { open: 0, done: 0, overdue: 0, today: 0 };

  for (const ref of config.boards) {
    let content: string;
    try {
      content = readFileSync(ref.path, "utf-8");
    } catch {
      // A board listed in config but missing on disk is worth surfacing, not
      // crashing over: a widget polling every 30s shouldn't die on a moved file.
      boards.push({
        name: ref.name ?? ref.path,
        path: ref.path,
        open: 0,
        done: 0,
        overdue: 0,
        today: 0,
        columns: [],
        next: [],
        diagnostics: -1,
      });
      continue;
    }

    const { board, diagnostics } = parseBoard(content, { filepath: ref.path });
    const boardName = ref.name ?? board.name;

    const columns: SummaryColumn[] = [];
    const openTasks: SummaryTask[] = [];
    let open = 0;
    let done = 0;
    let overdue = 0;
    let dueToday = 0;

    for (const column of board.columns) {
      const hidden = isHiddenColumn(config, column.name);
      let columnOpen = 0;

      for (const child of column.children) {
        if (!isTask(child)) continue;
        const task = child;

        // Anything parked in Done/Archive counts as done wherever its checkbox
        // sits — the column is the workflow truth, not the `- [x]` marker.
        if (hidden || task.done) {
          done++;
          continue;
        }

        open++;
        columnOpen++;

        const date = effectiveDate(task);
        const daysUntil = date ? daysBetween(today, date) : null;
        if (daysUntil !== null && daysUntil < 0) overdue++;
        if (daysUntil === 0) dueToday++;

        openTasks.push({
          title: task.displayTitle,
          board: boardName,
          column: column.name,
          priority: task.priority,
          due: task.due,
          scheduled: task.scheduled,
          assignee: task.assignee,
          tags: task.tags,
          daysUntil,
        });
      }

      if (!hidden) columns.push({ name: column.name, open: columnOpen });
    }

    // Soonest first; undated tasks last; ties broken by priority then title so
    // the order is stable between polls and the widget doesn't flicker.
    openTasks.sort((a, b) => {
      const ad = a.daysUntil ?? Number.POSITIVE_INFINITY;
      const bd = b.daysUntil ?? Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      const ap = PRIORITY_RANK[a.priority];
      const bp = PRIORITY_RANK[b.priority];
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title);
    });

    totals.open += open;
    totals.done += done;
    totals.overdue += overdue;
    totals.today += dueToday;

    boards.push({
      name: boardName,
      path: ref.path,
      open,
      done,
      overdue,
      today: dueToday,
      columns,
      next: openTasks.slice(0, nextCount),
      diagnostics: diagnostics.length,
    });
  }

  return { generatedAt: new Date().toISOString(), totals, boards };
}

export async function runSummary(argv: readonly string[]): Promise<number> {
  let pretty = false;
  let next: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--pretty") pretty = true;
    else if (arg === "--next") next = Number(argv[++i]);
    else if (arg.startsWith("--next=")) next = Number(arg.slice("--next=".length));
    else {
      console.error(`tuiboard summary: unknown argument "${arg}"`);
      return 2;
    }
  }

  if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
    console.error("tuiboard summary: --next needs a non-negative number");
    return 2;
  }

  const summary = buildSummary({ next });
  process.stdout.write(
    (pretty ? JSON.stringify(summary, null, 2) : JSON.stringify(summary)) + "\n",
  );
  return 0;
}
