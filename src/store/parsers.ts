/**
 * Natural-language parsers for modal inputs.
 *
 * Date input shortcuts:
 *   t                 → today
 *   m | tm | tom      → tomorrow  (m matches the board's `m` = tomorrow key)
 *   -N                → N days ago
 *   +N                → N days ahead
 *   lun/mar/.../dom   → next weekday (Italian short)
 *   mon/tue/.../sun   → next weekday (English short)
 *   YYYY-MM-DD        → literal
 *   DD                → next DD of current or next month
 *   DD-MM             → DD of MM of current or next year
 *   ""                → clear (returns undefined)
 *
 * Time-block input shortcuts:
 *   n                 → now → now+30min
 *   HH:MM             → HH:MM → HH:MM+30min
 *   HH:MM-HH:MM       → literal range
 *   HH:MM HH:MM       → range (space-separated)
 *   -                 → clear (returns undefined)
 *
 * Quick-add task input: free text with inline metadata
 *   "Fix auth @nazza t 9-11 #pr #urgent 🔺"
 *   Parses the metadata tokens, leaves the rest as title.
 */

import { isoDate, isoToday, isoTomorrow } from "~/store/index";
import type { PriorityLevel, TimeBlock } from "~/types";

// ─── Date ────────────────────────────────────────────────────────────────────

const WEEKDAYS_IT: Record<string, number> = {
  dom: 0, lun: 1, mar: 2, mer: 3, gio: 4, ven: 5, sab: 6,
};
const WEEKDAYS_EN: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export function parseDateShortcut(input: string): string | undefined | null {
  // Returns:
  //   string         → ISO date
  //   undefined      → clear date
  //   null           → parse failed (caller shows error)
  const s = input.trim().toLowerCase();
  if (s === "") return undefined;
  if (s === "-") return undefined;

  if (s === "t" || s === "today" || s === "oggi") return isoToday();
  // `m` mirrors the board's `m` = tomorrow key; `tm`/`tom`/… kept as aliases.
  if (s === "m" || s === "tm" || s === "tom" || s === "tomorrow" || s === "domani") return isoTomorrow();

  // Relative ±N
  const rel = s.match(/^([+-])(\d+)$/);
  if (rel) {
    const sign = rel[1] === "+" ? 1 : -1;
    const n = parseInt(rel[2]!, 10);
    const d = new Date();
    d.setDate(d.getDate() + sign * n);
    return isoDate(d);
  }

  // ISO YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(
      parseInt(iso[1]!, 10),
      parseInt(iso[2]!, 10) - 1,
      parseInt(iso[3]!, 10),
    );
    if (Number.isNaN(d.getTime())) return null;
    return isoDate(d);
  }

  // DD-MM (current or next year if past)
  const ddmm = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (ddmm) {
    const day = parseInt(ddmm[1]!, 10);
    const mon = parseInt(ddmm[2]!, 10);
    const now = new Date();
    let candidate = new Date(now.getFullYear(), mon - 1, day);
    if (Number.isNaN(candidate.getTime())) return null;
    if (candidate < now) {
      candidate = new Date(now.getFullYear() + 1, mon - 1, day);
    }
    return isoDate(candidate);
  }

  // DD only
  const dd = s.match(/^(\d{1,2})$/);
  if (dd) {
    const day = parseInt(dd[1]!, 10);
    if (day < 1 || day > 31) return null;
    const now = new Date();
    let candidate = new Date(now.getFullYear(), now.getMonth(), day);
    if (candidate < now) {
      candidate = new Date(now.getFullYear(), now.getMonth() + 1, day);
    }
    return isoDate(candidate);
  }

  // Weekday
  const wd = WEEKDAYS_IT[s] ?? WEEKDAYS_EN[s];
  if (wd !== undefined) {
    const now = new Date();
    const cur = now.getDay();
    let delta = wd - cur;
    if (delta <= 0) delta += 7;
    const d = new Date();
    d.setDate(d.getDate() + delta);
    return isoDate(d);
  }

  return null;
}

// ─── Time block ──────────────────────────────────────────────────────────────

