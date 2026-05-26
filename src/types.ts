/**
 * Core data model for tuiboard.
 *
 * Design principle: parsing is *lossy by selection, not by destruction*.
 * We extract the structured fields we know about (dates, assignee, time block,
 * priority, tags, wikilinks), but we always keep `rawBody` and `rawLine` so
 * serialization can round-trip a board file without losing unknown emoji,
 * Obsidian-specific syntax, or decorative content.
 */

export type ISODate = string; // YYYY-MM-DD

export interface TimeBlock {
  /** Minutes since midnight, inclusive. */
  startMin: number;
  /** Minutes since midnight, exclusive. */
  endMin: number;
}

/** Where the time block was found in the source — drives writer behavior. */
export type TimeBlockSource = "legacy-prefix" | "watch-emoji";

export interface Task {
  /** Stable identity within a board: `${columnIndex}:${indexInColumn}`. */
  id: string;
  done: boolean;
  /** Raw markdown body after the `- [ ] ` / `- [x] ` prefix, verbatim. */
  rawBody: string;
  /** Whole raw source line, used for verbatim round-trip until edited. */
  rawLine: string;
  /** Display-friendly title with metadata stripped — derived, do not store source-of-truth here. */
  displayTitle: string;

  // --- Parsed metadata ---
  assignee?: string;
  tags: string[];
  /** Wikilinks: alias if present, otherwise target. */
  wikilinks: string[];
  scheduled?: ISODate;
  due?: ISODate;
  start?: ISODate;
  doneDate?: ISODate;
  priority: PriorityLevel;
  timeBlock?: TimeBlock;
  timeBlockSource?: TimeBlockSource;
}

/** Tasks-plugin priority emojis, in order. `none` = unset. */
export type PriorityLevel =
  | "highest" //  🔺
  | "high"    //  ⏫
  | "medium"  //  🔼
  | "low"     //  🔽
  | "lowest"  //  ⏬
  | "none";

/** A section separator inside a column (`***` under Kanban plugin convention). */
export interface SectionBreak {
  kind: "section-break";
  rawLine: string;
}

export type ColumnChild = Task | SectionBreak;

export interface Column {
  name: string;
  /** Header level (almost always 2, i.e. `##`). */
  headerLevel: number;
  /** Raw heading line, for verbatim round-trip. */
  rawHeading: string;
  children: ColumnChild[];
}

export interface Board {
  /** Absolute filesystem path. */
  filepath: string;
  /** Display name from frontmatter `name:` or from filename. */
  name: string;
  /** Verbatim frontmatter block including `---` fences, or empty. */
  frontmatter: string;
  columns: Column[];
  /** Trailing content after the last column (e.g. `%% kanban:settings %%`). Verbatim. */
  trailer: string;
  /** Original full text — kept for diffing on conflict detection later. */
  originalContent: string;
}

export interface ParseDiagnostic {
  /** 1-based line number. */
  line: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ParseResult {
  board: Board;
  diagnostics: ParseDiagnostic[];
}
