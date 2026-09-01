/**
 * The board lifecycle: scanning a directory, creating a board file, and
 * registering it in the user's config.
 *
 * `addBoardToConfig` edits a file this program did not write — one that holds
 * hand-maintained comments, calendar credentials and resume commands. That is
 * the risk this suite exists for: the tests below assert not only that the new
 * board arrives, but that everything around it is returned byte for byte.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "~/config/loader";
import { parseBoard } from "~/parser/markdown";
import { serializeBoard } from "~/parser/serialize";
import { addBoardToConfig } from "./config-writer";
import { createBoardFile } from "./create";
import { scanDirectory } from "./scan";
import { suggestBoardsDir } from "./suggest";

const BOARD_MD = `---

kanban-plugin: board

---

## Home
- [ ] Bollette ⏳ 2026-08-31
- [x] Spesa ✅ 2026-08-31
`;

/** A config with everything a real one carries: comments, nested keys, quotes. */
const RICH_CONFIG = `# tuiboard config — hand written, keep the comments
boards:
  - path: "/vault/Tasks - Personal.md"
    name: Personal
  # the platform board lives in the same vault
  - path: "/vault/Tasks - Platform.md"
    name: Platform

done_column: Done
archive_column: Archive

# Optional: override Enter in the Agents zone.
resume_command: ["nu", "/home/nazz/.config/tuiboard/code-resume.nu", "{cwd}", "{sessionId}"]

calendars:
  google:
    enabled: true
    token: ~/.config/tuiboard/google-token.json

zones:
  planner: on
  agenda: hidden
`;

let dir: string;
let previousConfig: string | undefined;

function configPath(): string {
  return join(dir, "config.yaml");
}

function useConfig(text: string | null): void {
  if (text === null) rmSync(configPath(), { force: true });
  else writeFileSync(configPath(), text, "utf-8");
  process.env.TUIBOARD_CONFIG = configPath();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tuiboard-boards-"));
  previousConfig = process.env.TUIBOARD_CONFIG;
});

afterEach(() => {
  if (previousConfig === undefined) delete process.env.TUIBOARD_CONFIG;
  else process.env.TUIBOARD_CONFIG = previousConfig;
  rmSync(dir, { recursive: true, force: true });
});

describe("createBoardFile", () => {
  it("writes a file the parser reads back with the requested columns", () => {
    const path = join(dir, "New.md");
    createBoardFile(path, { columns: ["Todo", "Doing", "Done"] });

    const { board } = parseBoard(readFileSync(path, "utf-8"), { filepath: path });
    expect(board.columns.map((c) => c.name)).toEqual(["Todo", "Doing", "Done"]);
  });

  it("marks the file as an Obsidian Kanban board", () => {
    const path = join(dir, "New.md");
    createBoardFile(path, { columns: ["Todo"] });
    expect(readFileSync(path, "utf-8")).toContain("kanban-plugin: board");
  });

  it("survives a parse/serialize round trip unchanged", () => {
    const path = join(dir, "New.md");
    createBoardFile(path, { columns: ["Todo", "Doing"] });
    const original = readFileSync(path, "utf-8");
    const { board } = parseBoard(original, { filepath: path });
    expect(serializeBoard(board)).toBe(original);
  });

  it("never overwrites an existing file", () => {
    const path = join(dir, "Existing.md");
    writeFileSync(path, "precious", "utf-8");
    expect(() => createBoardFile(path, { columns: ["Todo"] })).toThrow();
    expect(readFileSync(path, "utf-8")).toBe("precious");
  });

  it("creates missing parent directories", () => {
    const path = join(dir, "nested", "deeper", "New.md");
    createBoardFile(path, { columns: ["Todo"] });
    expect(existsSync(path)).toBe(true);
  });

  it("refuses an empty column list — a board with no columns holds nothing", () => {
    expect(() => createBoardFile(join(dir, "New.md"), { columns: [] })).toThrow();
  });
});

describe("scanDirectory", () => {
  beforeEach(() => {
    writeFileSync(join(dir, "Board.md"), BOARD_MD, "utf-8");
    writeFileSync(join(dir, "Notes.md"), "# Just a note\n\nNo tasks here.\n", "utf-8");
    writeFileSync(join(dir, "readme.txt"), "- [ ] not markdown\n", "utf-8");
  });

  it("finds markdown files containing tasks and ignores the rest", () => {
    const found = scanDirectory(dir);
    expect(found.map((c) => c.suggestedName)).toEqual(["Board"]);
  });

  it("reports how many tasks each candidate holds", () => {
    expect(scanDirectory(dir)[0]!.taskCount).toBe(2);
  });

  it("marks candidates already registered in the config", () => {
    const path = join(dir, "Board.md");
    expect(scanDirectory(dir, { existingPaths: [path] })[0]!.alreadyInConfig).toBe(true);
    expect(scanDirectory(dir)[0]!.alreadyInConfig).toBe(false);
  });

  it("recognises a freshly created board that has no tasks yet", () => {
    createBoardFile(join(dir, "Empty.md"), { columns: ["Todo"] });
    expect(scanDirectory(dir).map((c) => c.suggestedName)).toEqual(["Board", "Empty"]);
  });

  it("returns nothing for an empty or missing directory instead of throwing", () => {
    expect(scanDirectory(join(dir, "does-not-exist"))).toEqual([]);
    mkdirSync(join(dir, "empty"));
    expect(scanDirectory(join(dir, "empty"))).toEqual([]);
  });
});