export function parseTimeBlockShortcut(input: string): TimeBlock | undefined | null {
  const s = input.trim();
  if (s === "" || s === "-") return undefined;

  if (s.toLowerCase() === "n" || s.toLowerCase() === "now") {
    const now = new Date();
    const start = now.getHours() * 60 + now.getMinutes();
    return { startMin: start, endMin: Math.min(start + 30, 24 * 60) };
  }

  // HH:MM-HH:MM  or  HH:MM HH:MM  or  HHMM-HHMM (with - or space)
  const range = s.match(/^(\d{1,2}):?(\d{2})\s*[- ]\s*(\d{1,2}):?(\d{2})$/);
  if (range) {
    return makeBlock(range[1]!, range[2]!, range[3]!, range[4]!);
  }
  // Loose `H-H` (e.g. "9-11") → 9:00 to 11:00
  const hh = s.match(/^(\d{1,2})\s*[- ]\s*(\d{1,2})$/);
  if (hh) {
    return makeBlock(hh[1]!, "00", hh[2]!, "00");
  }
  // Single HH:MM → HH:MM to HH:MM+30
  const single = s.match(/^(\d{1,2}):(\d{2})$/);
  if (single) {
    const start = parseInt(single[1]!, 10) * 60 + parseInt(single[2]!, 10);
    return { startMin: start, endMin: Math.min(start + 30, 24 * 60) };
  }
  return null;
}

function makeBlock(h1: string, m1: string, h2: string, m2: string): TimeBlock | null {
  const s = parseInt(h1, 10) * 60 + parseInt(m1, 10);
  const e = parseInt(h2, 10) * 60 + parseInt(m2, 10);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (s < 0 || s >= 24 * 60 || e < 0 || e > 24 * 60 || e <= s) return null;
  return { startMin: s, endMin: e };
}

// ─── Quick add ───────────────────────────────────────────────────────────────

export interface QuickAddResult {
  title: string;
  assignee?: string;
  tags: string[];
  scheduled?: string;
  timeBlock?: TimeBlock;
  priority: PriorityLevel;
}

/**
 * Parse a free-form quick-add string. Recognized tokens:
 *   @name        → assignee
 *   #tag         → tag
 *   t, m, +N     → scheduled date shortcut (m = tomorrow, matches the board key)
 *   YYYY-MM-DD   → scheduled date literal
 *   HH:MM-HH:MM  → time block (also sets scheduled to today if missing)
 *   9-11         → 09:00-11:00 time block
 *   🔺⏫🔼🔽⏬ → priority
 *
 * Tokens are stripped from the title. Order doesn't matter except that the
 * first scheduling token wins.
 */
export function parseQuickAdd(input: string): QuickAddResult {
  const result: QuickAddResult = {
    title: "",
    tags: [],
    priority: "none",
  };

  // Match priority emoji first and remove
  const priorityMap: Record<string, PriorityLevel> = {
    "🔺": "highest",
    "⏫": "high",
    "🔼": "medium",
    "🔽": "low",
    "⏬": "lowest",
  };
  let s = input;
  for (const [emoji, lvl] of Object.entries(priorityMap)) {
    if (s.includes(emoji)) {
      result.priority = lvl;
      s = s.replaceAll(emoji, " ");
    }
  }

  const tokens = s.split(/\s+/).filter(Boolean);
  const remaining: string[] = [];

  for (const tok of tokens) {
    if (tok.startsWith("@") && tok.length > 1) {
      result.assignee = tok.slice(1);
      continue;
    }
    if (tok.startsWith("#") && tok.length > 1) {
      result.tags.push(tok.slice(1));
      continue;
    }
    // Time block: HH:MM-HH:MM or H-H
    const tb = parseTimeBlockShortcut(tok);
    if (tb && tb !== null) {
      if (!result.timeBlock) {
        result.timeBlock = tb;
        if (!result.scheduled) result.scheduled = isoToday();
      }
      continue;
    }
    // Date: t, m/tm, +N, YYYY-MM-DD
    const lower = tok.toLowerCase();
    if (
      lower === "t" || lower === "m" || lower === "tm" || lower === "tom" ||
      lower === "today" || lower === "tomorrow" ||
      lower === "oggi" || lower === "domani" ||
      /^[+-]\d+$/.test(lower) ||
      /^\d{4}-\d{2}-\d{2}$/.test(lower)
    ) {
      const d = parseDateShortcut(lower);
      if (typeof d === "string" && !result.scheduled) {
        result.scheduled = d;
        continue;
      }
    }
    remaining.push(tok);
  }

  result.title = remaining.join(" ").trim();
  return result;
}
