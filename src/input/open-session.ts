/**
 * Open (resume) an agent session in a new tab/window of the terminal tuiboard
 * runs in. There's no terminal-agnostic "open a tab" — each terminal has its
 * own IPC — so we detect the environment and build a launch plan for it.
 *
 * Planning is pure (env + platform in, argv out) so every OS's plan is unit
 * tested anywhere; `runLaunchPlan` does the spawning.
 */

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

export interface LaunchStep {
  cmd: string;
  args: string[];
  /** Text piped to stdin. */
  input?: string;
  /** Long-lived GUI process: spawn detached and don't wait for it. */
  detached?: boolean;
  /** Windows: this step IS the new window (a console app), so don't hide it. */
  showConsole?: boolean;
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
      return [
        {
          // `-w 0` = the current window. wt treats `;` as its own command
          // separator, so escape any in the resume command.
          cmd: "wt",
          args: [
            "-w", "0", "new-tab", "-d", cwd,
            windowsShell(has), "-NoExit", "-Command", resume.replaceAll(";", "\\;"),
          ],
          detached: true,
        },
      ];
    case "windows-console":
      // A detached console process gets its own new console window.
      return [
        {
          cmd: windowsShell(has),
          args: ["-NoExit", "-Command", `Set-Location -LiteralPath '${cwd.replaceAll("'", "''")}'; ${resume}`],
          detached: true,
          showConsole: true,
        },
      ];
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
    // Absolute path: Windows App Execution Aliases (wt, Store pwsh) only
    // launch reliably when spawned by their resolved path.
    const exe = Bun.which(step.cmd) ?? step.cmd;
    if (step.detached) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(exe, args, {
          detached: true,
          stdio: "ignore",
          windowsHide: !step.showConsole,
        });
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
