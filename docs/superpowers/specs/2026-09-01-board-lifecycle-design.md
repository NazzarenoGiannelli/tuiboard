# tuiboard Board Lifecycle — Design Doc

**Date:** 2026-09-01
**Status:** Draft for review
**Author:** Claude Opus 5 + Nazz

---

## 1. Context

tuiboard reads boards but cannot make them. Launch it where no board exists and it prints `No boards found` and exits (`app.tsx:77`); a board's columns can only be created by opening the `.md` in an editor; a new board means hand-editing `config.yaml`. Nothing in `src/config/` ever writes.

That is a bootstrap gap, not a storage problem, and the distinction decides this design. tuiboard does not depend on Obsidian — `scanFallbackBoards()` (`config/loader.ts:324`) already adopts any `.md` in the working directory containing `- [ ]`, and `archiveTask()` (`store/index.ts:1056`) already writes a `## Archive` heading into a board when the column is missing. The ability to generate structure exists; it is scattered and unreachable from the UI.

Plain markdown files are the reason the surrounding system works at all, and this design does not touch that. The Omarchy bar widget reads the same boards through `tuiboard summary` with tuiboard not running. Syncthing replicates them to phone, homebeast and nazzux with no knowledge of the tool. The vault is versioned in git, so every task has a history. The same boards open in Obsidian on a phone. A private store — SQLite, a JSON blob under `~/.local/share` — would trade all of that for an import/export bridge.

What follows makes tuiboard **independent of a pre-existing vault**, not independent of markdown.

## 2. Goals

- Launching `tuiboard` with nothing configured leads to a working board without leaving the TUI and without reading documentation.
- Adopt boards that already exist: point at a directory, see which files are boards, choose.
- Create boards from inside the TUI, with a `+` that behaves like a browser's new-tab button.
- New board files land where the user's other boards live, so they inherit sync, git history and Obsidian rendering for free.
- The same operations are available headless, for scripts and for the widget.

## 3. Non-goals

- **No second discovery mechanism.** `config.yaml` stays the single source of truth for which boards exist. The "home directory" is a *proposed path* for new files, never a directory tuiboard scans behind the user's back.
- **No board removal from the TUI.** Rare, destructive, and ambiguous (does it delete the file?). Deleting a line from the config stays a manual, deliberate act.
- **No column CRUD in this iteration.** New boards get their columns at creation. Renaming and reordering columns is a separate piece of work.
- **No config reload at runtime.** The running session updates its own state; the file on disk serves the next launch and other readers.
- **No new markdown dialect.** Anything written must remain a file Obsidian Kanban still renders.

## 4. Architecture

A new `src/boards/` subsystem owns three operations and knows nothing about a TUI:

```
scanDirectory(dir, config)   → which .md files in this directory are boards
createBoardFile(path, opts)  → write a new board file
addBoardToConfig(entry)      → register it in config.yaml (creating the file if absent)
```

Each is a pure filesystem function, testable against a temp directory with no render loop. The modal and the keybinding become thin callers, and a headless CLI wraps the same three functions.

Two structural facts made this the chosen shape over adding to the existing files: `ui/Modal.tsx` is 36.4 kB and `input/handleKey.ts` is 32.6 kB. Both are past the size where behaviour is easy to find, and the risky logic here — editing a config file the user hand-wrote — must be reachable by tests.

### 4.1 Two defects this design must not inherit

**The watcher cannot accept new files.** `createBoardWatcher(filepaths)` (`io/watcher.ts:32`) takes a fixed list at construction and exposes `start`, `stop`, `onChange`, `markSelfWrite` — no `add`. A board adopted at runtime would silently stop reacting to external edits until the next launch. `BoardWatcher` gains `watch(filepath)`, one call to chokidar's `watcher.add()`.

**`loadAll()` writes to `console.error`** when a board fails to parse (`store/index.ts:1387`). Today that only runs before the renderer takes the screen, so it is invisible. Loading a board at runtime through the same path would print over the dashboard — the exact failure fixed in 0.8.5, where two lines of Node warning scrolled the alternate screen and every repaint after landed rows off. Runtime loading returns its error to the caller.

## 5. Components

### New — `src/boards/`

```ts
// scan.ts
interface BoardCandidate {
  path: string;
  suggestedName: string;   // filename without extension
  taskCount: number;
  alreadyInConfig: boolean;
}
function scanDirectory(dir: string, config: Config): BoardCandidate[]

// create.ts
function createBoardFile(path: string, opts: { columns: string[] }): void
// Frontmatter `kanban-plugin: board` + one `## Column` per entry.
// Throws if the file exists. Never overwrites: an .md is someone's work.
// No `%% kanban:settings %%` block — Obsidian writes its own; inventing one
// means guessing a format this project does not control.

