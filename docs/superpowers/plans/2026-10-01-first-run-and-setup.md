# First run that teaches, and a Setup view: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who has just installed tuiboard reaches a living dashboard without reading the README, and can see from inside the app (and from the shell) what is connected.

**Architecture:** Disk writes stay in `src/boards/` (shared by the wizard and `tuiboard board add`). Copy for empty states lives in one small module so it is testable. Setup is one pure function, `collectSetupStatus`, with injected dependencies; a modal (`S`) and a CLI (`tuiboard doctor`) are thin views over it.

**Tech Stack:** Bun 1.3, TypeScript (strict, `tsc --noEmit`), SolidJS on OpenTUI (`@opentui/solid`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-01-first-run-and-setup-design.md`

**Branch:** `feat/first-run-setup` (built on `feat/update-notice`). Run everything from the repo root, `C:\Users\nazza\Documents\Repos\Personal\tuiboard`.

## Global Constraints

- Bun runtime, no new runtime dependencies. UI copy in English, plain punctuation (no em dashes).
- Every task ends green on `bun run typecheck` and `bun test` (572 tests pass at the start); a task that adds a test adds it before the code.
- Tests never touch the network or the real HOME: use temp dirs and injected dependencies.
- Disk writes for boards stay in `src/boards/`. The Setup view is read-only.
- Paths must work on Windows and POSIX (build expected values with `node:path` `join`).
- The default boards folder changes only for new boards with nothing to learn from; `suggestBoardsDir` keeps putting new boards next to existing ones.
- Existing users see no change: no config key is renamed, no existing board moves.
- `S` is `Shift+S`, checked before the plain `s` (schedule) in `src/input/handleKey.ts`, the way `Shift+T` is handled before `t`.
- Example tasks are plain tasks dated today; the time block starts at the next half hour at least 10 minutes away and lasts 30 minutes; after 22:30 it is 09:00 to 09:30 tomorrow, dated tomorrow.
- Commit messages end with the two lines `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Sck7sfgjtnad3pAyyKVej4`.

## Review Focus

Failure modes the spec implies but the happy-path tests would miss, most likely first; each has a test in the task that owns the code.

1. A user who already has boards in one folder must still get new boards next to them (Task 1).
2. `~/Documents` missing, or a file instead of a folder, must fall back to `~/tuiboard` (Task 1).
3. Late evening and month or year rollover for the example time block: 22:21, 23:55 on the last day of a month, 31 December (Task 2).
4. A board whose first column is `Done` or `Archive` must not put its examples in a hidden column (Task 2).
5. Setup and `doctor` on a machine with no config, no agent folders and a broken token path must not throw and must exit 0 (Tasks 6 and 8).
6. The new welcome paragraph, empty-state copy and Setup modal must fit a 40-column single pane without overflowing (Tasks 4, 5 and 7).
7. Typing a capital S in any input (add, edit, search, wizard) must not open Setup (Task 7).

---

### Task 1: A visible default folder for new boards

**Files:**
- Modify: `src/boards/suggest.ts` (`defaultBoardsDir`, lines 23 to 28)
- Create: `src/boards/suggest.test.ts`

**Interfaces:**
- Produces: `defaultBoardsDir(env?: Record<string, string | undefined>, home?: string, isDir?: (p: string) => boolean): string`. All three parameters are optional and default to the real process, home and file system, so every existing caller (`defaultBoardsDir()` in `suggestBoardsDir`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/boards/suggest.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { defaultBoardsDir, suggestBoardsDir } from "./suggest";

const home = join("home", "me");
const noDirs = () => false;

describe("defaultBoardsDir", () => {
  it("an explicit XDG_DATA_HOME wins, as it always has", () => {
    const xdg = join("srv", "data");
    expect(defaultBoardsDir({ XDG_DATA_HOME: xdg }, home, () => true)).toBe(join(xdg, "tuiboard", "boards"));
  });

  it("uses ~/Documents/tuiboard when Documents exists", () => {
    const docs = join(home, "Documents");
    expect(defaultBoardsDir({}, home, (p) => p === docs)).toBe(join(docs, "tuiboard"));
  });

  it("falls back to ~/tuiboard when there is no Documents folder", () => {
    expect(defaultBoardsDir({}, home, noDirs)).toBe(join(home, "tuiboard"));
  });

  it("a blank XDG_DATA_HOME counts as unset", () => {
    expect(defaultBoardsDir({ XDG_DATA_HOME: "  " }, home, noDirs)).toBe(join(home, "tuiboard"));
  });
});

describe("suggestBoardsDir keeps learning from existing boards", () => {
  it("one shared folder: new boards go next to the others, whatever the default is", () => {
    const dir = join("vault", "tasks");
    expect(suggestBoardsDir({ boards: [{ path: join(dir, "a.md") }, { path: join(dir, "b.md") }] })).toContain("tasks");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/boards/suggest.test.ts`
Expected: FAIL (the new parameters and the Documents rule do not exist yet).

- [ ] **Step 3: Implement**

In `src/boards/suggest.ts`, add `statSync` to the imports (`import { statSync } from "node:fs";`) and replace `defaultBoardsDir` with:

```ts
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where a new board goes when there is nothing to learn from. A folder the user can
 * find in a file manager, not a hidden one:
 *
 *   1. `$XDG_DATA_HOME/tuiboard/boards` when XDG_DATA_HOME is set (they asked for it);
 *   2. `~/Documents/tuiboard` when `~/Documents` exists;
 *   3. `~/tuiboard`.
 */
export function defaultBoardsDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
  isDir: (path: string) => boolean = isDirectory,
): string {
  const xdg = env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) return join(xdg, "tuiboard", "boards");
  const documents = join(home, "Documents");
  return isDir(documents) ? join(documents, "tuiboard") : join(home, "tuiboard");
}
```

Also update the file's header comment: replace "an XDG data directory the app owns" with "a visible `tuiboard` folder (in Documents when there is one)".

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/boards`
Expected: PASS, including the existing `boards.test.ts` (its `suggestBoardsDir` tests only assert `toContain("tuiboard")`).

- [ ] **Step 5: Commit**

```bash
git add src/boards/suggest.ts src/boards/suggest.test.ts
git commit -m "feat: new boards go in a visible folder (Documents/tuiboard, then ~/tuiboard)"
```

---

### Task 2: Example tasks, in the board file and on the command line

**Files:**
- Modify: `src/boards/create.ts` (`CreateBoardOptions`, `createBoardFile`, `render`; add `exampleTasks`)
- Modify: `src/cli/board.ts` (`Args`, `parse`, the `add` branch, the usage comment)
- Test: `src/boards/examples.test.ts`

**Interfaces:**
- Produces: `exampleTasks(now?: Date): string[]` (markdown task lines, all with `⏳`, one with `⌚`) and `CreateBoardOptions.examples?: readonly string[]` (lines to put under the first column that is not Done or Archive, or the first column when every column is one of those).
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Create `src/boards/examples.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseBoard } from "~/parser/markdown";
import { createBoardFile, exampleTasks } from "./create";

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min);

describe("exampleTasks", () => {
  it("four tasks, all dated today, one with a half-hour block", () => {
    const lines = exampleTasks(at(2026, 10, 1, 9, 12));
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(l.startsWith("- [ ] ")).toBe(true);
      expect(l).toContain("⏳ 2026-10-01");
    }
    const withBlock = lines.filter((l) => l.includes("⌚"));
    expect(withBlock).toHaveLength(1);
    expect(withBlock[0]).toContain("⌚ 09:30-10:00");
  });

  it("the block starts at the next half hour that is at least 10 minutes away", () => {
    expect(exampleTasks(at(2026, 10, 1, 9, 20)).find((l) => l.includes("⌚"))).toContain("⌚ 09:30-10:00");
    expect(exampleTasks(at(2026, 10, 1, 9, 21)).find((l) => l.includes("⌚"))).toContain("⌚ 10:00-10:30");
    expect(exampleTasks(at(2026, 10, 1, 14, 0)).find((l) => l.includes("⌚"))).toContain("⌚ 14:30-15:00");
  });

  it("22:20 still fits today; 22:21 does not", () => {
    expect(exampleTasks(at(2026, 10, 1, 22, 20)).find((l) => l.includes("⌚"))).toContain("⌚ 22:30-23:00");
    const late = exampleTasks(at(2026, 10, 1, 22, 21)).find((l) => l.includes("⌚"))!;
    expect(late).toContain("⌚ 09:00-09:30");
    expect(late).toContain("⏳ 2026-10-02");
  });

  it("rolls over a month and a year when it moves to tomorrow", () => {
    expect(exampleTasks(at(2026, 10, 31, 23, 55)).find((l) => l.includes("⌚"))).toContain("⏳ 2026-11-01");
    expect(exampleTasks(at(2026, 12, 31, 23, 55)).find((l) => l.includes("⌚"))).toContain("⏳ 2027-01-01");
  });

  it("the other tasks stay dated today even when the block moves to tomorrow", () => {
    const lines = exampleTasks(at(2026, 10, 1, 23, 30));
    expect(lines.filter((l) => !l.includes("⌚")).every((l) => l.includes("⏳ 2026-10-01"))).toBe(true);
  });
});

