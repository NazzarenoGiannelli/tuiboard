/**
 * Board lifecycle from the command line.
 *
 *   tuiboard board add  --path <file.md> [--name <n>] [--columns "A,B,C"] [--dry-run]
 *   tuiboard board scan <dir>
 *   tuiboard board list
 *
 * Same three operations the TUI's `+` performs, over the same `src/boards/`
 * functions. That is deliberate: if the modal and this file share everything
 * but their input, the subsystem is genuinely decoupled from the renderer —
 * and a board can be created from a script, a bar widget, or an agent.
 *
 * `add` creates the file when it is missing and registers it either way, so
 * adopting an existing board and making a new one are the same command.
 */

import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { addBoardToConfig } from "~/boards/config-writer";
import { createBoardFile, DEFAULT_COLUMNS } from "~/boards/create";
import { scanDirectory } from "~/boards/scan";
import { suggestBoardsDir } from "~/boards/suggest";
import { loadConfig } from "~/config/loader";

interface Args {
  path?: string;
  name?: string;
  columns?: string[];
  dryRun: boolean;
  rest: string[];
}

function parse(argv: readonly string[]): Args {
  const a: Args = { dryRun: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const take = () => argv[++i];
    if (arg === "--path") a.path = take();
    else if (arg === "--name") a.name = take();
    else if (arg === "--columns") a.columns = splitColumns(take());
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg.startsWith("--path=")) a.path = arg.slice(7);
    else if (arg.startsWith("--name=")) a.name = arg.slice(7);
    else if (arg.startsWith("--columns=")) a.columns = splitColumns(arg.slice(10));
    else if (arg.startsWith("--")) throw new Error(`unknown argument "${arg}"`);
    else a.rest.push(arg);
  }
  return a;
}

function splitColumns(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

export async function runBoard(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== "add" && sub !== "scan" && sub !== "list") {
    console.error("usage: tuiboard board <add|scan|list> [options]");
    return 2;
  }

  let a: Args;
  try {
    a = parse(argv.slice(1));
  } catch (e) {
    console.error(`tuiboard board: ${(e as Error).message}`);
    return 2;
  }

  try {
    if (sub === "list") {
      const config = loadConfig();
      if (config.boards.length === 0) {
        console.log("No boards configured. Add one with `tuiboard board add --path <file.md>`.");
        return 0;
      }
      for (const b of config.boards) {
        const name = b.name ?? basename(b.path, extname(b.path));
        const missing = existsSync(b.path) ? "" : "  (file missing)";
        console.log(`${name}\t${b.path}${missing}`);
      }
      console.log(`\nNew boards would be created in: ${suggestBoardsDir(config)}`);
      return 0;
    }

    if (sub === "scan") {
      const dir = resolve(a.rest[0] ?? process.cwd());
      const existingPaths = loadConfig().boards.map((b) => b.path);
      const found = scanDirectory(dir, { existingPaths });
      if (found.length === 0) {
        console.log(`No board files in ${dir}.`);
        return 0;
      }
      for (const c of found) {
        const mark = c.alreadyInConfig ? "already configured" : "not configured";
        const tasks = `${c.taskCount} task${c.taskCount === 1 ? "" : "s"}`;
        console.log(`${c.suggestedName}\t${tasks}\t${mark}\t${c.path}`);
      }
      return 0;
    }

    // add
    if (!a.path) {
      console.error("tuiboard board add: --path is required");
      return 2;
    }
    const path = resolve(a.path);
    const name = a.name ?? basename(path, extname(path));
    const columns = a.columns ?? [...DEFAULT_COLUMNS];
    const exists = existsSync(path);

    if (a.dryRun) {
      console.log(
        exists
          ? `[dry-run] would adopt existing board ${path} as "${name}"`
          : `[dry-run] would create ${path} with columns ${columns.join(", ")} as "${name}"`,
      );
      return 0;
    }

    // File first, config second: a file with no config entry is a board to
    // adopt next time, while a config entry pointing at nothing is a broken
    // launch. See docs/superpowers/specs/2026-09-01-board-lifecycle-design.md.
    if (!exists) createBoardFile(path, { columns });

    try {
      const result = addBoardToConfig({ path, name });
      console.log(
        `${exists ? "adopted" : "created"} ${path} as "${name}" in ${result.configPath}` +
          (result.created ? " (config created)" : ""),
      );
      return 0;
    } catch (e) {
      // Partial success is reported as such: the file is on disk either way.
      if (!exists) {
        console.error(
          `created ${path}, but it was not registered: ${(e as Error).message}`,
        );
        return 1;
      }
      throw e;
    }
  } catch (e) {
    console.error(`tuiboard board: ${(e as Error).message}`);
    return 1;
  }
}
