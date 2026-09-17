/**
 * Open (resume) an agent session in a new tab/window of the terminal tuiboard
 * runs in. There's no terminal-agnostic "open a tab" — each terminal has its
 * own IPC — so we detect the environment and build a launch plan for it.
 *
 * Planning is pure (env + platform in, argv out) so every OS's plan is unit
 * tested anywhere; `runLaunchPlan` does the spawning.
 */

import { lstatSync } from "node:fs";
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
  "windows-console": "a new PowerShell window",
  "macos-terminal": "Terminal.app",
};

export interface LaunchEnv {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** Is this program on PATH? */
  has: (cmd: string) => boolean;
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

export interface LaunchStep {
  cmd: string;
  args: string[];
  /** Text piped to stdin. */
  input?: string;
  /** Long-lived GUI process: spawn detached and don't wait for it. */
  detached?: boolean;
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
}

/** POSIX: run the agent, then leave the user in their shell when it exits. */
function posixKeepOpen(resume: string): string[] {
  return ["sh", "-c", `${resume}; exec "\${SHELL:-sh}"`];
}

function windowsShell(has: LaunchEnv["has"]): string {
  return has("pwsh") ? "pwsh" : "powershell";
}

/** Quote one argument by the Windows command-line (CommandLineToArgvW) rules. */
export function winQuoteArg(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) return a;
  const escaped = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
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
    `-ArgumentList ${lit(args.map(winQuoteArg).join(" "))}`,
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
  };
}

function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function planLaunch(
  launcher: Launcher,
  { cwd, resume }: LaunchTarget,
  { env, platform, has }: LaunchEnv,
): LaunchStep[] {
  switch (launcher) {
    case "tmux":
      return [
        {
          cmd: "tmux",
          args: ["new-window", "-P", "-F", "#{pane_id}", "-c", cwd],
          captureId: (out) => out.trim() || undefined,
        },
        // Typed into the pane's interactive shell (full user env), then Enter.
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
    case "windows-terminal":
      // `-w 0` = the current window. wt treats `;` as its own command
      // separator, so escape any in the resume command.
      return [
        windowsStart(
          "wt.exe",
          ["-w", "0", "new-tab", "-d", cwd, windowsShell(has), "-NoExit", "-Command", resume.replaceAll(";", "\\;")],
          env,
        ),
      ];
    case "windows-console":
      // Start-Process gives a console program its own new window.
      return [windowsStart(windowsShell(has), ["-NoExit", "-Command", resume], env, cwd)];
    case "ghostty":
      // Ghostty has no "new tab" CLI: open a new window in the session dir.
      return platform === "darwin"
        ? [
            {
              cmd: "open",
              args: ["-na", "Ghostty", "--args", `--working-directory=${cwd}`, "-e", ...posixKeepOpen(resume)],
              detached: true,
            },
          ]
        : [
            {
              cmd: "ghostty",
              args: [`--working-directory=${cwd}`, "-e", ...posixKeepOpen(resume)],
              detached: true,
            },
          ];
    case "xdg-terminal-exec":
      return [
        {
          cmd: "xdg-terminal-exec",
          args: [`--dir=${cwd}`, ...posixKeepOpen(resume)],
          detached: true,
        },
      ];
    case "macos-terminal":
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

/**
 * Run a plan. Throws with a readable message on the first failing step.
 * Short IPC steps run synchronously (their output feeds the next step);
 * GUI launches are detached so tuiboard doesn't wait on the new window.
 */
export async function runLaunchPlan(steps: LaunchStep[]): Promise<void> {
  const { spawn, spawnSync } = await import("node:child_process");
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
    const res = spawnSync(exe, args, {
      input: step.input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (res.error) throw new Error(`${step.cmd}: ${res.error.message}`);
    if (res.status !== 0) {
      throw new Error(`${step.cmd}: ${(res.stderr || "").trim() || `exit ${res.status}`}`);
    }
    if (step.captureId) {
      id = step.captureId(res.stdout ?? "");
      if (!id) throw new Error(`${step.cmd}: unexpected output`);
    }
  }
}