// config-writer.ts
function addBoardToConfig(entry: { path: string; name: string }):
  { configPath: string; created: boolean }

// suggest.ts
function suggestBoardsDir(config: Config): string
// The directory the existing boards share, else ~/.local/share/tuiboard/boards
```

`scanFallbackBoards()` in `config/loader.ts` becomes a wrapper over `scan.ts`. The loader already knows how to recognise a board file; the adoption screen needs exactly that. One implementation, two callers.

### Modified

| File | Change |
|---|---|
| `io/watcher.ts` | `watch(filepath)` added to `BoardWatcher` |
| `store/index.ts` | `loadOne(path, name)` extracted from `loadAll`; `addBoard(path, name)` returns a result instead of printing; `ModalKind` gains `{ kind: "board-new" }` |
| `ui/Modal.tsx` | `BoardNewModal` — deliberately thin, the substance lives in `src/boards/` |
| `ui/Chrome.tsx` | `+` chip at the end of the board list, `onMouseDown` like the existing entries (`Chrome.tsx:48`) |
| `input/handleKey.ts` | `+` opens the modal in the board zone (free at that level; currently used only inside a timeline sub-mode) |
| `app.tsx` | Empty `config.boards` mounts the TUI with the modal open instead of `process.exit(1)` |

### New headless command — `cli/board.ts`

```
tuiboard board add --path <file.md> [--name <name>] [--columns "Todo,Doing,Done"]
tuiboard board scan <dir>
```

Twenty lines of argument parsing over the same three functions. It is also the proof that the boundaries hold: if the modal and the CLI share everything but their input, the module is genuinely decoupled.

**One modal, two situations.** First run and `+` open the same screen with a different title. A dedicated welcome screen would be warmer but would be maintained in parallel, and the first run should teach the gesture used forever after.

## 6. Data flow

First run mounts the modal in a mandatory mode: Escape does not dismiss it, because there is nothing underneath. The `+` opens the same modal dismissable.

```
"I already have files"            "Create a new one"
  ↓                                 ↓
ask for a directory               board name
scanDirectory()                   path proposed by suggestBoardsDir()
  ↓                               columns: Todo / Doing / Done (editable)
tick which to adopt                 ↓
                                  createBoardFile()
        ↓                           ↓
        └──────────┬────────────────┘
                   ↓
        addBoardToConfig() → store.addBoard() → watcher.watch()
