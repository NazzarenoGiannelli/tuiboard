/**
 * Minimal argv parser for tuiboard. Only handles `--view=X` and `--view X`
 * because that's all this app uses. Anything fancier (subcommands, multi-
 * value flags) would warrant a real CLI library — YAGNI here.
 */

export type ViewKind = "board" | "timeline" | "agents";

const VALID_VIEWS: readonly ViewKind[] = ["board", "timeline", "agents"];

export interface ParsedArgs {
  /** Undefined means: render the default Dashboard (all 4 zones). */
  view?: ViewKind;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let view: ViewKind | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let candidate: string | undefined;

    if (arg.startsWith("--view=")) {
      candidate = arg.slice("--view=".length);
    } else if (arg === "--view") {
      candidate = argv[i + 1];
      i++; // consume the value
    }

    if (candidate === undefined) continue;
    if ((VALID_VIEWS as readonly string[]).includes(candidate)) {
      view = candidate as ViewKind;
    } else {
      console.error(
        `tuiboard: unknown --view value "${candidate}" — must be one of ${VALID_VIEWS.join(", ")}. Falling back to dashboard.`,
      );
    }
  }

  return { view };
}
