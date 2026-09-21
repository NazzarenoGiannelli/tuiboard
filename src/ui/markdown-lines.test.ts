import { describe, expect, it } from "bun:test";

import { markdownLines, parseInline } from "./markdown-lines";

describe("parseInline", () => {
  it("keeps plain text as one span", () => {
    expect(parseInline("just words")).toEqual([{ text: "just words", style: "text" }]);
  });

  it("drops markers and keeps what they meant", () => {
    expect(parseInline("**Tre PR:** [BE#328](https://x.dev/pull/328) e `rebase`")).toEqual([
      { text: "Tre PR:", style: "bold" },
      { text: " ", style: "text" },
      { text: "BE#328", style: "link" },
      { text: " e ", style: "text" },
      { text: "rebase", style: "code" },
    ]);
  });

  it("shows a wikilink by its alias, else its name without the heading", () => {
    expect(parseInline("[[Tasks - R3PLICA]] · [[Nazz Network|rete]] · [[Home#Porte]]")).toEqual([
      { text: "Tasks - R3PLICA", style: "wikilink" },
      { text: " · ", style: "text" },
      { text: "rete", style: "wikilink" },
      { text: " · ", style: "text" },
      { text: "Home", style: "wikilink" },
    ]);
  });

  it("keeps a link's colour inside bold", () => {
    expect(parseInline("**[BE#336](https://x)**: tre domande")).toEqual([
      { text: "BE#336", style: "link" },
      { text: ": tre domande", style: "text" },
    ]);
  });

  it("reads italics but leaves snake_case and lone asterisks alone", () => {
    expect(parseInline("*piano* e _nota_")).toEqual([
      { text: "piano", style: "italic" },
      { text: " e ", style: "text" },
      { text: "nota", style: "italic" },
    ]);
    expect(parseInline("run my_long_name * 2")).toEqual([{ text: "run my_long_name * 2", style: "text" }]);
  });
});

describe("markdownLines", () => {
  it("renders headings, lists, checkboxes, quotes and rules", () => {
    const lines = markdownLines(
      ["# Home", "", "- uno", "  - due", "3. tre", "- [ ] da fare", "- [x] fatto", "> citazione", "---", "testo"].join("\n"),
    );
    expect(lines.map((l) => [l.kind, l.prefix ?? "", l.spans.map((s) => s.text).join("")])).toEqual([
      ["heading", "", "Home"],
      ["blank", "", ""],
      ["text", "• ", "uno"],
      ["text", "  • ", "due"],
      ["text", "3. ", "tre"],
      ["text", "○ ", "da fare"],
      ["text", "✓ ", "fatto"],
      ["quote", "│ ", "citazione"],
      ["rule", "", ""],
      ["text", "", "testo"],
    ]);
    expect(lines[0]!.level).toBe(1);
  });

  it("skips frontmatter and keeps code blocks literal", () => {
    const lines = markdownLines(["---", "updated: 2026-09-21", "---", "", "```", "**not bold**", "```"].join("\n"));
    expect(lines).toEqual([{ kind: "code", spans: [{ text: "**not bold**", style: "code" }] }]);
  });

  it("collapses blank runs and trims them at the ends", () => {
    const kinds = markdownLines("\n\na\n\n\n\nb\n\n").map((l) => l.kind);
    expect(kinds).toEqual(["text", "blank", "text"]);
  });

  it("handles CRLF files", () => {
    expect(markdownLines("# A\r\n\r\nb").map((l) => l.kind)).toEqual(["heading", "blank", "text"]);
  });
});
