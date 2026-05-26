/**
 * Markdown board parser.
 *
 * Reads a board file (Obsidian-Kanban-plugin-compatible markdown) and produces
 * a structured `Board`. Designed to be *lossless on round-trip*: anything we
 * don't understand is preserved verbatim (frontmatter, trailing kanban-plugin
 * settings, decorative emoji in task bodies, unusual whitespace).
 *
 * Supports both:
 *   - Legacy `HH:MM-HH:MM ` time block prefix (Python tools' format)
 *   - New canonical `⌚ HH:MM-HH:MM` anywhere (tuiboard's format)
 *
 * The serializer (Day 2) will always emit the new canonical form on write,
 * so the format migrates organically through normal editing.
 */

import { basename, extname } from "node:path";
import type {
  Board,
  Column,
  ColumnChild,
  ParseDiagnostic,
  ParseResult,
  PriorityLevel,
  SectionBreak,
  Task,
  TimeBlock,
  TimeBlockSource,
} from "~/types";

// ─── Regexes ─────────────────────────────────────────────────────────────────

const RE_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const RE_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RE_TASK = /^- \[([ xX])\]\s?(.*)$/;
const RE_SECTION_BREAK = /^\*\*\*\s*$/;
const RE_KANBAN_SETTINGS_START = /^%%\s*kanban:settings\s*$/i;
const RE_KANBAN_SETTINGS_END = /^%%\s*$/;

// Metadata patterns scanned in task body
const RE_TIME_PREFIX = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+/;
const RE_TIME_WATCH = /⌚\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;
const RE_SCHED = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const RE_DUE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const RE_START = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const RE_DONE_D = /✅\s*(\d{4}-\d{2}-\d{2})/;
const RE_ASSIGNEE = /@([A-Za-z][A-Za-z0-9_-]*)/;
const RE_TAG = /(?<![&\w])#([\w][\w-]*)/g; // avoid matching #fragments inside e.g. `&#x...;`
const RE_WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

// Priority emoji → level. Order matters: scan from highest to lowest.
const PRIORITY_EMOJI: Array<[string, PriorityLevel]> = [
  ["🔺", "highest"],
  ["⏫", "high"],
  ["🔼", "medium"],
  ["🔽", "low"],
  ["⏬", "lowest"],
];

// Decorative emoji we strip from displayTitle but preserve in rawBody.
// 🔥 = "urgent" visual, ⚪ = "backlog" visual, 📋 = "list" visual.
const DECORATIVE_EMOJI = ["🔥", "⚪", "📋"];

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ParseOptions {
  filepath: string;
}

export function parseBoard(
  content: string,
  { filepath }: ParseOptions,
): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];

  // 1. Strip frontmatter (verbatim block to preserve).
  const fmMatch = content.match(RE_FRONTMATTER);
  let frontmatter = "";
  let body = content;
  let bodyStartLine = 1;
  if (fmMatch) {
    frontmatter = fmMatch[0];
    body = content.slice(fmMatch[0].length);
    bodyStartLine = 1 + frontmatter.split(/\r?\n/).length - 1;
  }

  // 2. Identify trailer (everything from `%% kanban:settings %%` onwards).
  const lines = body.split(/\r?\n/);
  let trailerStart = lines.length;
  let inSettings = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inSettings && RE_KANBAN_SETTINGS_START.test(line)) {
      trailerStart = i;
      inSettings = true;
      break;
    }
  }
  const trailer = lines.slice(trailerStart).join("\n");
  const bodyLines = lines.slice(0, trailerStart);

  // 3. Walk lines: build columns from `## Heading`, children from tasks /
  //    section breaks. Lines that are neither become "loose" — for now we
  //    drop them but keep a diagnostic. (Day 2: attach to nearest task as
  //    continuation, e.g. nested bullet under a card.)
  const columns: Column[] = [];
  let current: Column | undefined;
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i]!;
    const lineNo = bodyStartLine + i;
    const trimmed = raw.trim();

    if (trimmed === "") continue;

    const h = raw.match(RE_HEADING);
    if (h) {
      const headerLevel = h[1]!.length;
      // We treat ## as canonical column header (Kanban-plugin convention).
      // Other heading levels become columns too, but get a diagnostic.
      if (headerLevel !== 2) {
        diagnostics.push({
          line: lineNo,
          level: "info",
          message: `Heading level ${headerLevel} used as column "${h[2]}".`,
        });
      }
      current = {
        name: h[2]!,
        headerLevel,
        rawHeading: raw,
        children: [],
      };
      columns.push(current);
      continue;
    }

    if (RE_SECTION_BREAK.test(raw)) {
      if (current) {
        current.children.push({ kind: "section-break", rawLine: raw });
      } else {
        diagnostics.push({
          line: lineNo,
          level: "warn",
          message: "Section break (***) outside any column — dropped.",
        });
      }
      continue;
    }

    const tm = raw.match(RE_TASK);
    if (tm) {
      if (!current) {
        diagnostics.push({
          line: lineNo,
          level: "warn",
          message: "Task found outside any column — creating implicit '_' column.",
        });
        current = {
          name: "_",
          headerLevel: 2,
          rawHeading: "## _",
          children: [],
        };
        columns.push(current);
      }
      const task = parseTask({
        rawLine: raw,
        checkboxChar: tm[1]!,
        body: tm[2] ?? "",
        columnIndex: columns.length - 1,
        indexInColumn: current.children.length,
      });
      current.children.push(task);
      continue;
    }

    // Unknown line. Day 2: attach as continuation to previous task if indented.
    diagnostics.push({
      line: lineNo,
      level: "info",
      message: `Unparsed line dropped: "${raw.slice(0, 60)}"`,
    });
  }

  const board: Board = {
    filepath,
    name: extractBoardName(frontmatter, filepath),
    frontmatter,
    columns,
    trailer,
    originalContent: content,
  };

  return { board, diagnostics };
}