```

### 6.1 Ordering is the load-bearing decision

```
1. createBoardFile()    the file exists on disk
2. addBoardToConfig()   the board survives the next launch
3. store.addBoard()     the board exists in this session
4. watcher.watch(path)  the board reacts to external edits
```

Disk, then persistence, then memory. Whatever completes before a failure leaves a coherent, conservative state: a file with no config entry is a board to adopt next time; a config entry with a stale session resolves on restart. The reverse order — registering in memory first — produces a board the user sees, types into, and loses on exit. That failure must not be reachable.

**Multiple adoption** runs steps 2–4 per ticked file, and one failure does not stop the others; the modal reports what went in and what did not. Adopting five boards and losing four to one bad file is not acceptable.

**Nothing re-reads the config.** The session updates its own state at step 3. The file on disk serves the next launch and other readers — `summary`, the widget, another instance in another terminal. Reloading the config live would mean rebuilding the store and discarding cursor, marks and undo history: high cost, no gain.

## 7. Error handling

The only module that touches a file it did not write is `addBoardToConfig`, and it carries the weight of this section.

**Three shapes to recognise:** `boards:` as a block list (the current real config), `boards: []` inline, and `boards:` absent. A fourth case — YAML that does not parse — is refused rather than repaired: guessing where to insert two lines in a broken document is how a config gets destroyed.

**Insertion is surgical, never a re-serialisation.** `js-yaml` does not preserve comments, so a read-modify-write cycle would return a reformatted, stripped document. Only one mutation is needed — appending an entry to `boards:` — and text insertion preserves comments, `calendars:`, `zones:`, `resume_command`, key order and indentation *by construction* rather than by remembering to.

**Verify before committing the write.** The resulting text is re-parsed with `js-yaml` and checked to contain the new board. If it does not, the write is abandoned. A failed addition beats a corrupted config.

Writes go through `writeBoardFile()` (temp file + atomic rename), so there is no moment where the config is half-written on disk.

| Situation | Behaviour |
|---|---|
| The `.md` already exists | Never overwritten. Offer to **adopt** it — the "I already have files" case arriving through the wrong door |
| Name already used by another board | Refused. `task --board <name>` resolves by name; two boards sharing one would make the widget's command ambiguous |
| Directory missing or unwritable | Created recursively; if that fails, reported **before** the config is touched, so no entry points at nothing |
| Config unreadable or malformed | Refused, naming file and line. No repair attempt |
| Adopted board disappears later | Already handled — `loadAll` skips it — but the `console.error` becomes an in-TUI notice |
| Path with `~` or relative | Expanded and normalised to absolute before being written. A relative path depends on the launch directory: fragile for the user, meaningless for the widget |

**Partial failure is never dressed up as success.** If the file is created but the config refuses it, the modal says so plainly: *"board created at `<path>`, but not registered: `<reason>`"*. With the ordering above, the work is safe on disk either way.

**No `console.log` from this subsystem.** Errors are returned as values; whoever owns the screen decides how to show them.

## 8. Testing

`src/boards/boards.test.ts`, temp directory, the shape established by `src/cli/headless.test.ts`.

**`addBoardToConfig`** — the most covered, being the only one that edits a file it did not write:

- the three `boards:` shapes (block, inline `[]`, absent key)
- **comments, `calendars:`, `zones:` and `resume_command` still present and byte-identical after the write** — the test that earns the whole no-re-serialisation decision, and it runs against a copy of the real homebeast config, not a three-line fixture
- absent config → created, and readable back through `loadConfig()`
- malformed YAML → refused, file unchanged
- duplicate name → refused, file unchanged

**`createBoardFile`:** the produced file **re-parses through `parseBoard()`** with the expected columns — the test that actually ties the two sides together; existing file → throws with content intact; frontmatter survives a `serializeBoard()` round trip.

**`scanDirectory`:** recognises `.md` files with tasks, ignores those without, marks those already in the config, and does not throw on an empty or missing directory.

**Declared out of scope:** the modal and the chip. They are thin callers, and testing an OpenTUI render costs more than it protects. `tuiboard board add` exercises the whole chain from the command line instead — the second reason it exists.

**Infrastructure, small and longer-lived than the tests above:**

- **`roundtrip-check` in CI.** Once tuiboard generates its own files, the temptation to write something only it understands becomes real, and the vault opened in Obsidian on a phone is what pays. A rule nobody enforces is a preference.
- **TDD for `src/boards/`.** Clean inputs and outputs, the ideal case. The comment-preservation test in particular should be watched to fail before it is watched to pass.

## 9. Build phasing

1. `src/boards/` with tests — scan, create, config-writer, suggest. No UI.
2. `cli/board.ts` — proves the boundaries from outside.
3. `watcher.watch()` + `store.addBoard()` / `loadOne()`.
4. `BoardNewModal` + the `+` chip + the keybinding.
5. `app.tsx` first-run path.
6. `roundtrip-check` in CI.

Phases 1–2 are shippable on their own: they make board creation scriptable even before the TUI grows a button.

## 10. Risks & open issues

- **The config writer is the single risky component.** It edits a hand-maintained file. Mitigations: surgical insertion, re-parse before committing, atomic write, refusal on anything unexpected — and a test against a real config rather than a fixture.
- **Dialect drift.** Every future feature must round-trip through markdown that Obsidian Kanban still renders. `roundtrip-check` in CI is the enforcement, and it is in the plan for that reason.
- **Two boards with the same name** are refused at creation, but a config hand-edited later can still contain a duplicate. Out of scope here; `tuiboard task` would need to report the ambiguity rather than pick one.
- **`suggestBoardsDir` guesses.** Boards spread across several directories yield no common parent and the proposal falls back to the home directory. The path is always shown and editable before confirming, so a wrong guess costs a keystroke, not a misplaced file.

## 11. Decisions captured

- **Markdown files stay the only storage.** They are why the widget, Syncthing, git history and Obsidian-on-phone all work without integration code.
- **tuiboard writes the config but never rewrites it.** Surgical insertion only; comments and hand-written settings survive by construction.
- **`config.yaml` remains the single source of truth.** The home directory is a default path, not a scanned source — which removes any question of precedence between two sources.
- **New boards default to where the existing boards live**, so they inherit sync and versioning; the fallback is `~/.local/share/tuiboard/boards/`.
- **Onboarding lives inside the TUI**, not in a separate `init` command: an error message pointing at a second command changes the shape of the current defect instead of removing it.
- **One modal serves both first run and `+`.**
- **New boards carry Obsidian Kanban frontmatter** and three editable default columns.
- **Board removal and column CRUD are out of scope** for this iteration.