describe("createBoardFile with examples", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tb-examples-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (path: string) => parseBoard(readFileSync(path, "utf-8"), { filepath: path }).board;

  it("puts them in the first column and parses back as real tasks", () => {
    const path = join(dir, "A.md");
    createBoardFile(path, { columns: ["Todo", "Doing", "Done"], examples: exampleTasks(at(2026, 10, 1, 9, 12)) });
    const board = read(path);
    expect(board.columns.map((c) => c.name)).toEqual(["Todo", "Doing", "Done"]);
    const tasks = board.columns[0]!.children.filter((c: any) => "rawLine" in c && c.rawLine.startsWith("- [ ]"));
    expect(tasks).toHaveLength(4);
    expect(board.columns[1]!.children.filter((c: any) => c.rawLine?.startsWith("- ["))).toHaveLength(0);
    const blocked = tasks.find((t: any) => t.timeBlock) as any;
    expect(blocked.timeBlock).toBeDefined();
    expect(blocked.scheduled).toBe("2026-10-01");
  });

  it("skips a Done or Archive first column", () => {
    const path = join(dir, "B.md");
    createBoardFile(path, { columns: ["Done", "Inbox"], examples: ["- [ ] x ⏳ 2026-10-01"] });
    const board = read(path);
    expect(board.columns[0]!.children.some((c: any) => c.rawLine?.startsWith("- ["))).toBe(false);
    expect(board.columns[1]!.children.some((c: any) => c.rawLine?.startsWith("- ["))).toBe(true);
  });

  it("with only hidden columns the first one takes them", () => {
    const path = join(dir, "C.md");
    createBoardFile(path, { columns: ["Done", "Archive"], examples: ["- [ ] x ⏳ 2026-10-01"] });
    expect(read(path).columns[0]!.children.some((c: any) => c.rawLine?.startsWith("- ["))).toBe(true);
  });

  it("without examples the file is exactly what it was before", () => {
    const path = join(dir, "D.md");
    createBoardFile(path, { columns: ["Todo", "Done"] });
    expect(readFileSync(path, "utf-8")).toBe("---\n\nkanban-plugin: board\n\n---\n\n## Todo\n\n## Done\n\n");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/boards/examples.test.ts`
Expected: FAIL (`exampleTasks` is not exported; `examples` is not an option).

- [ ] **Step 3: Implement in `src/boards/create.ts`**

Add the option and the generator, and change `render`. Replace the `CreateBoardOptions` interface and `createBoardFile`'s last two lines, and `render`, with:

```ts
export interface CreateBoardOptions {
  /** Column headings, in order. At least one.  */
  columns: readonly string[];
  /**
   * Task lines to start the board with, written under the first column that is not
   * Done or Archive (the first column when every column is one of those).
   */
  examples?: readonly string[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/**
 * A few tasks that teach by doing. All dated today; one carries a 30-minute time block
 * so the Agenda has something in it. The block starts at the next half hour that is at
 * least 10 minutes away; after 22:30 that would be too late to be useful, so it becomes
 * 09:00 to 09:30 tomorrow.
 */
export function exampleTasks(now: Date = new Date()): string[] {
  const today = isoDate(now);
  let start = Math.ceil((now.getHours() * 60 + now.getMinutes() + 10) / 30) * 30;
  let blockDay = today;
  if (start > 22 * 60 + 30) {
    start = 9 * 60;
    blockDay = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }
  return [
    `- [ ] Press n to add a task of your own ⏳ ${today}`,
    `- [ ] Press Enter on a task to tick it off ⏳ ${today}`,
    `- [ ] Press b to give a task an hour, then look at the Agenda ⌚ ${hm(start)}-${hm(start + 30)} ⏳ ${blockDay}`,
    `- [ ] Press ? for every key, and d to delete these examples ⏳ ${today}`,
  ];
}

const HIDDEN = new Set(["done", "archive"]);

function exampleColumn(names: readonly string[]): number {
  const i = names.findIndex((n) => !HIDDEN.has(n.trim().toLowerCase()));
  return i === -1 ? 0 : i;
}
```

In `createBoardFile`, change the write line to `writeFileSync(path, render(names, options.examples ?? []), "utf-8");` and change the signature to `createBoardFile(path: string, options: CreateBoardOptions): void` with `const { columns } = options;` as its first line (keep the existing body between). Replace `render` with:

```ts
function render(columns: readonly string[], examples: readonly string[]): string {
  const frontmatter = ["---", "", "kanban-plugin: board", "", "---", ""].join("\n");
  const target = examples.length > 0 ? exampleColumn(columns) : -1;
  const body = columns
    .map((name, i) => (i === target ? `\n## ${name}\n\n${examples.join("\n")}\n` : `\n## ${name}\n`))
    .join("");
  // The trailing blank line is what `serializeBoard` produces for a board
  // whose last column is empty. Matching it means a file created here and the
  // same file after tuiboard writes to it are byte-identical, so a fresh
  // board never shows up as a spurious diff in the vault's git history.
  return `${frontmatter}${body}\n`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/boards`
Expected: PASS (the "without examples" test pins the old byte-for-byte output).

- [ ] **Step 5: Add `--examples` to the command line**

In `src/cli/board.ts`: import `exampleTasks` (`import { createBoardFile, DEFAULT_COLUMNS, exampleTasks } from "~/boards/create";`), add `examples: boolean;` to `Args` (initial value `false` in `parse`'s `const a: Args = { dryRun: false, examples: false, rest: [] };`), add `else if (arg === "--examples") a.examples = true;` beside `--dry-run`, change `if (!exists) createBoardFile(path, { columns });` to `if (!exists) createBoardFile(path, { columns, examples: a.examples ? exampleTasks() : undefined });`, and add `[--examples]` to the `board add` usage line in the header comment. Add this test to `src/boards/examples.test.ts` (a `describe("tuiboard board add --examples")` block calling `runBoard` with `process.env.TUIBOARD_CONFIG` pointing at a temp config file so nothing real is written):

```ts
import { runBoard } from "~/cli/board";
import { existsSync, writeFileSync } from "node:fs";

describe("tuiboard board add --examples", () => {
  it("creates the board with the example tasks in it", async () => {
    const d = mkdtempSync(join(tmpdir(), "tb-cli-"));
    const cfg = join(d, "config.yaml");
    writeFileSync(cfg, "boards: []\n");
    const prev = process.env.TUIBOARD_CONFIG;
    process.env.TUIBOARD_CONFIG = cfg;
    const log = console.log;
    console.log = () => {};
    try {
      const code = await runBoard(["add", "--path", join(d, "Work.md"), "--examples"]);
      expect(code).toBe(0);
      expect(existsSync(join(d, "Work.md"))).toBe(true);
      expect(readFileSync(join(d, "Work.md"), "utf-8")).toContain("Press n to add a task of your own");
    } finally {
      console.log = log;
      if (prev === undefined) delete process.env.TUIBOARD_CONFIG; else process.env.TUIBOARD_CONFIG = prev;
      rmSync(d, { recursive: true, force: true });
    }
  });
});
```

Run: `bun test src/boards && bun run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/boards/create.ts src/boards/examples.test.ts src/cli/board.ts
git commit -m "feat: example tasks for a new board (board add --examples)"
```

---

### Task 3: The wizard offers the examples

**Files:**
- Modify: `src/store/index.ts` (`BoardNew.step`, `openBoardNew`, `boardNewSubmitText`, `commitCreate`; new `boardNewAnswerExamples`; export it from the store's return object beside `boardNewConfirmPick`)
- Modify: `src/ui/Modal.tsx` (`BoardNewModal`: a new step and its hint)
- Modify: `src/input/handleKey.ts` (the `board-new` branch of the modal dispatcher)
- Test: `src/store/board-new.test.ts`

**Interfaces:**
- Consumes: `exampleTasks`, `createBoardFile(path, { columns, examples })` from Task 2.
- Produces: `BoardNew.step` gains `"examples"`; `BoardNew.examples: boolean` (default `true`); store method `boardNewAnswerExamples(yes: boolean): void`, which creates the file with or without examples and finishes the wizard.

- [ ] **Step 1: Write the failing tests**

Create `src/store/board-new.test.ts` (mirror the `emptyConfig` helper from `src/store/index.test.ts`, including `updateCheck: true`; point `TUIBOARD_CONFIG` at a temp config and set `boards.dir` through the wizard's own `dir` field by assigning it after `openBoardNew`, using `store.state.ui.boardNew`):

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTuiStore } from "~/store/index";

let dir: string;
let prevCfg: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-wizard-"));
  writeFileSync(join(dir, "config.yaml"), "boards: []\n");
  prevCfg = process.env.TUIBOARD_CONFIG;
  process.env.TUIBOARD_CONFIG = join(dir, "config.yaml");
});
afterEach(() => {
  if (prevCfg === undefined) delete process.env.TUIBOARD_CONFIG; else process.env.TUIBOARD_CONFIG = prevCfg;
  rmSync(dir, { recursive: true, force: true });
});

function fresh() {
  return createTuiStore({
    config: {
      root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
}

/** The wizard's folder is a field the test may set, so nothing is written under the real HOME. */
function openWizard(store: ReturnType<typeof fresh>) {
  store.openBoardNew(true);
  store.boardNewChooseMode("create");
  (store.state.ui.boardNew as any).dir = join(dir, "boards");
}

describe("the create path asks about examples after the columns", () => {
  it("name, then columns, then the examples step", () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    expect(s.state.ui.boardNew?.step).toBe("columns");
    s.boardNewSubmitText("");
    expect(s.state.ui.boardNew?.step).toBe("examples");
    expect(s.state.ui.boardNew?.examples).toBe(true);
    s.dispose();
  });

  it("yes writes the board with the example tasks and finishes", () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(true);
    expect(s.state.ui.boardNew).toBeUndefined();
    expect(s.state.boards).toHaveLength(1);
    expect(readFileSync(join(dir, "boards", "Work.md"), "utf-8")).toContain("Press n to add a task of your own");
    s.dispose();
  });

  it("no writes an empty board", () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewAnswerExamples(false);
    expect(readFileSync(join(dir, "boards", "Work.md"), "utf-8")).not.toContain("Press n");
    s.dispose();
  });

  it("adopting existing files never asks about examples", () => {
    const s = fresh();
    s.openBoardNew(true);
    s.boardNewChooseMode("adopt");
    expect(s.state.ui.boardNew?.step).toBe("dir");
    s.dispose();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/store/board-new.test.ts`
Expected: FAIL (`boardNewAnswerExamples` and the `examples` step do not exist).

- [ ] **Step 3: Implement the store side**

In `src/store/index.ts`:
- In `interface BoardNew`, change `step: "mode" | "name" | "columns" | "dir" | "pick";` to `step: "mode" | "name" | "columns" | "examples" | "dir" | "pick";` and add, after `columns: string;`: `/** Start the new board with a few example tasks (the "examples" step's answer). */ examples: boolean;`
- In `openBoardNew`, add `examples: true,` to the object (beside `columns: "Todo, Doing, Done",`).
- In `boardNewSubmitText`, replace the `columns` branch:

```ts
    if (b.step === "columns") {
      return patchBoardNew({ columns: value || b.columns, step: "examples", examples: true, error: undefined });
    }
```

- Replace `commitCreate(name, columnsText)` with a version that takes the options and add `boardNewAnswerExamples` right above it:

```ts
  /** The last question of the create path: examples or an empty board. */
  function boardNewAnswerExamples(yes: boolean): void {
    const b = state.ui.boardNew;
    if (!b || b.step !== "examples") return;
    commitCreate(b.name, b.columns, yes);
  }

  /** Create the file, register it, open it, in that order. */
  function commitCreate(name: string, columnsText: string, withExamples: boolean): void {
    const b = state.ui.boardNew;
    if (!b) return;
    const columns = columnsText.split(",").map((c) => c.trim()).filter(Boolean);
    const path = join(b.dir, `${name}.md`);
    try {
      createBoardFile(path, { columns, examples: withExamples ? exampleTasks() : undefined });
    } catch (e) {
      return patchBoardNew({ error: (e as Error).message, step: "name" });
    }
```

(keep the rest of the old `commitCreate` body unchanged from `try { addBoardToConfig(...) }` on). Import `exampleTasks` beside `createBoardFile` at the top of the file, and add `boardNewAnswerExamples,` to the object the store returns, next to `boardNewConfirmPick,`.

Run: `bun test src/store/board-new.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: The step on screen and its keys**

In `src/ui/Modal.tsx`, inside `BoardNewModal`'s `<Show when={w()}>` block, after the `columns` step's `</Show>` add:

```tsx
            {/* Step 2a, last: examples or an empty board */}
            <Show when={b().step === "examples"}>
              <text><span style={{ fg: T.textDim }}>Start with a few example tasks?</span></text>
              <For each={[
                { yes: true, label: "Yes", desc: "four tasks that show the keys" },
                { yes: false, label: "No", desc: "an empty board" },
              ]}>
                {(opt, i) => (
                  <text>
                    <span style={{ fg: b().sel === i() ? T.accent : T.text }}>
                      {b().sel === i() ? "▶ " : "  "}{opt.label}
                    </span>
                    <span style={{ fg: T.textDim }}>{"  — " + opt.desc}</span>
                  </text>
                )}
              </For>
            </Show>
```

and in the `hint` memo add `if (b.step === "examples") return "j/k choose · y yes · n no · Enter confirm";` before the final `return`. In `src/store/index.ts` make `boardNewSubmitText`'s `columns` branch also set `sel: 0` (add `sel: 0` to the `patchBoardNew` call) so the list starts on Yes.

In `src/input/handleKey.ts`, in the `if (ui.modal.kind === "board-new")` branch, after the `pick` block add:

```ts
      if (b.step === "examples") {
        if (key.name === "j" || key.name === "down") { store.boardNewMove(1); return; }
        if (key.name === "k" || key.name === "up") { store.boardNewMove(-1); return; }
        if (key.name === "y") { store.boardNewAnswerExamples(true); return; }
        if (key.name === "n") { store.boardNewAnswerExamples(false); return; }
        if (key.name === "enter" || key.name === "return") { store.boardNewAnswerExamples(b.sel === 0); return; }
      }
```

`boardNewMove` clamps with the list length; look at it (`src/store/index.ts`, `function boardNewMove`) and extend its length computation so the `examples` step counts 2 items (the `mode` step already does the same for its two items). Add this test to `src/store/board-new.test.ts` and confirm it passes:

```ts
  it("the examples step is a two-item list that j and k move through", () => {
    const s = fresh();
    openWizard(s);
    s.boardNewSubmitText("Work");
    s.boardNewSubmitText("");
    s.boardNewMove(1);
    expect(s.state.ui.boardNew?.sel).toBe(1);
    s.boardNewMove(5);
    expect(s.state.ui.boardNew?.sel).toBe(1);
    s.boardNewMove(-5);
    expect(s.state.ui.boardNew?.sel).toBe(0);
    s.dispose();
  });
```

Run: `bun test && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store src/ui/Modal.tsx src/input/handleKey.ts
git commit -m "feat: the new-board wizard offers a few example tasks"
```

---

### Task 4: A welcome that explains, and a bottom bar that follows the dialog

**Files:**
- Modify: `src/ui/Modal.tsx` (the welcome paragraph, `BoardNewModal`)
- Modify: `src/ui/hints.ts` (`HintContext.modal`, `hintsFor`)
- Modify: `src/ui/Chrome.tsx` (`BottomBar` passes the modal)
- Modify: `src/store/index.ts` (`finishBoardNew`: the longer banner)
- Test: `src/ui/hints.test.ts`, `src/ui/welcome.test.tsx`

**Interfaces:**
- Produces: `HintContext.modal?: "open"` and `HINTS_MODAL = "Enter confirm · Esc cancel"` (one line for every dialog; the spec's per-step wording is deliberately simplified, since each dialog already prints its own hint inside the box); `WELCOME_TEXT` exported from `src/ui/Modal.tsx` (the paragraph, so a test can assert it).
- Consumes: the `boardNew` state from Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/hints.test.ts`:

```ts
import { HINTS_MODAL } from "./hints";

describe("hintsFor with a dialog open", () => {
  it("shows the dialog's keys, not the dashboard's", () => {
    expect(hintsFor(ctx({ modal: "open" }))).toBe(HINTS_MODAL);
    expect(hintsFor(ctx({ modal: "open", zone: "timeline", singlePane: true }))).toBe(HINTS_MODAL);
  });
  it("no dialog: unchanged", () => {
    expect(hintsFor(ctx())).toBe(HINTS_FULL);
  });
  it("short enough for 60 columns", () => {
    expect(HINTS_MODAL.length).toBeLessThanOrEqual(60);
  });
});
```

Create `src/ui/welcome.test.tsx` (a headless render of the welcome, 100 columns and 40 columns):

```tsx
import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/solid";

import { createTuiStore } from "~/store/index";
import { ModalLayer } from "~/ui/Modal";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
afterEach(() => { for (const r of renders.splice(0)) r.renderer.destroy(); });

async function welcome(width: number) {
  const store = createTuiStore({
    config: {
      root: process.cwd(), loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
  store.openBoardNew(true);
  const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width, height: 24 });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return t.captureCharFrame();
}

describe("the welcome dialog", () => {
  it("says what tuiboard is and that only the board is required", async () => {
    const frame = await welcome(100);
    expect(frame).toContain("Welcome to tuiboard");
    expect(frame).toContain("planner");
    expect(frame).toContain("Only the board is required");
  });

  it("fits a 40-column pane: no line is cut off the right edge", async () => {
    const frame = await welcome(40);
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    expect(frame).toContain("Only the board");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/ui/hints.test.ts src/ui/welcome.test.tsx`
Expected: FAIL (`HINTS_MODAL`, `modal` and the paragraph do not exist; if `ModalLayer` needs a different prop, read its signature at the top of `src/ui/Modal.tsx` and adapt the mount only).

- [ ] **Step 3: Implement**

`src/ui/hints.ts`: add to `HintContext`: `/** A dialog is open: its own keys are on screen, so the bar should not show the dashboard's. */ modal?: "open";`. Add `export const HINTS_MODAL = "Enter confirm · Esc cancel";` and, as the first line of `hintsFor`: `if (ctx.modal) return HINTS_MODAL;`. In `src/ui/Chrome.tsx` `BottomBar`'s `hints` memo add `modal: ui.modal ? "open" : undefined,` to the object passed to `hintsFor`.

`src/ui/Modal.tsx`: export `export const WELCOME_TEXT = "tuiboard is a kanban board on plain markdown, plus a Today/Tomorrow planner, a day agenda and a live list of your coding agents. Only the board is required: the rest is there when you want it.";` and replace the paragraph shown when `b().mandatory && b().step === "mode"` (the `No boards configured yet...` text) with:

```tsx
              <text wrapMode="word">
                <span style={{ fg: T.textDim }}>{WELCOME_TEXT}</span>
              </text>
```

`src/store/index.ts` `finishBoardNew`: replace the final two lines (`if (problems.length > 0) flashBanner(...) else flashBanner("info", \`Added ${what}\`);`) with:

```ts
    if (problems.length > 0) flashBanner("warn", `Added ${what} — ${problems.join(" · ")}`);
    else flashBanner("info", `Added ${what} · n new task · ? keys · S setup`, 8000);
```

Run: `bun test && bun run typecheck`. Expected: PASS. (A banner test elsewhere may assert the exact old text `Added Work`; if one fails, update it to the new text.)

- [ ] **Step 4: Commit**

```bash
git add src/ui src/store/index.ts
git commit -m "feat: a welcome that says what tuiboard is, and a bottom bar that follows the dialog"
```

---

### Task 5: Empty states that teach

**Files:**
- Create: `src/ui/empty-states.ts`
- Modify: `src/ui/PlannerPanel.tsx` (the `Nothing scheduled.` fallback, line 98)
- Modify: `src/ui/AgentsBar.tsx` (the `No active sessions.` fallback, line 85)
- Modify: `src/ui/BoardView.tsx` (first visible column, when the whole board has no open task)
- Modify: `src/ui/TimelineView.tsx` (one line after the "change day" row, line 588)
- Test: `src/ui/empty-states.test.ts`, `src/ui/empty-states.render.test.tsx`

**Interfaces:**
- Produces, in `src/ui/empty-states.ts`: `BOARD_EMPTY = "Press n to add your first task"`; `PLANNER_EMPTY = ["Nothing scheduled yet.", "Give a task a date with s, or press t to bring one to today."]`; `AGENTS_EMPTY = ["No sessions yet.", "tuiboard reads Claude Code, Codex, OpenCode and Pi from disk: start one and it shows up here."]`; `CALENDAR_HINT = "Optional: connect a calendar, S for setup"`; `showCalendarHint(opts: { calendarsConfigured: boolean; dayHasTasks: boolean; dayHasEvents: boolean }): boolean`; `boardIsEmpty(board: Pick<Board, "columns">, isTask: (c: unknown) => boolean): boolean` is NOT needed: use the store's existing counts (see Step 4).

- [ ] **Step 1: Write the failing tests**

`src/ui/empty-states.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { AGENTS_EMPTY, BOARD_EMPTY, CALENDAR_HINT, PLANNER_EMPTY, showCalendarHint } from "./empty-states";

describe("showCalendarHint", () => {
  it("only for someone with no calendar and an empty day", () => {
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: false, dayHasEvents: false })).toBe(true);
  });
  it("never once a calendar is configured", () => {
    expect(showCalendarHint({ calendarsConfigured: true, dayHasTasks: false, dayHasEvents: false })).toBe(false);
  });
  it("it goes away as soon as the day has anything on it", () => {
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: true, dayHasEvents: false })).toBe(false);
    expect(showCalendarHint({ calendarsConfigured: false, dayHasTasks: false, dayHasEvents: true })).toBe(false);
  });
});

describe("the copy", () => {
  it("names the keys it teaches", () => {
    expect(BOARD_EMPTY).toContain("n");
    expect(PLANNER_EMPTY.join(" ")).toContain("s");
    expect(AGENTS_EMPTY.join(" ")).toContain("Claude Code");
    expect(CALENDAR_HINT).toContain("S");
  });
});
```

`src/ui/empty-states.render.test.tsx` renders `PlannerPanel` and `AgentsBar` in a store with no tasks and no sessions (use the `welcome.test.tsx` helper pattern; for `AgentsBar` pass `height={7}`; to keep the agents source empty set `zones.agents: "on"` only if the test machine has no sessions: instead create the store with `zones.agents: "off"`, whose store has a no-op agents store, and mount `AgentsBar` directly, which then sees zero sessions):

```tsx
import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/solid";

import { createTuiStore } from "~/store/index";
import { AgentsBar } from "~/ui/AgentsBar";
import { PlannerPanel } from "~/ui/PlannerPanel";
import { AGENTS_EMPTY, PLANNER_EMPTY } from "~/ui/empty-states";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
afterEach(() => { for (const r of renders.splice(0)) r.renderer.destroy(); });

const store = () => createTuiStore({
  config: {
    root: process.cwd(), loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
    resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
    zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
  } as any,
});

async function frame(node: () => any, width: number, height: number) {
  const t = await testRender(node, { width, height });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  return t.captureCharFrame();
}

describe("empty states on screen", () => {
  it("the planner says how a task gets here", async () => {
    const s = store();
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><PlannerPanel store={s} /></box>, 60, 12);
    expect(f).toContain(PLANNER_EMPTY[0]!);
    expect(f).toContain("Give a task a date");
  });

  it("the agents strip says what it reads", async () => {
    const s = store();
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><AgentsBar store={s} height={7} /></box>, 100, 9);
    expect(f).toContain(AGENTS_EMPTY[0]!);
    expect(f).toContain("Claude Code, Codex, OpenCode and Pi");
  });

  it("a 40-column pane never overflows", async () => {
    const s = store();
    const f = await frame(() => <box style={{ width: "100%", height: "100%" }}><PlannerPanel store={s} /></box>, 40, 12);
    for (const line of f.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/ui/empty-states.test.ts src/ui/empty-states.render.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the copy and the planner and agents states**

Create `src/ui/empty-states.ts`:

```ts
/**
 * What an empty zone says. A new user meets every zone empty, so each one says what
 * to do next instead of "nothing". Kept in one place so the copy is easy to read,
 * review and test.
 */

export const BOARD_EMPTY = "Press n to add your first task";

export const PLANNER_EMPTY = [
  "Nothing scheduled yet.",
  "Give a task a date with s, or press t to bring one to today.",
] as const;

export const AGENTS_EMPTY = [
  "No sessions yet.",
  "tuiboard reads Claude Code, Codex, OpenCode and Pi from disk: start one and it shows up here.",
] as const;

export const CALENDAR_HINT = "Optional: connect a calendar, S for setup";

/** Only while it can still help: no calendar, and nothing yet on the day being looked at. */
export function showCalendarHint(opts: {
  calendarsConfigured: boolean;
  dayHasTasks: boolean;
  dayHasEvents: boolean;
}): boolean {
  return !opts.calendarsConfigured && !opts.dayHasTasks && !opts.dayHasEvents;
}
```

In `src/ui/PlannerPanel.tsx` replace the `fallback` text (`<span ...>Nothing scheduled.</span>`) with a wrapped two-line block:

```tsx
          <box style={{ flexDirection: "column" }}>
            <text wrapMode="word"><span style={{ fg: T.textDim }}>{PLANNER_EMPTY[0]}</span></text>
            <text wrapMode="word"><span style={{ fg: T.textDim }}>{PLANNER_EMPTY[1]}</span></text>
          </box>
```

(importing `PLANNER_EMPTY` from `~/ui/empty-states`; `T` is already imported there). Do the same in `src/ui/AgentsBar.tsx` with `AGENTS_EMPTY`. Run `bun test src/ui` and expect PASS.

- [ ] **Step 4: The board and the agenda hints**

`src/ui/BoardView.tsx`: the board is empty when no column holds an open task. The store already exposes per-board counts for the top bar (`0 open · 0 done`): find that expression in `src/ui/Chrome.tsx` (search for `open ·`) and expose the same number to `BoardView` (read `props.store` the same way). Show `BOARD_EMPTY` as a dim text row at the top of the **first visible column** (`props.columnIndex === 0` or the first column that is not hidden) when that count is `0` and the column has no tasks. Add a render test to `empty-states.render.test.tsx` using a store whose config points at a temp board file with `## Todo\n\n## Doing\n` and mounting `BoardView` (signature: `BoardView(props: BoardViewProps)`; read `BoardViewProps` at the top of the file for the required props and pass `store`, `board={store.state.boards[0]!.board}`), asserting the frame contains `Press n to add your first task` and that a board with one task does not.

`src/ui/TimelineView.tsx`: right after the `[ ] change day` `</Show>` (line 588 to 595) add:

```tsx
      <Show when={showCalendarHint({
        calendarsConfigured: !!(props.store.config.calendars?.google || props.store.config.calendars?.microsoft),
        dayHasTasks: tray().length > 0 || entries().some((e) => e.kind === "task"),
        dayHasEvents: entries().some((e) => e.kind !== "task"),
      })}>
        <text selectable={false} wrapMode="none">
          <span style={{ fg: T.textDim }}>{CALENDAR_HINT}</span>
        </text>
      </Show>
```

`entries()` and the entry `kind` names must match what the file already uses: search `TimelineView.tsx` for the memo that builds the day's bands (it feeds `buildTimelineEntries`) and for how a calendar event is told from a task (`entry.kind` or `entry.event`), and use those names; if the store does not expose `config`, read the calendars from the `config` passed into `createTuiStore` by adding `config: Config` to the returned store object (one line, next to `agents: agentsStore`). Add a test to `empty-states.render.test.tsx` mounting `TimelineView` (see `TimelineView.mouse.test.tsx` `mount()` for the props: `store`, `width={56}`) with a store that has no calendars and no tasks (the hint shows) and with one task today (the hint is gone).

Run: `bun test && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui src/store/index.ts
git commit -m "feat: empty zones say what to do next"
```

---

### Task 6: The Setup status, as one pure function

**Files:**
- Create: `src/setup/status.ts`
- Test: `src/setup/status.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SetupStatus {
  version: string;
  paths: { config: string | undefined; boardsDir: string };
  boards: { name: string; path: string; exists: boolean }[];
  agents: { provider: AgentProvider; label: string; found: boolean; sessions: number; lastActivityMs?: number }[];
  herdr: { installed: boolean };
  calendars: { provider: "google" | "microsoft"; label: string; connected: boolean; hint: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  updates: { enabled: boolean; latest?: string; checkedAt?: number };
}
export interface SetupDeps {
  version: string;
  configPath: string | undefined;
  boardsDir: string;
  boards: { name?: string; path: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  calendars: { google?: { token: string }; microsoft?: { tokenCache: string } };
  adapters: { provider: AgentProvider; watchPaths(): string[] }[];
  sessions: { provider: AgentProvider; lastActivityMs: number }[];
  herdrBin: string | undefined;
  updateCheckEnabled: boolean;
  updateCache: { latest?: string; checkedAt?: number } | undefined;
  exists: (path: string) => boolean;
}
export function collectSetupStatus(deps: SetupDeps): SetupStatus;
```

- Consumes: `AgentProvider`, `HARNESS` from `~/store/agents`; `ZoneMode` from `~/config/loader`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";

import { collectSetupStatus, type SetupDeps } from "./status";

const base = (over: Partial<SetupDeps> = {}): SetupDeps => ({
  version: "0.16.0",
  configPath: undefined,
  boardsDir: "/b",
  boards: [],
  zones: { planner: "on", agenda: "on", agents: "on" },
  calendars: {},
  adapters: [
    { provider: "claude-code", watchPaths: () => ["/home/.claude/projects"] },
    { provider: "codex", watchPaths: () => ["/home/.codex/sessions"] },
    { provider: "opencode", watchPaths: () => ["/home/.local/share/opencode/opencode.db"] },
    { provider: "pi", watchPaths: () => ["/home/.pi/agent/sessions"] },
  ],
  sessions: [],
  herdrBin: undefined,
  updateCheckEnabled: true,
  updateCache: undefined,
  exists: () => false,
  ...over,
});

describe("collectSetupStatus", () => {
  it("a machine with nothing on it: no crash, everything not-yet", () => {
    const s = collectSetupStatus(base());
    expect(s.version).toBe("0.16.0");
    expect(s.boards).toEqual([]);
    expect(s.agents).toHaveLength(4);
    expect(s.agents.every((a) => !a.found && a.sessions === 0)).toBe(true);
    expect(s.calendars.map((c) => [c.provider, c.connected])).toEqual([["google", false], ["microsoft", false]]);
    expect(s.herdr.installed).toBe(false);
    expect(s.updates).toEqual({ enabled: true, latest: undefined, checkedAt: undefined });
  });

  it("an agent source is found when one of its paths exists, and sessions are counted per tool", () => {
    const s = collectSetupStatus(base({
      exists: (p) => p === "/home/.codex/sessions",
      sessions: [
        { provider: "codex", lastActivityMs: 100 },
        { provider: "codex", lastActivityMs: 300 },
        { provider: "claude-code", lastActivityMs: 50 },
      ],
    }));
    const codex = s.agents.find((a) => a.provider === "codex")!;
    expect(codex).toMatchObject({ found: true, sessions: 2, lastActivityMs: 300, label: "Codex" });
    expect(s.agents.find((a) => a.provider === "claude-code")).toMatchObject({ found: false, sessions: 1 });
  });

  it("boards report whether their file is there", () => {
    const s = collectSetupStatus(base({
      boards: [{ name: "Work", path: "/b/Work.md" }, { path: "/b/Gone.md" }],
      exists: (p) => p === "/b/Work.md",
    }));
    expect(s.boards).toEqual([
      { name: "Work", path: "/b/Work.md", exists: true },
      { name: "Gone", path: "/b/Gone.md", exists: false },
    ]);
  });

  it("a calendar is connected when its token file exists; a broken path is just not connected", () => {
    const s = collectSetupStatus(base({
      calendars: { google: { token: "/t/google.json" }, microsoft: { tokenCache: "/t/ms.json" } },
      exists: (p) => p === "/t/google.json",
    }));
    expect(s.calendars.find((c) => c.provider === "google")).toMatchObject({ connected: true });
    const ms = s.calendars.find((c) => c.provider === "microsoft")!;
    expect(ms.connected).toBe(false);
    expect(ms.hint).toContain("tuiboard calendar-setup microsoft");
  });

  it("the hint for an unconfigured calendar is the command that connects it", () => {
    const g = collectSetupStatus(base()).calendars.find((c) => c.provider === "google")!;
    expect(g.hint).toBe("tuiboard calendar-setup google");
  });

  it("herdr and the update notice are reported as they are", () => {
    const s = collectSetupStatus(base({
      herdrBin: "/usr/bin/herdr",
      updateCheckEnabled: false,
      updateCache: { latest: "0.17.0", checkedAt: 1234 },
    }));
    expect(s.herdr.installed).toBe(true);
    expect(s.updates).toEqual({ enabled: false, latest: "0.17.0", checkedAt: 1234 });
  });

  it("an adapter whose watchPaths throws does not take the report down", () => {
    const s = collectSetupStatus(base({
      adapters: [{ provider: "pi", watchPaths: () => { throw new Error("boom"); } }],
    }));
    expect(s.agents).toEqual([{ provider: "pi", label: "Pi", found: false, sessions: 0, lastActivityMs: undefined }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/setup/status.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/setup/status.ts`**

```ts
/**
 * What is set up, in one place. The Setup dialog (`S`) and `tuiboard doctor` both show
 * this, so they cannot disagree. Pure: every fact about the machine (files, adapters,
 * sessions, the update cache) is passed in, so it is tested without a machine.
 */

import { basename, extname } from "node:path";

import type { ZoneMode } from "~/config/loader";
import { HARNESS, type AgentProvider } from "~/store/agents";

export interface SetupStatus {
  version: string;
  paths: { config: string | undefined; boardsDir: string };
  boards: { name: string; path: string; exists: boolean }[];
  agents: { provider: AgentProvider; label: string; found: boolean; sessions: number; lastActivityMs?: number }[];
  herdr: { installed: boolean };
  calendars: { provider: "google" | "microsoft"; label: string; connected: boolean; hint: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  updates: { enabled: boolean; latest?: string; checkedAt?: number };
}

export interface SetupDeps {
  version: string;
  /** The config file in use, or undefined when there is none yet. */
  configPath: string | undefined;
  boardsDir: string;
  boards: { name?: string; path: string }[];
  zones: { planner: ZoneMode; agenda: ZoneMode; agents: ZoneMode };
  calendars: { google?: { token: string }; microsoft?: { tokenCache: string } };
  adapters: { provider: AgentProvider; watchPaths(): string[] }[];
  sessions: { provider: AgentProvider; lastActivityMs: number }[];
  herdrBin: string | undefined;
  updateCheckEnabled: boolean;
  updateCache: { latest?: string; checkedAt?: number } | undefined;
  exists: (path: string) => boolean;
}

function sourceFound(adapter: SetupDeps["adapters"][number], exists: (p: string) => boolean): boolean {
  try {
    return adapter.watchPaths().some((p) => exists(p));
  } catch {
    return false;
  }
}

export function collectSetupStatus(d: SetupDeps): SetupStatus {
  return {
    version: d.version,
    paths: { config: d.configPath, boardsDir: d.boardsDir },
    boards: d.boards.map((b) => ({
      name: b.name ?? basename(b.path, extname(b.path)),
      path: b.path,
      exists: d.exists(b.path),
    })),
    agents: d.adapters.map((a) => {
      const mine = d.sessions.filter((s) => s.provider === a.provider);
      return {
        provider: a.provider,
        label: HARNESS[a.provider].name,
        found: sourceFound(a, d.exists),
        sessions: mine.length,
        lastActivityMs: mine.length ? Math.max(...mine.map((s) => s.lastActivityMs)) : undefined,
      };
    }),
    herdr: { installed: !!d.herdrBin },
    calendars: [
      {
        provider: "google",
        label: "Google Calendar",
        connected: !!d.calendars.google && d.exists(d.calendars.google.token),
        hint: "tuiboard calendar-setup google",
      },
      {
        provider: "microsoft",
        label: "Microsoft 365",
        connected: !!d.calendars.microsoft && d.exists(d.calendars.microsoft.tokenCache),
        hint: "tuiboard calendar-setup microsoft",
      },
    ],
    zones: d.zones,
    updates: { enabled: d.updateCheckEnabled, latest: d.updateCache?.latest, checkedAt: d.updateCache?.checkedAt },
  };
}
```

- [ ] **Step 4: Run and commit**

Run: `bun test src/setup && bun run typecheck`. Expected: PASS.

```bash
git add src/setup
git commit -m "feat: collectSetupStatus, one function for what is set up"
```

---

### Task 7: The Setup dialog and the `S` key

**Files:**
- Create: `src/setup/live.ts` (real dependencies for `collectSetupStatus`)
- Modify: `src/update/index.ts` (export `readUpdateCache`)
- Modify: `src/store/index.ts` (modal kind `"setup"`; `setupStatus()`)
- Modify: `src/ui/Modal.tsx` (`SetupModal`, route, help section)
- Modify: `src/input/handleKey.ts` (`S`, and closing)
- Modify: `src/ui/empty-states.ts` is not touched.
- Test: `src/setup/live.test.ts`, `src/input/setup-key.test.ts`, `src/ui/setup-modal.test.tsx`

**Interfaces:**
- Consumes: `collectSetupStatus`, `SetupDeps`, `SetupStatus` (Task 6).
- Produces: `readUpdateCache(): UpdateCache | undefined` exported from `src/update/index.ts` (move the private `readCache` there and keep the file-private use); `liveSetupDeps(config: Config, sessions: AgentSession[]): SetupDeps` in `src/setup/live.ts`; store method `setupStatus(): SetupStatus`; modal kind `{ kind: "setup" }`.

- [ ] **Step 1: Write the failing tests**

`src/input/setup-key.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";

const store = () => createTuiStore({
  config: {
    root: process.cwd(), loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
    resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
    zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
  } as any,
});

describe("Shift+S opens Setup, s still schedules", () => {
  it("S opens the setup dialog", () => {
    const s = store();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal?.kind).toBe("setup");
    s.dispose();
  });

  it("Esc, S and q-less keys close it", () => {
    const s = store();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    handleKey(s, { name: "escape" }, 0);
    expect(s.state.ui.modal).toBeUndefined();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal).toBeUndefined();
    s.dispose();
  });

  it("a capital S typed into another dialog does not open Setup", () => {
    const s = store();
    s.openModal({ kind: "search" } as any);
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal?.kind).toBe("search");
    s.dispose();
  });
});
```

`src/setup/live.test.ts` builds a temp HOME-less check: `liveSetupDeps` with a minimal config returns `exists` that really checks the file system and `adapters` listing the four providers:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSetupStatus } from "./status";
import { liveSetupDeps } from "./live";

describe("liveSetupDeps", () => {
  it("looks at the real file system, and lists all four tools", () => {
    const d = mkdtempSync(join(tmpdir(), "tb-live-"));
    const board = join(d, "A.md");
    writeFileSync(board, "## Todo\n");
    const deps = liveSetupDeps({
      boards: [{ path: board, name: "A" }], zones: { planner: "on", agenda: "on", agents: "on" }, updateCheck: true, calendars: undefined,
    } as any, []);
    const s = collectSetupStatus(deps);
    expect(s.boards[0]).toEqual({ name: "A", path: board, exists: true });
    expect(s.agents.map((a) => a.provider).sort()).toEqual(["claude-code", "codex", "opencode", "pi"]);
    rmSync(d, { recursive: true, force: true });
  });
});
```

`src/ui/setup-modal.test.tsx` mounts `ModalLayer` with the setup modal open on a machine-less store and asserts the frame: it contains `Setup`, a `Boards` row, `Agents`, `Calendar`, `Updates`, the text `tuiboard calendar-setup google`, uses `✓` for a ready item and `○` for a not-set-up one, and at width 40 no line exceeds 40 characters. Use the `welcome.test.tsx` mount helper from Task 4.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/input/setup-key.test.ts src/setup/live.test.ts src/ui/setup-modal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the real dependencies and the store accessor**

In `src/update/index.ts` rename the private `readCache` to an exported `readUpdateCache` (keep behavior) and update its one use. Create `src/setup/live.ts`:

```ts
/**
 * The real machine behind `collectSetupStatus`: the config, the agent adapters, the file
 * system, the update cache. The dialog and `tuiboard doctor` build their input here.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";

import { suggestBoardsDir } from "~/boards/suggest";
import { findConfigPath, type Config } from "~/config/loader";
import { AGENT_ADAPTERS } from "~/store/agent-adapters";
import type { AgentSession } from "~/store/agents";
import { herdrBin } from "~/store/herdr";
import { readUpdateCache } from "~/update";
import pkg from "../../package.json";
import type { SetupDeps } from "./status";

export function liveSetupDeps(config: Config, sessions: Pick<AgentSession, "provider" | "lastActivityMs">[]): SetupDeps {
  const found = findConfigPath();
  const cache = readUpdateCache();
  void homedir;
  return {
    version: pkg.version,
    configPath: found.exists ? found.path : undefined,
    boardsDir: suggestBoardsDir(config),
    boards: config.boards,
    zones: config.zones,
    calendars: {
      google: config.calendars?.google ? { token: config.calendars.google.token } : undefined,
      microsoft: config.calendars?.microsoft ? { tokenCache: config.calendars.microsoft.tokenCache } : undefined,
    },
    adapters: AGENT_ADAPTERS,
    sessions: [...sessions],
    herdrBin: herdrBin(),
    updateCheckEnabled: config.updateCheck,
    updateCache: cache ? { latest: cache.latest, checkedAt: cache.checkedAt } : undefined,
    exists: existsSync,
  };
}
```

(remove the stray `void homedir;` and the unused `homedir` import when writing it: they are not needed). In `src/store/index.ts`: add `| { kind: "setup" }` to the modal union (line 117 to 119), add the function and export:

```ts
  /** What is set up on this machine: the Setup dialog's content. */
  function setupStatus(): SetupStatus {
    return collectSetupStatus(liveSetupDeps(config, agentsStore.sessions()));
  }
```

with `import { collectSetupStatus, type SetupStatus } from "~/setup/status"; import { liveSetupDeps } from "~/setup/live";` and `setupStatus,` in the returned object.

- [ ] **Step 4: The key, the dialog and the help line**

`src/input/handleKey.ts`: in the modal dispatcher, next to the `status-file` branch add:

```ts
    if (ui.modal.kind === "setup") {
      if (key.name === "s" && key.shift) { store.closeModal(); return; }
      return; // read-only: Escape (handled above) and S close it, nothing else does anything
    }
```

and, beside the `Shift+T` block (before the zone handling, after `?`):

```ts
  // Setup: what is connected. Shift+S, and checked here so the plain `s` (schedule)
  // further down never sees it.
  if (key.name === "s" && key.shift) {
    store.openModal({ kind: "setup" });
    return;
  }
```

`src/ui/Modal.tsx`: add `case "setup": return <SetupModal store={props.store} />;` to `ModalRouter` and the component:

```tsx
function SetupModal(props: { store: TuiStore }) {
  const s = createMemo(() => props.store.setupStatus());
  const row = (ok: boolean, label: string, detail: string) => (
    <text wrapMode="word">
      <span style={{ fg: ok ? T.done : T.textDim }}>{ok ? "✓ " : "○ "}</span>
      <span style={{ fg: T.text }}>{label}</span>
      <span style={{ fg: T.textDim }}>{"  " + detail}</span>
    </text>
  );
  return (
    <DialogShell title="Setup" hint="Esc or S to close" width={70}>
      <box style={{ flexDirection: "column" }}>
        {row(s().boards.length > 0, "Boards", s().boards.length === 0 ? "none yet: press + to add one" : `${s().boards.length}, config ${s().paths.config ?? "(none yet)"}`)}
        <For each={s().boards}>{(b) => row(b.exists, "  " + b.name, b.exists ? b.path : b.path + " (file missing)")}</For>
        <text> </text>
        <For each={s().agents}>
          {(a) => row(a.found, a.label, a.found ? `${a.sessions} session${a.sessions === 1 ? "" : "s"}` : "not found: nothing to set up, it appears once you use it")}
        </For>
        {row(s().herdr.installed, "herdr", s().herdr.installed ? "installed" : "optional: live status and jump to a session")}
        <text> </text>
        <For each={s().calendars}>
          {(c) => row(c.connected, c.label, c.connected ? "connected" : "optional: " + c.hint)}
        </For>
        <text> </text>
        {row(s().updates.enabled, "Update notice", s().updates.enabled ? `on${s().updates.latest ? ", latest known " + s().updates.latest : ""}` : "off (update_check: off)")}
        <text><span style={{ fg: T.textDim }}>{"tuiboard " + s().version + "  ·  boards go in " + s().paths.boardsDir}</span></text>
      </box>
    </DialogShell>
  );
}
```

In `HELP_SECTIONS` (`src/ui/Modal.tsx`, the `Global` section) add `["S", "Setup: what is connected (boards, agents, calendar, updates)"],` after the `?` row. Mark `SetupModal`'s text rows `wrapMode="word"` as above so a 40-column pane wraps instead of overflowing.

Run: `bun test && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: Setup dialog on Shift+S"
```

---

### Task 8: `tuiboard doctor`

**Files:**
- Create: `src/cli/doctor.ts`
- Modify: `bin/tuiboard.ts` (route)
- Modify: `src/cli/args.ts` only if `--help` lists subcommands (search for `calendar-setup` in it and add `doctor` beside it)
- Test: `src/cli/doctor.test.ts`

**Interfaces:**
- Consumes: `collectSetupStatus`, `SetupStatus` (Task 6), `liveSetupDeps` (Task 7), `loadConfig`.
- Produces: `formatDoctor(status: SetupStatus): string` (the plain-text report) and `runDoctor(argv: readonly string[]): number`; `--json` prints `JSON.stringify(status, null, 2)`; always exit code 0 for a readable report, 2 for an unknown flag.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";

import { collectSetupStatus } from "~/setup/status";
import { formatDoctor, runDoctor } from "./doctor";

const status = collectSetupStatus({
  version: "0.16.0", configPath: undefined, boardsDir: "/b", boards: [], zones: { planner: "on", agenda: "on", agents: "on" },
  calendars: {}, adapters: [{ provider: "claude-code", watchPaths: () => ["/x"] }], sessions: [], herdrBin: undefined,
  updateCheckEnabled: true, updateCache: undefined, exists: () => false,
});

describe("formatDoctor", () => {
  it("one line per area, with a mark and a remedy for what is not set up", () => {
    const out = formatDoctor(status);
    expect(out).toContain("tuiboard 0.16.0");
    expect(out).toContain("○ Boards");
    expect(out).toContain("○ Claude Code");
    expect(out).toContain("tuiboard calendar-setup google");
    expect(out).toContain("Update notice");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("runDoctor", () => {
  const capture = (fn: () => number) => {
    const log = console.log; let text = "";
    console.log = (...a: unknown[]) => { text += a.join(" ") + "\n"; };
    try { return { code: fn(), text }; } finally { console.log = log; }
  };

  it("exits 0 and prints a report, even on a machine with nothing set up", () => {
    const r = capture(() => runDoctor([]));
    expect(r.code).toBe(0);
    expect(r.text).toContain("tuiboard ");
  });

  it("--json prints the status object", () => {
    const r = capture(() => runDoctor(["--json"]));
    const parsed = JSON.parse(r.text);
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("agents");
    expect(parsed).toHaveProperty("calendars");
  });

  it("an unknown flag is a usage error", () => {
    const err = console.error; console.error = () => {};
    try { expect(runDoctor(["--nope"])).toBe(2); } finally { console.error = err; }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/cli/doctor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * `tuiboard doctor`: what is set up, as plain text (or JSON). The same facts the Setup
 * dialog (`S`) shows, from the same function, for a terminal, a script or a bug report.
 */

import { loadConfig } from "~/config/loader";
import { liveSetupDeps } from "~/setup/live";
import { collectSetupStatus, type SetupStatus } from "~/setup/status";

const mark = (ok: boolean) => (ok ? "✓" : "○");

export function formatDoctor(s: SetupStatus): string {
  const lines: string[] = [`tuiboard ${s.version}`, ""];
  lines.push(`${mark(s.boards.length > 0)} Boards  ${s.boards.length === 0 ? "none yet: run tuiboard and press + to add one" : String(s.boards.length)}`);
  for (const b of s.boards) lines.push(`    ${b.exists ? "" : "(file missing) "}${b.name}  ${b.path}`);
  lines.push(`    config: ${s.paths.config ?? "(none yet)"}`, `    new boards go in: ${s.paths.boardsDir}`, "");
  for (const a of s.agents) {
    lines.push(`${mark(a.found)} ${a.label}  ${a.found ? `${a.sessions} session${a.sessions === 1 ? "" : "s"}` : "not found (nothing to set up, it appears once you use it)"}`);
  }
  lines.push(`${mark(s.herdr.installed)} herdr  ${s.herdr.installed ? "installed" : "optional"}`, "");
  for (const c of s.calendars) lines.push(`${mark(c.connected)} ${c.label}  ${c.connected ? "connected" : "optional: " + c.hint}`);
  lines.push("");
  lines.push(`${mark(s.updates.enabled)} Update notice  ${s.updates.enabled ? "on" + (s.updates.latest ? `, latest known ${s.updates.latest}` : "") : "off (update_check: off)"}`);
  lines.push(`    zones: planner ${s.zones.planner}, agenda ${s.zones.agenda}, agents ${s.zones.agents}`);
  return lines.join("\n") + "\n";
}

export function runDoctor(argv: readonly string[]): number {
  const unknown = argv.find((a) => a !== "--json");
  if (unknown) {
    console.error(`tuiboard doctor: unknown argument "${unknown}"\nusage: tuiboard doctor [--json]`);
    return 2;
  }
  const status = collectSetupStatus(liveSetupDeps(loadConfig(), []));
  console.log(argv.includes("--json") ? JSON.stringify(status, null, 2) : formatDoctor(status).trimEnd());
  return 0;
}
```

(`formatDoctor` ends with a newline; `runDoctor` prints it trimmed because `console.log` adds one.) In `bin/tuiboard.ts`, after the `board` route add:

```ts
if (process.argv[2] === "doctor") {
  const { runDoctor } = await import("../src/cli/doctor.ts");
  process.exit(runDoctor(process.argv.slice(3)));
}
```

Note `liveSetupDeps(config, [])` passes no sessions: `doctor` reports whether each source exists, and a session count of 0 means "not counted here", so in `formatDoctor` the line for a found source with 0 sessions reads `0 sessions`; to avoid implying there are none, change the `found` branch to print `source found` when called from the CLI: add an optional second argument `{ sessionsKnown: boolean }` to `formatDoctor` (default `true`) and have `runDoctor` pass `false`, printing `found` instead of a count when it is `false`. Add a test for both outputs. Run: `bun test && bun run typecheck`, then `bun bin/tuiboard.ts doctor` by hand. Expected: tests PASS, the command prints a report and exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/cli/doctor.ts src/cli/doctor.test.ts bin/tuiboard.ts
git commit -m "feat: tuiboard doctor"
```

---

### Task 9: Docs, the clean-machine run, and the changelog

**Files:**
- Modify: `README.md` (Quick start and First run)
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `.tuiboard/config.example.yaml` (a comment pointing at `tuiboard doctor`)

- [ ] **Step 1: Run the clean-machine first run again, before the docs**

Write a throwaway script `demo/shots/_firstrun.tsx` (do not commit it) that does what the spike did: a temp HOME and an empty working folder, mount `TopBar`, `Dashboard`, `BottomBar` in `testRender` at 120x34 (copy the setup block from `demo/shots/capture.tsx`'s `stage()`), open the wizard with `store.openBoardNew(true)`, then drive `boardNewChooseMode("create")`, `boardNewSubmitText("Work")`, `boardNewSubmitText("")`, `boardNewAnswerExamples(true)`, and print `captureCharFrame()` after each step, then press `S` through `handleKey` and print the Setup dialog. Run it with `bun --preload ./node_modules/@opentui/solid/scripts/preload.ts demo/shots/_firstrun.tsx` and read the frames. Expected: the welcome paragraph, the examples step, a dashboard with four example tasks (one in the Agenda), the longer banner, and the Setup dialog showing `○` for the missing agents and calendars. Fix anything that looks wrong at its task, then delete the script.

- [ ] **Step 2: Documentation**

In `README.md`: rewrite the `## First run` section to describe the welcome, the optional example tasks, the new default folder (`~/Documents/tuiboard`, then `~/tuiboard`) and `S` / `tuiboard doctor`; in the Quick start list, replace the manual config step by "run `tuiboard`: it asks"; add `tuiboard doctor` to the headless commands. In `CHANGELOG.md` `[Unreleased]` add under `### Added` and `### Changed`:

- Added: **A first run that teaches** (a welcome that says what tuiboard is; an optional set of example tasks, `board add --examples`; empty zones say what to do next); **Setup** (`S` in the app, `tuiboard doctor [--json]` in the shell: boards, agents found, calendar, zones, updates).
- Changed: **New boards go in a visible folder** (`~/Documents/tuiboard`, then `~/tuiboard`) instead of `~/.local/share/tuiboard/boards`; boards already configured and `XDG_DATA_HOME` are unaffected. The bottom bar shows the dialog's keys while a dialog is open.

In `.tuiboard/config.example.yaml` add above the `status_file` comment: `# Run \`tuiboard doctor\` (or press S in the app) to see what is connected.`

- [ ] **Step 3: Full verification**

Run: `bun run typecheck && bun test`
Expected: PASS, no failures. Then `git status` shows only intended files.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md .tuiboard/config.example.yaml
git commit -m "docs: first run, Setup and doctor"
```

---

## Self-review (done while writing)

- **Spec coverage:** A (welcome, bar, banner) is Task 4; B (default folder) Task 1; C (examples, CLI) Tasks 2 and 3; D (empty states) Task 5; E (Setup, `S`, doctor) Tasks 6, 7, 8; F (flow) is how Tasks 3 and 7 connect; the tests, risks and decision log map to Review Focus and Task 9. The toast already lives on the parent branch.
- **Types:** `exampleTasks` and `CreateBoardOptions.examples` (Task 2) are what Task 3 imports; `BoardNew.examples` and `boardNewAnswerExamples` (Task 3) are what the modal and key handler call; `SetupDeps` and `SetupStatus` (Task 6) are what Tasks 7 and 8 use; `readUpdateCache` (Task 7) is the renamed `readCache`.
- **Known soft spots, called out in the steps rather than hidden:** Task 5 Step 4 refers to names inside `TimelineView.tsx` and `BoardView.tsx` that the implementer must read (`entries()`, the entry `kind`, `BoardViewProps`); Task 3 Step 4 extends `boardNewMove`'s length rule; Task 8's `sessionsKnown` flag. Each says where to look and what to assert.
