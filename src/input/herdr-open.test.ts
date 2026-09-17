import { describe, expect, it } from "bun:test";

import type { AgentSession } from "~/store/agents";
import type { HerdrSnapshot } from "~/store/herdr";
import { chooseWorkspace, herdrAgentName, planHerdrFocus, planHerdrResume } from "./herdr-open";

const snap = (overrides: Partial<HerdrSnapshot> = {}): HerdrSnapshot => ({
  panes: [
    { paneId: "w1:p1", tabId: "w1:t1", workspaceId: "w1", status: "idle", cwd: "/home/u/nazzaverse" },
    { paneId: "w2:p1", tabId: "w2:t1", workspaceId: "w2", status: "idle", cwd: "/home/u/blits/monorepo" },
  ],
  focusedWorkspaceId: "w1",
  tabs: new Map(),
  workspaces: new Map([
    ["w1", { label: "nazzaverse", number: 1 }],
    ["w2", { label: "blits", number: 2 }],
    ["w3", { label: "Tuiboard", number: 3 }],
  ]),
  ...overrides,
});

const session = (fields: Partial<AgentSession> = {}): AgentSession => ({
  provider: "codex",
  sessionId: "0199-abc",
  sourcePath: "/x",
  cwd: "/home/u/blits/monorepo",
  cwdShort: "…",
  status: "dormant",
  lastActivityMs: 0,
  displayName: "Fix the flaky test\nwith more detail",
  messageCount: 0,
  toolCount: 0,
  resumeCommand: "codex resume 0199-abc",
  resumeArgv: ["codex", "resume", "0199-abc"],
  ...fields,
});

describe("chooseWorkspace", () => {
  it("prefers the workspace already holding a pane in that directory", () => {
    expect(chooseWorkspace(snap(), "/home/u/blits/monorepo/")).toEqual({
      kind: "existing", workspaceId: "w2", label: "blits", why: "cwd",
    });
  });

  it("then a workspace named like the folder (case-insensitive, Windows paths too)", () => {
    expect(chooseWorkspace(snap(), "C:\\Users\\n\\Repos\\tuiboard")).toEqual({
      kind: "existing", workspaceId: "w3", label: "Tuiboard", why: "name",
    });
  });

  it("then the focused workspace", () => {
    expect(chooseWorkspace(snap(), "/tmp/elsewhere")).toEqual({
      kind: "existing", workspaceId: "w1", label: "nazzaverse", why: "focused",
    });
  });

  it("creates one named after the folder when herdr has none", () => {
    expect(chooseWorkspace(snap({ panes: [], workspaces: new Map(), focusedWorkspaceId: undefined }), "/home/u/app")).toEqual({
      kind: "new", label: "app",
    });
  });
});

describe("herdrAgentName", () => {
  it("builds a valid herdr agent name (lowercase letter first, [a-z0-9_-], ≤ 32)", () => {
    const valid = /^[a-z][a-z0-9_-]{0,31}$/;
    for (const [title, id] of [
      ["Pong reply instruction", "ses_f50fe0756ffeyFSublQR0GvcwM"],
      ["42 things: ÀÉ café!", "0199a8f2-1c2d-7e3f-8a4b-5c6d7e8f9a0b"],
      ["", "x"],
      ["!!!", "ABC"],
    ] as const) {
      expect(herdrAgentName(title, id, "codex")).toMatch(valid);
    }
    expect(herdrAgentName("Pong reply instruction", "ses_f50fe0756ffeyFSublQR0GvcwM", "opencode")).toBe("pong-reply-instruction-0gvcwm");
    expect(herdrAgentName("", "abc", "pi")).toBe("pi-abc");
  });
});

describe("planHerdrFocus", () => {
  it("focuses the linked pane", () => {
    const linked = session({
      herdr: {
        paneId: "w2:p4", tabId: "w2:t4", workspaceId: "w2", workspaceLabel: "blits",
        tabLabel: "x", tabNumber: 4, status: "idle", matchedBy: "id", agent: "codex",
      },
    });
    expect(planHerdrFocus("herdr", linked)).toEqual([{ cmd: "herdr", args: ["agent", "focus", "w2:p4"] }]);
    expect(() => planHerdrFocus("herdr", session())).toThrow();
  });
});

describe("planHerdrResume", () => {
  it("opens a labelled tab in the project's workspace and starts the agent there", () => {
    const { steps, where } = planHerdrResume("/bin/herdr", session(), snap());
    expect(where).toMatchObject({ workspaceId: "w2", why: "cwd" });
    expect(steps[0]!.args).toEqual([
      "tab", "create", "--workspace", "w2", "--cwd", "/home/u/blits/monorepo", "--label", "Fix the flaky test", "--focus",
    ]);
    expect(steps[0]!.captureId!(JSON.stringify({ result: { root_pane: { pane_id: "w2:p9" } } }))).toBe("w2:p9");
    expect(steps[0]!.undo).toEqual({ cmd: "/bin/herdr", args: ["pane", "close", "{id}"] });
    expect(steps[1]).toMatchObject({
      cmd: "/bin/herdr",
      args: ["agent", "start", "fix-the-flaky-test-199abc", "--kind", "codex", "--pane", "{id}", "--timeout", "30000", "--", "resume", "0199-abc"],
      timeoutMs: 40_000,
    });
  });

  it("uses herdr's agent names and each agent's own resume args", () => {
    const cc = session({ provider: "claude-code", resumeArgv: ["claude", "--resume", "u"] });
    expect(planHerdrResume("h", cc, snap()).steps[1]!.args).toEqual(
      expect.arrayContaining(["--kind", "claude", "--", "--resume", "u"]),
    );
  });

  it("creates a workspace when herdr has none, and shortens long titles", () => {
    const { steps } = planHerdrResume(
      "h",
      session({ displayName: "A very long session title that keeps going and going", cwd: "/home/u/app" }),
      snap({ panes: [], workspaces: new Map(), focusedWorkspaceId: undefined }),
    );
    expect(steps[0]!.args).toEqual(["workspace", "create", "--cwd", "/home/u/app", "--label", "app", "--focus"]);
    expect(steps[1]!.args[2]).toBe("a-very-long-session-title-199abc");
  });
});