// ─── Task parsing ────────────────────────────────────────────────────────────

interface ParseTaskInput {
  rawLine: string;
  checkboxChar: string;
  body: string;
  columnIndex: number;
  indexInColumn: number;
}

function parseTask(input: ParseTaskInput): Task {
  const { rawLine, checkboxChar, body, columnIndex, indexInColumn } = input;
  const done = checkboxChar.toLowerCase() === "x";

  // Time block — try new canonical first, then legacy prefix.
  let timeBlock: TimeBlock | undefined;
  let timeBlockSource: TimeBlockSource | undefined;
  const watch = body.match(RE_TIME_WATCH);
  if (watch) {
    timeBlock = toTimeBlock(watch[1]!, watch[2]!, watch[3]!, watch[4]!);
    if (timeBlock) timeBlockSource = "watch-emoji";
  } else {
    const prefix = body.match(RE_TIME_PREFIX);
    if (prefix) {
      timeBlock = toTimeBlock(prefix[1]!, prefix[2]!, prefix[3]!, prefix[4]!);
      if (timeBlock) timeBlockSource = "legacy-prefix";
    }
  }

  // Dates
  const sched = body.match(RE_SCHED);
  const due = body.match(RE_DUE);
  const start = body.match(RE_START);
  const doneD = body.match(RE_DONE_D);

  // Assignee
  const am = body.match(RE_ASSIGNEE);

  // Tags (global)
  const tags = Array.from(body.matchAll(RE_TAG), (m) => m[1]!).filter(
    (t): t is string => Boolean(t),
  );

  // Wikilinks — capture displayed text (alias if present, target otherwise)
  const wikilinks = Array.from(body.matchAll(RE_WIKILINK), (m) => m[2] ?? m[1]!);

  // Priority
  let priority: PriorityLevel = "none";
  for (const [emoji, level] of PRIORITY_EMOJI) {
    if (body.includes(emoji)) {
      priority = level;
      break;
    }
  }

  // Display title — stripped of all metadata but preserving readable text.
  const displayTitle = buildDisplayTitle(body, { hasTimeBlockPrefix: timeBlockSource === "legacy-prefix" });

  return {
    id: `${columnIndex}:${indexInColumn}`,
    done,
    rawBody: body,
    rawLine,
    displayTitle,
    assignee: am?.[1],
    tags,
    wikilinks,
    scheduled: sched?.[1],
    due: due?.[1],
    start: start?.[1],
    doneDate: doneD?.[1],
    priority,
    timeBlock,
    timeBlockSource,
  };
}

function toTimeBlock(h1: string, m1: string, h2: string, m2: string): TimeBlock | undefined {
  const startMin = Number(h1) * 60 + Number(m1);
  const endMin = Number(h2) * 60 + Number(m2);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return undefined;
  if (startMin < 0 || endMin < 0 || startMin >= 24 * 60 || endMin > 24 * 60) return undefined;
  if (endMin <= startMin) return undefined;
  return { startMin, endMin };
}

function buildDisplayTitle(
  body: string,
  opts: { hasTimeBlockPrefix: boolean },
): string {
  let t = body;
  if (opts.hasTimeBlockPrefix) t = t.replace(RE_TIME_PREFIX, "");
  t = t.replace(RE_TIME_WATCH, "");
  t = t.replace(RE_SCHED, "");
  t = t.replace(RE_DUE, "");
  t = t.replace(RE_START, "");
  t = t.replace(RE_DONE_D, "");
  t = t.replace(RE_ASSIGNEE, "");
  t = t.replace(RE_TAG, "");
  // Replace wikilinks with their displayed text (alias or target)
  t = t.replace(RE_WIKILINK, (_m, target: string, alias?: string) => alias ?? target);
  // Strip priority and decorative emoji
  for (const [emoji] of PRIORITY_EMOJI) t = t.replaceAll(emoji, "");
  for (const emoji of DECORATIVE_EMOJI) t = t.replaceAll(emoji, "");
  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function extractBoardName(frontmatter: string, filepath: string): string {
  const m = frontmatter.match(/^name:\s*(.+?)\s*$/m);
  if (m) return m[1]!;
  const file = basename(filepath, extname(filepath));
  // "Tasks - R3PLICA" → "R3PLICA"; otherwise use as-is.
  const dash = file.indexOf(" - ");
  return dash >= 0 ? file.slice(dash + 3) : file;
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isTask(child: ColumnChild): child is Task {
  return (child as SectionBreak).kind !== "section-break";
}

export function isSectionBreak(child: ColumnChild): child is SectionBreak {
  return (child as SectionBreak).kind === "section-break";
}
