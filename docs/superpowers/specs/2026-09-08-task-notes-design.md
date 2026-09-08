# tuiboard Task Notes — Design Doc

**Date:** 2026-09-08
**Status:** Draft for review
**Author:** Claude Opus 5 + Nazz

---

## 1. Context

A task line is one line. When it needs more — a brief, a decision, a runbook — the note lives in another file, and today tuiboard can only point at it: the detail view lists the wikilinks under the heading *"open in Obsidian"* and stops there. On a machine without Obsidian that heading is a dead end.

This has never worked differently. Checked before designing: `ui/Modal.tsx` contains no file read at all, and `git log -S` across every branch finds no linked-note reader that was later removed. The expectation comes from Obsidian itself, where opening a kanban card shows the note.

Two facts from the existing code shape the work:

**The parser keeps the wrong half of the link.** `parser/markdown.ts:269` stores the *displayed* text — the alias when there is one:

```js
const wikilinks = Array.from(body.matchAll(RE_WIKILINK), (m) => m[2] ?? m[1]!);
//                                             alias  ↑        ↑ target
```

For `[[SEO Catalog Brand Pages|SEO catalog — indicizzazione brand pages]]` the file is named after the target, so what tuiboard currently retains cannot find it.

**Links are used two ways in a real board**, and conflating them would fill the detail view with the wrong document:

```
- [ ] [[SEO Catalog Brand Pages|SEO catalog — indicizzazione…]]   the task IS the note
- [x] Mandare materiale a [[Lisa Montagner]] (sblocca…)           a mention
```

## 2. Goals

- Read a task's note inside tuiboard, without Obsidian and without leaving the terminal.
- Work on plain markdown: a project that never heard of wikilinks must be able to use the feature with `[text](path.md)`.
- Cost nothing to the majority of tasks, which have no note and need none.

## 3. Non-goals

- **No note creation.** Most tasks are self-explanatory in their title; a "create the missing note" action would serve a case that barely exists. Notes are created however markdown files are created.
- **No editing.** Reading is what the detail view is for; editing belongs to an editor.
- **No rendering of markdown** beyond showing the text: no bold, no headings styling, no links made clickable. The note is shown, not interpreted.
- **No new configuration.** The search root is inferred from the boards, as the new-board path already is.

## 4. The convention

**A task's note is the link that wraps its title**, in either form:

```
- [ ] [[Nome nota|Titolo mostrato]]        wiki style
- [ ] [Titolo mostrato](Tasks/Nome.md)     plain markdown
```

Both from day one. The second is how any markdown document links another, and without it the tool stays a satellite of Obsidian rather than something that stands on its own conventions.

A link **inside** the sentence stays a reference: listed as today, never opened as context. That distinction is what keeps `Mandare materiale a [[Lisa Montagner]]` from showing a person's card as if it were the task's brief — and it is a convention the user already followed without having declared it.

"Wraps the title" means the link is the first thing in the task body, before any metadata. Trailing metadata (dates, tags, priority) does not disqualify it.

## 5. Components

### Parser — `src/parser/markdown.ts`

```ts
interface TaskNoteLink {
  /** What to resolve: a note name (wiki) or a path relative to the board. */
  target: string;
  kind: "wikilink" | "path";
}
// on Task:
note?: TaskNoteLink;
```

Populated only when the link wraps the title. `wikilinks` keeps its current meaning and contents — the references list — so nothing that reads it changes behaviour, and `displayTitle` keeps showing the alias exactly as it does today.

### Resolver — `src/notes/` (new, pure)

```ts
function buildNoteIndex(root: string): NoteIndex        // every .md under root, by name
function resolveNote(link: TaskNoteLink, ctx: {
  index: NoteIndex; boardPath: string;
}): { path: string; shadowed?: string[] } | { missing: string }
function readNoteBody(path: string): string             // frontmatter stripped
```

A `path` link resolves against the board file's directory — no index needed. A `wikilink` resolves by name against the index, which is built from the boards' common directory (the same inference `suggestBoardsDir` already makes) and cached for the session, rebuilt by `r` along with everything else. Scanning 1191 files takes milliseconds; doing it per keystroke would not.

Name matching ignores case and the `.md` extension, as Obsidian does, so notes written by hand still resolve.

### Detail view — `src/ui/Modal.tsx`

Under the metadata: the note's body in a `<scrollbox>` driven by `j`/`k`, headed by the resolved path so it is clear *which* file is being read. Frontmatter is stripped — it is configuration, not context.

In single-pane the detail view already fills the screen, which is what makes a long note usable; in the four-zone layout it keeps the Agenda slot's width and scrolls.

## 6. Edge cases

| Situation | Behaviour |
|---|---|
| No link in the title | No section at all. This is most tasks, and it must produce no noise |
| Link in the title that does not resolve | Says which name was searched and under which root. A broken link is a fact worth surfacing, not a blank space |
| Two notes with the same name | The one nearest the board wins; the detail says an homonym was shadowed, naming it |
| Very long note | Scrolls. No silent truncation |
| Unreadable note (permissions, deleted mid-session) | The error takes the body's place; the rest of the detail still renders |
| Note is empty | Says so, rather than showing an empty frame that reads as a bug |

## 7. Testing

`src/notes/notes.test.ts`, temp directory, the shape used by `boards/` and `pane-ring`:

- a simple name, a name with an alias, a relative path, a name differing only in case
- homonyms: the nearest wins, and the shadowed one is reported
- missing target: reported as missing, with the name searched
- frontmatter stripped from the body; a note without frontmatter is unharmed
- the index ignores non-markdown files and does not explode on an unreadable directory

Parser tests: a title-link produces `note`, an inline link does not, `displayTitle` is unchanged for both, and a task with both a title-link and inline mentions keeps them in the right places.

The rendering is not unit-tested: it is a thin consumer, and the pty walk covers it from the outside.

## 8. Build phasing

1. Parser: `note` field + tests. Nothing reads it yet.
2. `src/notes/` resolver and reader + tests. No UI.
3. Detail view renders the body, with the scrollbox and `j`/`k`.
4. A pty check at 60 columns on a real linked note.

## 9. Risks & open issues

- **The index is a session-level cache.** A note created after launch is not found until `r`. The alternative — watching the whole tree — costs a second chokidar watcher over a thousand files to save a keystroke that already exists.
- **"Wraps the title" is a rule with an edge**: a task whose title legitimately starts with a link to a person (`[[Lisa Montagner]] deve mandarci il file`) would be read as having that person's note as context. Rare, and visible when it happens — the detail names the file it opened.
- **Name collisions across folders are resolved by proximity**, which is a guess. It is reported rather than hidden, so a wrong guess is diagnosable instead of mysterious.

## 10. Decisions captured

- **The note is the link that wraps the title**; inline links stay references.
- **Both wiki and markdown link forms**, so the convention does not depend on Obsidian.
- **No creation, no editing, no markdown rendering** — reading is the whole feature.
- **The search root is inferred from the boards**, not configured.
- **Absent note is silence, broken link is a message.**
