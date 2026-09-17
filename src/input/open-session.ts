/**
 * Open (resume) an agent session in a new tab/window of the terminal tuiboard
 * runs in. There's no terminal-agnostic "open a tab" — each terminal has its
 * own IPC — so we detect the environment and build a launch plan for it.
 * The session runs inside the user's shell (see `resolveShell`), which stays
 * open when the agent exits.
 *
 * Planning is pure (env + platform in, argv out) so every OS's plan is unit
 * tested anywhere; `runLaunchPlan` does the spawning.
 */

import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export const LAUNCHERS = [
  "tmux",
  "herdr",
  "wezterm",
  "windows-terminal",
  "ghostty",
  "xdg-terminal-exec",
  "windows-console",
  "macos-terminal",
] as const;
export type Launcher = (typeof LAUNCHERS)[number];

export const LAUNCHER_NAME: Record<Launcher, string> = {
  tmux: "tmux",
  herdr: "herdr",
  wezterm: "WezTerm",
  "windows-terminal": "Windows Terminal",
  ghostty: "Ghostty",
  "xdg-terminal-exec": "your default terminal",
  "windows-console": "a new console window",
  "macos-terminal": "Terminal.app",
};

export const SHELLS = ["bash", "zsh", "fish", "nu", "pwsh", "powershell", "cmd"] as const;
export type Shell = (typeof SHELLS)[number];

export interface LaunchEnv {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** Is this program launchable (on PATH, or a Windows app alias)? */
  has: (cmd: string) => boolean;
  /** Full path of a program on PATH. */
  which?: (cmd: string) => string | undefined;
  /** Does this file exist? */
  exists?: (path: string) => boolean;
}

/**
 * Pick the launcher for this environment. Multiplexers first (a tmux inside
 * Ghostty should open a tmux window, not a Ghostty one), then terminals by
 * their own env markers, then a per-OS generic fallback.
 */
export function detectLauncher({ env, platform, has }: LaunchEnv): Launcher | undefined {
  if (env.TMUX) return "tmux";
  if (env.HERDR_ENV) return "herdr";
  if (env.WEZTERM_PANE) return "wezterm";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.TERM_PROGRAM === "ghostty") return "ghostty";
  if (platform === "win32") return has("wt") ? "windows-terminal" : "windows-console";
  if (platform === "darwin") return "macos-terminal";
  if (has("xdg-terminal-exec")) return "xdg-terminal-exec";
  return undefined;
}

/**
 * Is `cmd` launchable? `Bun.which` skips Windows App Execution Aliases
 * (`wt.exe`, Store `pwsh.exe`: zero-byte reparse points in
 * %LOCALAPPDATA%\Microsoft\WindowsApps), so look for those explicitly.
 */