describe("addBoardToConfig", () => {
  // The guard that turns "wrote to the wrong file" from a silent accident into
  // a red test: every write in this suite must land inside the temp directory.
  function addHere(entry: { path: string; name?: string }) {
    const result = addBoardToConfig(entry);
    expect(result.configPath.startsWith(dir)).toBe(true);
    return result;
  }

  it("appends to a block list, leaving comments and every other key untouched", () => {
    useConfig(RICH_CONFIG);
    addHere({ path: "/vault/Sessions.md", name: "Sessions" });

    const after = readFileSync(configPath(), "utf-8");
    // Everything that was there is still there, verbatim.
    for (const line of RICH_CONFIG.split("\n")) {
      if (line.trim()) expect(after).toContain(line);
    }
    expect(after).toContain("name: Sessions");
  });

  it("registers the board where loadConfig() finds it", () => {
    useConfig(RICH_CONFIG);
    addHere({ path: "/vault/Sessions.md", name: "Sessions" });

    const cfg = loadConfig();
    expect(cfg.boards.map((b) => b.name)).toContain("Sessions");
    expect(cfg.boards).toHaveLength(3);
  });

  it("handles an inline empty list", () => {
    useConfig("boards: []\ndone_column: Done\n");
    addHere({ path: "/vault/A.md", name: "A" });

    const cfg = loadConfig();
    expect(cfg.boards).toHaveLength(1);
    expect(readFileSync(configPath(), "utf-8")).toContain("done_column: Done");
  });

  it("handles a config with no boards key at all", () => {
    useConfig("done_column: Fatto\n");
    addHere({ path: "/vault/A.md", name: "A" });

    const cfg = loadConfig();
    expect(cfg.boards).toHaveLength(1);
    expect(cfg.doneColumn).toBe("Fatto");
  });

  it("creates the config when none exists, and says so", () => {
    useConfig(null);
    const result = addHere({ path: "/vault/A.md", name: "A" });

    expect(result.created).toBe(true);
    expect(loadConfig().boards).toHaveLength(1);
  });

  it("refuses a duplicate name and leaves the file alone", () => {
    useConfig(RICH_CONFIG);
    expect(() => addBoardToConfig({ path: "/vault/Other.md", name: "Personal" })).toThrow();
    expect(readFileSync(configPath(), "utf-8")).toBe(RICH_CONFIG);
  });

  it("refuses a path already registered and leaves the file alone", () => {
    useConfig(RICH_CONFIG);
    expect(() =>
      addBoardToConfig({ path: "/vault/Tasks - Personal.md", name: "Altro" }),
    ).toThrow();
    expect(readFileSync(configPath(), "utf-8")).toBe(RICH_CONFIG);
  });

  it("refuses malformed YAML rather than guessing where to insert", () => {
    const broken = "boards:\n  - path: [unclosed\n";
    useConfig(broken);
    expect(() => addBoardToConfig({ path: "/vault/A.md", name: "A" })).toThrow();
    expect(readFileSync(configPath(), "utf-8")).toBe(broken);
  });

  it("stores an absolute path even when handed a relative one", () => {
    useConfig("boards: []\n");
    addHere({ path: "relative/A.md", name: "A" });
    expect(loadConfig().boards[0]!.path.startsWith("/")).toBe(true);
  });
});

describe("suggestBoardsDir", () => {
  it("proposes the directory the existing boards share", () => {
    const cfg = {
      boards: [{ path: "/vault/A.md" }, { path: "/vault/B.md" }],
    } as ReturnType<typeof loadConfig>;
    expect(suggestBoardsDir(cfg)).toBe("/vault");
  });

  it("falls back to the app directory when the boards are scattered", () => {
    const cfg = {
      boards: [{ path: "/vault/A.md" }, { path: "/elsewhere/B.md" }],
    } as ReturnType<typeof loadConfig>;
    expect(suggestBoardsDir(cfg)).toContain("tuiboard");
  });

  it("falls back to the app directory when there are no boards", () => {
    const cfg = { boards: [] } as unknown as ReturnType<typeof loadConfig>;
    expect(suggestBoardsDir(cfg)).toContain("tuiboard");
  });
});
