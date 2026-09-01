/**
 * Register a board in the user's config.
 *
 * This is the only place in tuiboard that edits a file the user wrote by
 * hand — one that carries comments, calendar credentials, resume commands and
 * whatever formatting its author preferred. So it does NOT read the YAML,
 * modify an object and serialize it back: `js-yaml` does not preserve
 * comments, and that round trip would hand back a reformatted, stripped
 * document every time a board is added.
 *
 * Instead the only mutation needed — appending an entry to `boards:` — is done
 * as a text insertion. Everything else in the file survives because it is
 * never touched, rather than because someone remembered to copy it across.
 *
 * The YAML parser is still used, twice, as a judge: once to refuse a file that
 * does not parse (guessing where to insert into a broken document is how a
 * config gets destroyed), and once on the result, to abandon the write if the
 * board did not land where it should. A failed addition beats a corrupt file.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import * as YAML from "js-yaml";

import { findConfigPath } from "~/config/loader";
import { writeBoardFile } from "~/io/writer";

export interface BoardEntry {
  /** Path to the board file. Relative paths are made absolute before writing. */
  path: string;
  /** Display name. Defaults to the filename without extension. */
  name?: string;
}

export interface AddBoardResult {
  /** The config file written. */
  configPath: string;
  /** True when the config did not exist and was created by this call. */
  created: boolean;
  /** The name the board was registered under. */
  name: string;
}

interface RawBoards {
  boards?: Array<string | { path?: string; name?: string }>;
}

export function addBoardToConfig(entry: BoardEntry): AddBoardResult {
  const path = resolve(entry.path);
  const name = (entry.name ?? basename(path, extname(path))).trim();
  if (!name) throw new Error("a board needs a name");

  const { path: configPath, exists } = findConfigPath();

  if (!exists) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeBoardFile(configPath, renderFreshConfig(path, name));
    return { configPath, created: true, name };
  }

  const original = readFileSync(configPath, "utf-8");

  let parsed: RawBoards;
  try {
    parsed = (YAML.load(original) ?? {}) as RawBoards;
  } catch (e) {
    throw new Error(`${configPath} is not valid YAML: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} does not hold a YAML mapping`);
  }

  assertNotRegistered(parsed, configPath, path, name);

  const updated = insertBoard(original, path, name);

  // Judge the result before it reaches the disk.
  let after: RawBoards;
  try {
    after = (YAML.load(updated) ?? {}) as RawBoards;
  } catch (e) {
    throw new Error(`refusing to write: the result would not parse (${(e as Error).message})`);
  }
  const landed = (after.boards ?? []).some(
    (b) => typeof b === "object" && b !== null && resolve(String(b.path ?? "")) === path,
  );
  if (!landed) {
    throw new Error("refusing to write: the board did not land in `boards:` as expected");
  }

  writeBoardFile(configPath, updated);
  return { configPath, created: false, name };
}

/**
 * Both checks protect the same thing: `tuiboard task --board <name>` resolves
 * by name, and the bar widget calls it. Two boards sharing a name — or one
 * file registered twice — would make that command ambiguous.
 */
function assertNotRegistered(
  parsed: RawBoards,
  configPath: string,
  path: string,
  name: string,
): void {
  for (const b of parsed.boards ?? []) {
    const existingPath = typeof b === "string" ? b : (b?.path ?? "");
    const existingName =
      typeof b === "string"
        ? basename(b, extname(b))
        : (b?.name ?? basename(existingPath, extname(existingPath)));

    if (existingPath && resolve(existingPath) === path) {
      throw new Error(`${path} is already registered in ${configPath}`);
    }
    if (existingName.toLowerCase() === name.toLowerCase()) {
      throw new Error(`a board named "${existingName}" is already registered in ${configPath}`);
    }
  }
}

/** A config file for someone who had none: only what is needed, plus a pointer. */
function renderFreshConfig(path: string, name: string): string {
  return [
    "# tuiboard config — https://github.com/NazzarenoGiannelli/tuiboard",
    "# Boards are plain markdown files; add more with `+` in the board zone.",
    "boards:",
    ...renderEntry(path, name, "  "),
    "",
  ].join("\n");
}

function renderEntry(path: string, name: string, indent: string): string[] {
  return [`${indent}- path: ${quote(path)}`, `${indent}  name: ${quote(name)}`];
}

/** Quote only when the value could be misread as YAML syntax. */
function quote(value: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9 _.\-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * The three shapes a real config presents:
 *
 *   boards:            → block list; append after its last entry
 *     - path: …
 *   boards: []         → inline empty list; replace with a block list
 *   (no boards key)    → prepend the key
 *
 * Anything else inline (`boards: [{path: …}]`) is refused: rewriting flow
 * style safely means re-serializing, which is exactly what this module exists
 * to avoid.
 */
function insertBoard(original: string, path: string, name: string): string {
  const lines = original.split("\n");
  const keyIndex = lines.findIndex((l) => /^boards:\s*(#.*)?$/.test(l) || /^boards:\s*\S/.test(l));

  if (keyIndex < 0) {
    const block = ["boards:", ...renderEntry(path, name, "  "), ""];
    return [...block, ...lines].join("\n");
  }

  const value = lines[keyIndex]!.replace(/^boards:\s*/, "").replace(/\s*#.*$/, "").trim();

  if (value === "[]") {
    lines.splice(keyIndex, 1, "boards:", ...renderEntry(path, name, "  "));
    return lines.join("\n");
  }
  if (value !== "") {
    throw new Error(
      `refusing to edit \`boards: ${value}\` — rewrite it as a block list first`,
    );
  }

  // Block list: walk to the last line belonging to it. Indented lines are part
  // of the block; blank lines are only part of it if something indented
  // follows, so a trailing blank line before the next key stays where it is.
  let end = keyIndex;
  let indent = "  ";
  for (let i = keyIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break;
    const dash = line.match(/^(\s*)- /);
    if (dash) indent = dash[1]!;
    end = i;
  }

  lines.splice(end + 1, 0, ...renderEntry(path, name, indent));
  return lines.join("\n");
}
