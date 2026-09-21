/**
 * Just enough markdown for reading a note in a dialog: the file is shown, not
 * edited, so the markers that only matter to an editor go away (`**`, `#`,
 * link targets, `[[ ]]`) and what they meant becomes colour and weight.
 *
 * Deliberately line-based and forgiving — anything it doesn't recognise is
 * printed as written, never dropped. Pure so the rules can be tested without
 * a renderer.
 */

export type MdStyle = "text" | "bold" | "italic" | "code" | "link" | "wikilink" | "dim";

export interface MdSpan {
  text: string;
  style: MdStyle;
}

export type MdLineKind = "heading" | "text" | "quote" | "code" | "rule" | "blank";

export interface MdLine {
  kind: MdLineKind;
  /** Heading depth (1–6); only set on headings. */
  level?: number;
  /** Leading glyph + indent for list items and quotes, e.g. "  • ". */
  prefix?: string;
  spans: MdSpan[];
}

// Order matters: code first (its content is literal), then links, then emphasis.
const INLINE =
  /(`[^`]+`)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w]))/g;

export function parseInline(src: string): MdSpan[] {
  const out: MdSpan[] = [];
  let last = 0;
  const push = (text: string, style: MdStyle) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.style === style) prev.text += text;
    else out.push({ text, style });
  };
  for (const m of src.matchAll(INLINE)) {
    push(src.slice(last, m.index), "text");
    const [tok, code, wiki, link, bold] = m;
    if (code) push(tok.slice(1, -1), "code");
    else if (wiki) {
      const inner = tok.slice(2, -2);
      const bar = inner.indexOf("|");
      push(bar >= 0 ? inner.slice(bar + 1) : inner.replace(/#.*$/, ""), "wikilink");
    } else if (link) push(tok.slice(1, tok.indexOf("](")), "link");
    else if (bold) {
      // Links inside bold keep their own colour; the rest is bold.
      for (const s of parseInline(tok.slice(2, -2))) push(s.text, s.style === "text" ? "bold" : s.style);
    } else push(tok.slice(1, -1), "italic");
    last = m.index! + tok.length;
  }
  push(src.slice(last), "text");
  return out;
}

export function markdownLines(body: string): MdLine[] {
  const lines: MdLine[] = [];
  let fence: string | undefined;
  let inFrontmatter = false;
  const src = body.replace(/\r\n?/g, "\n").split("\n");

  src.forEach((raw, i) => {
    // YAML frontmatter is metadata for the editor, not something to read.
    if (i === 0 && raw.trim() === "---") return void (inFrontmatter = true);
    if (inFrontmatter) {
      if (raw.trim() === "---") inFrontmatter = false;
      return;
    }

    const fenceMatch = raw.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      fence = fence ? undefined : fenceMatch[1];
      return;
    }
    if (fence) return void lines.push({ kind: "code", spans: [{ text: raw, style: "code" }] });

    if (raw.trim() === "") return void lines.push({ kind: "blank", spans: [] });

    const heading = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      return void lines.push({ kind: "heading", level: heading[1]!.length, spans: parseInline(heading[2]!) });
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) return void lines.push({ kind: "rule", spans: [] });

    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) return void lines.push({ kind: "quote", prefix: "│ ", spans: parseInline(quote[1]!) });

    const item = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/);
    if (item) {
      const indent = " ".repeat(Math.floor(item[1]!.replace(/\t/g, "  ").length / 2) * 2);
      const box = item[3];
      const glyph = box === undefined ? (/\d/.test(item[2]!) ? item[2]! : "•") : box === " " ? "○" : "✓";
      return void lines.push({ kind: "text", prefix: `${indent}${glyph} `, spans: parseInline(item[4]!) });
    }

    lines.push({ kind: "text", spans: parseInline(raw.trim()) });
  });

  // Collapse runs of blank lines, and trim them at both ends.
  const out = lines.filter((l, i, all) => l.kind !== "blank" || all[i - 1]?.kind !== "blank");
  while (out[0]?.kind === "blank") out.shift();
  while (out[out.length - 1]?.kind === "blank") out.pop();
  return out;
}
