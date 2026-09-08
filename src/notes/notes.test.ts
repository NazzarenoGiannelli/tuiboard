/**
 * Task notes: recognising the link that carries a task's context, finding the
 * file it points at, and reading it.
 *
 * The convention has to hold without Obsidian, so both link forms are tested
 * as equals: `[[Name|shown]]` and `[shown](path/Name.md)`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseBoard } from "~/parser/markdown";
import { buildNoteIndex, readNoteBody, resolveNote } from "./index";

let dir: string;
let boardPath: string;

/** Parse one task line and hand back the Task. */
function task(line: string) {
  const md = `## Column\n${line}\n`;
  const { board } = parseBoard(md, { filepath: boardPath });
  const first = board.columns[0]!.children[0]!;
  if (!("displayTitle" in first)) throw new Error("not a task");
  return first;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tuiboard-notes-"));
  boardPath = join(dir, "Board.md");
  mkdirSync(join(dir, "Tasks"), { recursive: true });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("recognising a task's note", () => {
  it("takes a wikilink that wraps the title", () => {
    const t = task("- [ ] [[SEO Catalog|SEO catalog — brand pages]] ⏳ 2026-09-08");
    expect(t.note).toEqual({ target: "SEO Catalog", kind: "wikilink" });
  });

  it("takes a markdown link that wraps the title — no Obsidian required", () => {
    const t = task("- [ ] [SEO catalog](Tasks/SEO Catalog.md) ⏳ 2026-09-08");
    expect(t.note).toEqual({ target: "Tasks/SEO Catalog.md", kind: "path" });
  });

  it("ignores a link inside the sentence — that is a mention, not context", () => {
    const t = task("- [x] Mandare materiale a [[Lisa Montagner]] (sblocca produzione)");
    expect(t.note).toBeUndefined();
    expect(t.wikilinks).toContain("Lisa Montagner");
  });

  it("leaves the displayed title exactly as it was", () => {
    expect(task("- [ ] [[SEO Catalog|SEO catalog — brand pages]]").displayTitle)
      .toBe("SEO catalog — brand pages");
    expect(task("- [ ] [SEO catalog](Tasks/SEO Catalog.md)").displayTitle)
      .toBe("SEO catalog");
  });

  it("keeps both when a task has a note and a mention", () => {
    const t = task("- [ ] [[Runbook Deploy|Deploy]] con [[Lisa Montagner]]");
    expect(t.note?.target).toBe("Runbook Deploy");
    expect(t.wikilinks).toContain("Lisa Montagner");
  });

  it("has no note when the title is plain text — most tasks", () => {
    expect(task("- [ ] Comprare il latte ⏳ 2026-09-08").note).toBeUndefined();
  });
});

describe("resolving a note to a file", () => {
  function index() {
    return buildNoteIndex(dir);
  }

  it("finds a wikilink by name, anywhere under the root", () => {
    writeFileSync(join(dir, "Tasks", "SEO Catalog.md"), "# SEO\n", "utf-8");
    const hit = resolveNote({ target: "SEO Catalog", kind: "wikilink" }, {
      index: index(),
      boardPath,
    });
    expect(hit).toMatchObject({ path: join(dir, "Tasks", "SEO Catalog.md") });
  });

  it("matches regardless of case and of a written-out .md", () => {
    writeFileSync(join(dir, "Tasks", "SEO Catalog.md"), "# SEO\n", "utf-8");
    const ctx = { index: index(), boardPath };
    expect(resolveNote({ target: "seo catalog", kind: "wikilink" }, ctx)).toMatchObject({
      path: join(dir, "Tasks", "SEO Catalog.md"),
    });
    expect(resolveNote({ target: "SEO Catalog.md", kind: "wikilink" }, ctx)).toMatchObject({
      path: join(dir, "Tasks", "SEO Catalog.md"),
    });
  });

  it("resolves a path against the board's own directory", () => {
    writeFileSync(join(dir, "Tasks", "Runbook.md"), "# Run\n", "utf-8");
    const hit = resolveNote({ target: "Tasks/Runbook.md", kind: "path" }, {
      index: index(),
      boardPath,
    });
    expect(hit).toMatchObject({ path: join(dir, "Tasks", "Runbook.md") });
  });

  it("prefers the note nearest the board and says which one it shadowed", () => {
    mkdirSync(join(dir, "Archivio"), { recursive: true });
    writeFileSync(join(dir, "Doppia.md"), "vicina\n", "utf-8");
    writeFileSync(join(dir, "Archivio", "Doppia.md"), "lontana\n", "utf-8");

    const hit = resolveNote({ target: "Doppia", kind: "wikilink" }, {
      index: index(),
      boardPath,
    });
    expect(hit).toMatchObject({ path: join(dir, "Doppia.md") });
    expect((hit as { shadowed?: string[] }).shadowed).toEqual([
      join(dir, "Archivio", "Doppia.md"),
    ]);
  });

  it("reports a missing target by name instead of failing silently", () => {
    expect(resolveNote({ target: "Non Esiste", kind: "wikilink" }, {
      index: index(),
      boardPath,
    })).toEqual({ missing: "Non Esiste" });
  });

  it("indexes only markdown, and survives an unreadable root", () => {
    writeFileSync(join(dir, "Tasks", "nota.md"), "x\n", "utf-8");
    writeFileSync(join(dir, "Tasks", "immagine.png"), "x\n", "utf-8");
    expect(Object.keys(buildNoteIndex(dir)).length).toBe(1);
    expect(buildNoteIndex(join(dir, "non-esiste"))).toEqual({});
  });
});

describe("reading a note", () => {
  it("strips the frontmatter — that is configuration, not context", () => {
    const p = join(dir, "Nota.md");
    writeFileSync(p, "---\ntype: task\ntags: [a]\n---\n\n# Titolo\n\nCorpo.\n", "utf-8");
    expect(readNoteBody(p)).toBe("# Titolo\n\nCorpo.");
  });

  it("leaves a note without frontmatter untouched", () => {
    const p = join(dir, "Nota.md");
    writeFileSync(p, "# Titolo\n\nCorpo.\n", "utf-8");
    expect(readNoteBody(p)).toBe("# Titolo\n\nCorpo.");
  });

  it("returns an empty string for an empty note, and does not throw on a missing one", () => {
    const p = join(dir, "Vuota.md");
    writeFileSync(p, "---\ntype: x\n---\n", "utf-8");
    expect(readNoteBody(p)).toBe("");
    expect(() => readNoteBody(join(dir, "assente.md"))).toThrow();
  });
});
