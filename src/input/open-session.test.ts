import { describe, expect, it } from "bun:test";

import {
  detectLauncher,
  planLaunch,
  runLaunchPlan,
  type LaunchEnv,
} from "./open-session";

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

  it("windows terminal: new tab in the current window, pwsh when available", () => {
    const w = { cwd: "C:\\Users\\n\\my app", resume: "claude --resume a;b" };
    const [step] = planLaunch("windows-terminal", w, env({ WT_SESSION: "g" }, "win32", ["pwsh"]));
    expect(step).toMatchObject({
      cmd: "wt",
      args: ["-w", "0", "new-tab", "-d", "C:\\Users\\n\\my app", "pwsh", "-NoExit", "-Command", "claude --resume a\\;b"],
      detached: true,
    });
    const [ps] = planLaunch("windows-terminal", w, env({ WT_SESSION: "g" }, "win32"));
    expect(ps!.args[5]).toBe("powershell");
  });

  it("windows console: visible PowerShell window that cds first", () => {
    const [step] = planLaunch("windows-console", { cwd: "C:\\it's", resume: "opencode --session s" }, env({}, "win32"));
    expect(step).toMatchObject({
      cmd: "powershell",
      args: ["-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\it''s'; opencode --session s"],
      detached: true,
      showConsole: true,
    });
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

  it("fails when a command doesn't exist", async () => {
    await expect(
      runLaunchPlan([{ cmd: "tuiboard-no-such-terminal", args: [] }]),
    ).rejects.toThrow("tuiboard-no-such-terminal");
  });
});
