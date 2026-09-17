import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describePlan,
  detectLauncher,
  findGitBash,
  planLaunch,
  resolveShell,
  runLaunchPlan,
  shellArgv,
  winQuoteArg,
  windowsStart,
  type LaunchEnv,
  type LaunchStep,
} from "./open-session";

/** The PowerShell script inside a windowsStart step. */
const decoded = (step: LaunchStep) =>
  Buffer.from(step.args[step.args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");

const env = (
  vars: Record<string, string>,
  platform: NodeJS.Platform = "linux",
  onPath: string[] = [],
): LaunchEnv => ({ env: vars, platform, has: (c) => onPath.includes(c) });

const target = { cwd: "/home/u/my app", resume: "codex resume 0199-abc" };

describe("detectLauncher", () => {
  it("prefers the innermost multiplexer over the terminal around it", () => {
    expect(detectLauncher(env({ TMUX: "/tmp/tmux", TERM_PROGRAM: "tmux", WT_SESSION: "x" }))).toBe("tmux");
    expect(detectLauncher(env({ HERDR_ENV: "1", TERM_PROGRAM: "ghostty" }))).toBe("herdr");
  });

  it("recognizes terminals by their own env markers", () => {
    expect(detectLauncher(env({ WEZTERM_PANE: "3", WT_SESSION: "x" }))).toBe("wezterm");
    expect(detectLauncher(env({ WT_SESSION: "guid" }, "win32"))).toBe("windows-terminal");
    expect(detectLauncher(env({ TERM_PROGRAM: "ghostty" }))).toBe("ghostty");
  });

  it("falls back per OS", () => {
    expect(detectLauncher(env({}, "win32", ["wt"]))).toBe("windows-terminal");
    expect(detectLauncher(env({}, "win32"))).toBe("windows-console");
    expect(detectLauncher(env({}, "darwin"))).toBe("macos-terminal");
    expect(detectLauncher(env({}, "linux", ["xdg-terminal-exec"]))).toBe("xdg-terminal-exec");
    expect(detectLauncher(env({}, "linux"))).toBeUndefined();
  });
});

describe("planLaunch", () => {
  it("tmux: new window in cwd, then types the command", () => {
    const steps = planLaunch("tmux", target, env({ TMUX: "x" }));
    expect(steps.map((s) => [s.cmd, ...s.args])).toEqual([
      ["tmux", "new-window", "-P", "-F", "#{pane_id}", "-c", "/home/u/my app"],
      ["tmux", "send-keys", "-t", "{id}", "-l", "codex resume 0199-abc"],
      ["tmux", "send-keys", "-t", "{id}", "Enter"],
    ]);
    expect(steps[0]!.captureId!("%12\n")).toBe("%12");
  });

  it("herdr: tab in cwd, then runs the command in its root pane", () => {
    const steps = planLaunch("herdr", target, env({ HERDR_ENV: "1", HERDR_BIN_PATH: "/opt/herdr" }));
    expect(steps[0]).toMatchObject({ cmd: "/opt/herdr", args: ["tab", "create", "--cwd", "/home/u/my app", "--label", "codex"] });
    expect(steps[1]).toMatchObject({ cmd: "/opt/herdr", args: ["pane", "run", "{id}", "codex resume 0199-abc"] });
    const out = JSON.stringify({ result: { root_pane: { pane_id: "w1:pD" } } });
    expect(steps[0]!.captureId!(out)).toBe("w1:pD");
    expect(steps[0]!.captureId!("not json")).toBeUndefined();
  });

  it("wezterm: spawn + send-text, as before", () => {
    const steps = planLaunch("wezterm", target, env({ WEZTERM_PANE: "1" }));
    expect(steps[0]!.args).toEqual(["cli", "spawn", "--cwd", "/home/u/my app"]);
    expect(steps[1]).toMatchObject({
      args: ["cli", "send-text", "--pane-id", "{id}", "--no-paste"],
      input: "codex resume 0199-abc\r",
    });
  });

  it("windows terminal: new tab in the current window via Start-Process, pwsh when available", () => {
    const w = { cwd: "C:\\Users\\n\\my app", resume: "claude --resume a;b" };
    const winEnv = { WT_SESSION: "g", SystemRoot: "D:\\Win" };
    const [step] = planLaunch("windows-terminal", w, env(winEnv, "win32", ["pwsh"]));
    expect(step!.cmd).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(step!.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(decoded(step!)).toBe(
      "try { Start-Process -FilePath 'wt.exe' " +
        `-ArgumentList '-w 0 new-tab -d "C:\\Users\\n\\my app" pwsh -NoExit -Command "claude --resume a\\;b"' ` +
        "-ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
    );
    const [ps] = planLaunch("windows-terminal", w, env(winEnv, "win32"));
    expect(decoded(ps!)).toContain(" powershell -NoExit ");
  });

  it("windows console: new PowerShell window started in the session dir", () => {
    const [step] = planLaunch("windows-console", { cwd: "C:\\it's", resume: "opencode --session s" }, env({}, "win32"));
    expect(step!.cmd).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(decoded(step!)).toBe(
      "try { Start-Process -FilePath 'powershell' " +
        `-ArgumentList '-NoExit -Command "opencode --session s"' -WorkingDirectory 'C:\\it''s' ` +
        "-ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
    );
  });

  it("ghostty: new window running the agent, then the user's shell", () => {
    const [linux] = planLaunch("ghostty", target, env({ TERM_PROGRAM: "ghostty" }));
    expect(linux).toMatchObject({
      cmd: "ghostty",
      args: ["--working-directory=/home/u/my app", "-e", "sh", "-c", 'codex resume 0199-abc; exec "${SHELL:-sh}"'],
      detached: true,
    });
    const [mac] = planLaunch("ghostty", target, env({ TERM_PROGRAM: "ghostty" }, "darwin"));
    expect(mac!.cmd).toBe("open");
    expect(mac!.args.slice(0, 4)).toEqual(["-na", "Ghostty", "--args", "--working-directory=/home/u/my app"]);
  });

  it("xdg-terminal-exec: default terminal in cwd", () => {
    const [step] = planLaunch("xdg-terminal-exec", target, env({}));
    expect(step!.args.slice(0, 2)).toEqual(["--dir=/home/u/my app", "sh"]);
  });

  it("macOS Terminal: quotes the path for sh and the script for AppleScript", () => {
    const [step] = planLaunch("macos-terminal", { cwd: `/Users/u/it's "x"`, resume: "claude --resume 1" }, env({}, "darwin"));
    expect(step!.args[1]).toBe(
      // sh escape '\'' → AppleScript doubles its backslash; " → \"
      `tell application "Terminal" to do script "cd '/Users/u/it'\\\\''s \\"x\\"' && claude --resume 1"`,
    );
  });
});

const GIT = "C:\\Program Files\\Git";
const gitBashEnv = (vars: Record<string, string>, files: string[], bashOnPath?: string): LaunchEnv => ({
  env: vars,
  platform: "win32",
  has: () => false,
  which: (c) => (c === "bash" ? bashOnPath : undefined),
  exists: (p) => files.includes(p),
});

describe("findGitBash", () => {
  it("prefers EXEPATH, then Git's usr\\bin bash mapped to bin, then Program Files", () => {
    const bin = `${GIT}\\bin\\bash.exe`;
    expect(findGitBash(gitBashEnv({ EXEPATH: GIT }, [bin]))).toBe(bin);
    expect(findGitBash(gitBashEnv({}, [bin], `${GIT}\\usr\\bin\\bash.exe`))).toBe(bin);
    expect(findGitBash(gitBashEnv({ ProgramFiles: "C:\\Program Files" }, [bin]))).toBe(bin);
  });

  it("never picks WSL's System32 bash", () => {
    expect(findGitBash(gitBashEnv({}, ["C:\\Windows\\System32\\bash.exe"], "C:\\Windows\\System32\\bash.exe"))).toBeUndefined();
  });
});

describe("resolveShell", () => {
  const bin = `${GIT}\\bin\\bash.exe`;
  it("auto on Windows follows the shell tuiboard was started from", () => {
    expect(resolveShell("auto", gitBashEnv({ MSYSTEM: "MINGW64", EXEPATH: GIT }, [bin]))).toEqual({ kind: "bash", path: bin });
    expect(resolveShell("auto", env({ NU_VERSION: "0.99" }, "win32", ["nu"]))).toEqual({ kind: "nu", path: "nu" });
    expect(resolveShell("auto", env({}, "win32", ["pwsh"]))).toEqual({ kind: "pwsh", path: "pwsh" });
    expect(resolveShell("auto", env({}, "win32"))).toEqual({ kind: "powershell", path: "powershell" });
  });

  it("auto on Windows falls back to PowerShell when Git Bash can't be found", () => {
    expect(resolveShell("auto", gitBashEnv({ MSYSTEM: "MINGW64" }, []))).toEqual({ kind: "powershell", path: "powershell" });
  });

  it("auto elsewhere hands over to $SHELL; forced shells are used as named", () => {
    expect(resolveShell("auto", env({ SHELL: "/bin/zsh" }))).toEqual({ kind: "posix-default" });
    expect(resolveShell("fish", env({}))).toEqual({ kind: "fish", path: "fish" });
    expect(resolveShell("bash", gitBashEnv({ EXEPATH: GIT }, [bin]))).toEqual({ kind: "bash", path: bin });
  });
});

describe("shellArgv", () => {
  const r = "opencode --session s";
  it("keeps every shell open after the agent exits", () => {
    expect(shellArgv({ kind: "posix-default" }, r)).toEqual(["sh", "-c", 'opencode --session s; exec "${SHELL:-sh}"']);
    expect(shellArgv({ kind: "bash", path: "b.exe" }, r)).toEqual(["b.exe", "-l", "-i", "-c", "opencode --session s; exec bash -l -i"]);
    expect(shellArgv({ kind: "fish", path: "fish" }, r)).toEqual(["fish", "-l", "-i", "-c", "opencode --session s; exec fish -l -i"]);
    expect(shellArgv({ kind: "nu", path: "nu" }, r)).toEqual(["nu", "-e", r]);
    expect(shellArgv({ kind: "pwsh", path: "pwsh" }, r)).toEqual(["pwsh", "-NoExit", "-Command", r]);
    expect(shellArgv({ kind: "cmd", path: "cmd" }, r)).toEqual(["cmd", "/k", r]);
  });
});

describe("planLaunch with shells", () => {
  it("Windows Terminal + Git Bash: backslash cwd, escaped `;`, login bash that stays open", () => {
    const bin = `${GIT}\\bin\\bash.exe`;
    const le = gitBashEnv({ WT_SESSION: "g", MSYSTEM: "MINGW64", EXEPATH: GIT }, [bin]);
    const [step] = planLaunch("windows-terminal", { cwd: "C:/Users/n/Vault", resume: "opencode --session s" }, le);
    expect(decoded(step!)).toContain(
      `-ArgumentList '-w 0 new-tab -d C:\\Users\\n\\Vault "C:\\Program Files\\Git\\bin\\bash.exe" -l -i -c "opencode --session s\\; exec bash -l -i"'`,
    );
  });

  it("forced shell on Linux Ghostty", () => {
    const [step] = planLaunch("ghostty", { ...target, shell: "nu" }, env({ TERM_PROGRAM: "ghostty" }, "linux", ["nu"]));
    expect(step!.args).toEqual(["--working-directory=/home/u/my app", "-e", "nu", "-e", "codex resume 0199-abc"]);
  });

  it("describePlan decodes PowerShell and quotes spaced args", () => {
    const [wt] = planLaunch("windows-terminal", target, env({ WT_SESSION: "g" }, "win32"));
    expect(describePlan([wt!])).toContain("-EncodedCommand ⟨try { Start-Process -FilePath 'wt.exe'");
    expect(describePlan(planLaunch("tmux", target, env({ TMUX: "x" })))).toContain('-c "/home/u/my app"');
  });
});

describe("winQuoteArg", () => {
  it("follows CommandLineToArgvW quoting", () => {
    expect(winQuoteArg("plain")).toBe("plain");
    expect(winQuoteArg("")).toBe('""');
    expect(winQuoteArg("my app")).toBe('"my app"');
    expect(winQuoteArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(winQuoteArg("C:\\dir with space\\")).toBe('"C:\\dir with space\\\\"');
  });
});

describe("windowsStart (real Start-Process)", () => {
  it.skipIf(process.platform !== "win32")(
    "launches a program with spaces and quotes in its arguments",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "tb start it's "));
      const out = join(dir, "out file.txt");
      try {
        // The script has spaces, single quotes (doubled for PowerShell) and
        // double quotes (escaped for the command line) — all must survive.
        const script = `Set-Content -LiteralPath '${out.replaceAll("'", "''")}' -Value "ok"`;
        await runLaunchPlan([
          windowsStart("powershell.exe", ["-NoProfile", "-Command", script], process.env),
        ]);
        const start = Date.now();
        while (!existsSync(out) && Date.now() - start < 20_000) await Bun.sleep(200);
        expect(readFileSync(out, "utf8").trim()).toBe("ok");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.skipIf(process.platform !== "win32")("reports a program that doesn't exist", async () => {
    await expect(
      runLaunchPlan([windowsStart("tuiboard-no-such-program.exe", [], process.env)]),
    ).rejects.toThrow();
  }, 30_000);
});

describe("runLaunchPlan", () => {
  it.skipIf(process.platform === "win32")("threads a captured id into later steps", async () => {
    await runLaunchPlan([
      { cmd: "sh", args: ["-c", "echo pane-7"], captureId: (o) => o.trim() },
      { cmd: "sh", args: ["-c", 'test "$1" = pane-7', "_", "{id}"] },
    ]);
  });

  it.skipIf(process.platform === "win32")("fails with the step's stderr", async () => {
    await expect(
      runLaunchPlan([{ cmd: "sh", args: ["-c", "echo nope >&2; exit 3"] }]),
    ).rejects.toThrow("sh: nope");
  });

  it.skipIf(process.platform === "win32")("rolls back earlier steps and unwraps JSON errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-undo-"));
    const marker = join(dir, "undone");
    try {
      await expect(
        runLaunchPlan([
          { cmd: "sh", args: ["-c", "echo tab-1"], captureId: (o) => o.trim(), undo: { cmd: "sh", args: ["-c", `echo "$1" > '${marker}'`, "_", "{id}"] } },
          { cmd: "sh", args: ["-c", `echo '{"error":{"message":"agent name is invalid"}}' >&2; exit 1`] },
        ]),
      ).rejects.toThrow("sh: agent name is invalid");
      expect(readFileSync(marker, "utf8").trim()).toBe("tab-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a command doesn't exist", async () => {
    await expect(
      runLaunchPlan([{ cmd: "tuiboard-no-such-terminal", args: [] }]),
    ).rejects.toThrow("tuiboard-no-such-terminal");
  });
});