export function hasCommand(cmd: string): boolean {
  if (Bun.which(cmd) !== null) return true;
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return false;
  try {
    lstatSync(join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", `${cmd}.exe`));
    return true;
  } catch {
    return false;
  }
}

/** The real environment, for the key handler and the dev script. */
export function systemLaunchEnv(): LaunchEnv {
  return {
    env: process.env,
    platform: process.platform,
    has: hasCommand,
    which: (c) => Bun.which(c) ?? undefined,
    exists: existsSync,
  };
}

// ─── Shells ─────────────────────────────────────────────────────────────────

/**
 * How the new tab's program is chosen: a named shell, or (POSIX `auto`) a
 * plain `sh` that hands over to `$SHELL` — already the user's shell.
 */
export type ResolvedShell =
  | { kind: "posix-default" }
  | { kind: Shell; path: string };

/** Windows: Git for Windows' `bin\bash.exe` (the login wrapper), never System32's WSL bash. */
export function findGitBash({ env, which, exists = () => false }: LaunchEnv): string | undefined {
  const candidates: string[] = [];
  // Set by Git's launchers (git-bash.exe, bin\bash.exe) to the install dir.
  if (env.EXEPATH) candidates.push(`${env.EXEPATH}\\bin\\bash.exe`);
  const onPath = which?.("bash");
  if (onPath && /\\git\\/i.test(onPath) && !/\\system32\\/i.test(onPath)) {
    // …\Git\usr\bin\bash.exe is the bare MSYS binary; …\Git\bin\bash.exe sets up the login env.
    candidates.push(onPath.replace(/\\usr\\bin\\bash\.exe$/i, "\\bin\\bash.exe"));
  }
  for (const pf of [env.ProgramFiles, env.ProgramW6432, "C:\\Program Files"]) {
    if (pf) candidates.push(`${pf}\\Git\\bin\\bash.exe`);
  }
  return candidates.find((c) => exists(c));
}

/**
 * The shell the session should run in. `auto` = the shell tuiboard was
 * started from: on Windows Git Bash (`MSYSTEM`) or Nushell (`NU_VERSION`),
 * else PowerShell; elsewhere `$SHELL` via the POSIX default.
 */
export function resolveShell(choice: "auto" | Shell, le: LaunchEnv): ResolvedShell {
  const { env, platform, has } = le;
  if (choice === "auto") {
    if (platform !== "win32") return { kind: "posix-default" };
    if (env.MSYSTEM) {
      const bash = findGitBash(le);
      if (bash) return { kind: "bash", path: bash };
    }
    if (env.NU_VERSION && has("nu")) return { kind: "nu", path: "nu" };
    return has("pwsh") ? { kind: "pwsh", path: "pwsh" } : { kind: "powershell", path: "powershell" };
  }
  if (choice === "bash" && platform === "win32") {
    const bash = findGitBash(le);
    if (bash) return { kind: "bash", path: bash };
  }
  return { kind: choice, path: choice };
}

/** argv that runs `resume` in `shell`, leaving that shell open afterwards. */
export function shellArgv(shell: ResolvedShell, resume: string): string[] {
  switch (shell.kind) {
    case "posix-default":
      return ["sh", "-c", `${resume}; exec "\${SHELL:-sh}"`];
    case "bash":
    case "zsh":
    case "fish":
      // Login + interactive so the user's PATH/aliases are loaded, then
      // replace the finished command with a fresh interactive shell.
      return [shell.path, "-l", "-i", "-c", `${resume}; exec ${shell.kind === "bash" ? "bash" : shell.kind} -l -i`];
    case "nu":
      return [shell.path, "-e", resume];
    case "pwsh":
    case "powershell":
      return [shell.path, "-NoExit", "-Command", resume];
    case "cmd":
      return [shell.path, "/k", resume];
  }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export interface LaunchStep {
  cmd: string;
  args: string[];
  /** Text piped to stdin. */
  input?: string;
  /** Long-lived GUI process: spawn detached and don't wait for it. */
  detached?: boolean;
  /** Sync step timeout (ms). */
  timeoutMs?: number;
  /**
   * Extracts an id from this step's stdout; later steps' `{id}` args are
   * replaced with it.
   */
  captureId?: (stdout: string) => string | undefined;
}

export interface LaunchTarget {
  cwd: string;
  /** The agent's resume command, e.g. `codex resume <id>`. */
  resume: string;
  /** Shell to run it in (defaults to `auto`). */
  shell?: "auto" | Shell;
}

function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Quote one argument by the Windows command-line (CommandLineToArgvW) rules. */
export function winQuoteArg(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) return a;
  const escaped = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

/** `C:/Users/x` (as OpenCode stores it) → `C:\Users\x`. */
function winPath(p: string): string {
  return /^[A-Za-z]:\//.test(p) ? p.replaceAll("/", "\\") : p;
}

/**
 * Windows: start `file` the way Run / Explorer would — via PowerShell's
 * Start-Process (ShellExecute), which resolves App Execution Aliases that
 * Bun's own spawn can't find. `powershell.exe` itself is a real System32
 * binary. The script travels as -EncodedCommand so no argument is re-parsed
 * by a shell on the way.
 */
export function windowsStart(
  file: string,
  args: string[],
  env: LaunchEnv["env"],
  workingDirectory?: string,
): LaunchStep {
  const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const start = [
    "Start-Process",
    `-FilePath ${lit(file)}`,
    args.length > 0 ? `-ArgumentList ${lit(args.map(winQuoteArg).join(" "))}` : "",
    workingDirectory ? `-WorkingDirectory ${lit(workingDirectory)}` : "",
    "-ErrorAction Stop",
  ].filter(Boolean).join(" ");
  const script = `try { ${start} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return {
    cmd: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    // A cold PowerShell start can take several seconds.
    timeoutMs: 30_000,
  };
}

export function planLaunch(
  launcher: Launcher,
  { cwd, resume, shell: shellChoice = "auto" }: LaunchTarget,
  le: LaunchEnv,
): LaunchStep[] {
  const { env, platform } = le;
  const shell = resolveShell(shellChoice, le);
  switch (launcher) {
    case "tmux":
      return [
        {
          cmd: "tmux",
          args: ["new-window", "-P", "-F", "#{pane_id}", "-c", cwd],
          captureId: (out) => out.trim() || undefined,
        },
        // Typed into the pane's own interactive shell (full user env), then Enter.
        { cmd: "tmux", args: ["send-keys", "-t", "{id}", "-l", resume] },
        { cmd: "tmux", args: ["send-keys", "-t", "{id}", "Enter"] },
      ];
    case "herdr": {
      const herdr = env.HERDR_BIN_PATH || "herdr";
      return [
        {
          cmd: herdr,
          args: ["tab", "create", "--cwd", cwd, "--label", resume.split(" ")[0] ?? "agent"],
          captureId: (out) => {
            try {
              return JSON.parse(out)?.result?.root_pane?.pane_id;
            } catch {
              return undefined;
            }
          },
        },
        { cmd: herdr, args: ["pane", "run", "{id}", resume] },
      ];
    }
    case "wezterm":
      return [
        // New tab running the user's DEFAULT shell in the session's directory;
        // prints the new pane id. Typing the command into that shell (rather
        // than `spawn -- claude …`) gives the agent the full shell environment,
        // and leaves a live prompt showing any error instead of a vanishing tab.
        {
          cmd: "wezterm",
          args: ["cli", "spawn", "--cwd", cwd],
          captureId: (out) => out.trim() || undefined,
        },
        {
          cmd: "wezterm",
          args: ["cli", "send-text", "--pane-id", "{id}", "--no-paste"],
          input: `${resume}\r`,
        },
      ];
    case "windows-terminal": {
      // `-w 0` = the current window. wt treats `;` as its own command
      // separator, so escape any in what it passes on.
      const argv = shellArgv(shell, resume).map((a) => a.replaceAll(";", "\\;"));
      return [windowsStart("wt.exe", ["-w", "0", "new-tab", "-d", winPath(cwd), ...argv], env)];
    }
    case "windows-console": {
      // Start-Process gives a console program its own new window.
      const [file, ...args] = shellArgv(shell, resume);
      return [windowsStart(file!, args, env, winPath(cwd))];
    }
    case "ghostty":
      // Ghostty has no "new tab" CLI: open a new window in the session dir.
      return platform === "darwin"
        ? [
            {
              cmd: "open",
              args: ["-na", "Ghostty", "--args", `--working-directory=${cwd}`, "-e", ...shellArgv(shell, resume)],
              detached: true,
            },
          ]
        : [
            {
              cmd: "ghostty",
              args: [`--working-directory=${cwd}`, "-e", ...shellArgv(shell, resume)],
              detached: true,
            },
          ];
    case "xdg-terminal-exec":
      return [
        {
          cmd: "xdg-terminal-exec",
          args: [`--dir=${cwd}`, ...shellArgv(shell, resume)],
          detached: true,
        },
      ];
    case "macos-terminal":
      // Terminal.app types into the user's login shell itself.
      return [
        {
          cmd: "osascript",
          args: [
            "-e",
            `tell application "Terminal" to do script ${appleScriptString(`cd ${shQuote(cwd)} && ${resume}`)}`,
            "-e",
            'tell application "Terminal" to activate',
          ],
        },
      ];
  }
}

/** Human-readable plan, for diagnostics (decodes Windows -EncodedCommand). */
export function describePlan(steps: LaunchStep[]): string {
  return steps
    .map((s) => {
      const enc = s.args.indexOf("-EncodedCommand");
      if (enc >= 0 && s.args[enc + 1]) {
        return `${s.cmd} -EncodedCommand ⟨${Buffer.from(s.args[enc + 1]!, "base64").toString("utf16le")}⟩`;
      }
      return [s.cmd, ...s.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(" ");
    })
    .join("\n");
}

/**
 * Run a plan. Throws with a readable message on the first failing step.
 * Short IPC steps are awaited (their output feeds the next step) without
 * blocking the UI; GUI launches are detached so tuiboard doesn't wait on the
 * new window.
 */
export async function runLaunchPlan(steps: LaunchStep[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  let id: string | undefined;
  for (const step of steps) {
    const args = step.args.map((a) => (id !== undefined ? a.replaceAll("{id}", id) : a));
    const exe = Bun.which(step.cmd) ?? step.cmd;
    if (step.detached) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.once("error", (e) => reject(new Error(`${step.cmd}: ${e.message}`)));
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
      continue;
    }
    const { status, stdout, stderr } = await new Promise<{
      status: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(exe, args, { windowsHide: true });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (err += d));
      const timeoutMs = step.timeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${step.cmd}: timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`${step.cmd}: ${e.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ status: code, stdout: out, stderr: err });
      });
      if (step.input !== undefined) child.stdin?.end(step.input);
      else child.stdin?.end();
    });
    if (status !== 0) {
      throw new Error(`${step.cmd}: ${stderr.trim() || `exit ${status}`}`);
    }
    if (step.captureId) {
      id = step.captureId(stdout);
      if (!id) throw new Error(`${step.cmd}: unexpected output`);
    }
  }
}
