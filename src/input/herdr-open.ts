/**
 * Open agent sessions inside herdr (the `H` key, and Enter for sessions
 * already open there): focus the pane a session lives in, or resume it in a
 * new tab of the workspace that holds its project, started through
 * `herdr agent start` so herdr tracks it as an agent from the first second.
 *
 * Planning is pure; the steps run through `runLaunchPlan`.
 */

import { basename } from "node:path";

import type { LaunchStep } from "~/input/open-session";
import type { AgentSession } from "~/store/agents";
import { HERDR_AGENT, samePath, type HerdrSnapshot } from "~/store/herdr";

/** Focus the herdr pane a session is open in. */
export function planHerdrFocus(bin: string, session: AgentSession): LaunchStep[] {
  if (!session.herdr) throw new Error("session isn't open in herdr");
  return [{ cmd: bin, args: ["agent", "focus", session.herdr.paneId] }];
}

export type WorkspaceChoice =
  | { kind: "existing"; workspaceId: string; label: string; why: "cwd" | "name" | "focused" }
  | { kind: "new"; label: string };

/**
 * Where a session should open: the workspace already holding a pane in its
 * directory, else one named like the directory, else the focused one — or a
 * new workspace named after the directory when herdr has none.
 */
export function chooseWorkspace(snap: HerdrSnapshot, cwd: string): WorkspaceChoice {
  const label = (id: string) => snap.workspaces.get(id)?.label ?? id;
  const byCwd = snap.panes.find((p) => p.workspaceId && samePath(p.cwd, cwd));
  if (byCwd) return { kind: "existing", workspaceId: byCwd.workspaceId, label: label(byCwd.workspaceId), why: "cwd" };
  const folder = basename(cwd.replaceAll("\\", "/")).toLowerCase();
  for (const [id, w] of snap.workspaces) {
    if (folder && w.label.toLowerCase() === folder) return { kind: "existing", workspaceId: id, label: w.label, why: "name" };
  }
  const focused = snap.focusedWorkspaceId ?? [...snap.workspaces.keys()][0];
  if (focused) return { kind: "existing", workspaceId: focused, label: label(focused), why: "focused" };
  return { kind: "new", label: basename(cwd.replaceAll("\\", "/")) || "agents" };
}

/** Pane id from a `tab create` / `workspace create` response. */
function rootPaneId(out: string): string | undefined {
  try {
    const r = JSON.parse(out)?.result;
    return r?.root_pane?.pane_id ?? r?.pane?.pane_id ?? r?.tab?.root_pane?.pane_id;
  } catch {
    return undefined;
  }
}

/** Tab titles: short, single line. */
function tabLabel(name: string): string {
  const line = name.split("\n")[0]!.trim();
  return line.length > 32 ? `${line.slice(0, 31).trimEnd()}…` : line || "agent";
}

/**
 * herdr agent names: lowercase letter first, then `[a-z0-9_-]`, ≤ 32 chars.
 * Title slug + short session id, so two sessions with the same title differ.
 */
export function herdrAgentName(title: string, sessionId: string, fallback: string): string {
  const id = sessionId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-6);
  const slug = title
    .split("\n")[0]!
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 32 - id.length - 1)
    .replace(/-+$/, "");
  return `${slug || fallback}-${id}`.slice(0, 32);
}

/**
 * Resume a session in herdr: new tab (or workspace) in the session's
 * directory, then start the agent there.
 *
 * POSIX: `herdr agent start --kind <agent> -- <resume args>`, so herdr tracks
 * it from the first second. Windows: herdr launches the agent's executable
 * directly, which fails for npm-installed CLIs (codex, opencode, pi are an
 * extensionless sh shim next to `.cmd`/`.ps1` — "not a valid Win32
 * application"), so the resume command is typed into the pane's shell
 * instead (`herdr pane run`), which resolves it through PATHEXT; herdr still
 * detects the agent from the running process.
 */
export function planHerdrResume(
  bin: string,
  session: AgentSession,
  snap: HerdrSnapshot,
  platform: NodeJS.Platform = process.platform,
): { steps: LaunchStep[]; where: WorkspaceChoice } {
  const where = chooseWorkspace(snap, session.cwd);
  const label = tabLabel(session.displayName);
  const create: LaunchStep =
    where.kind === "existing"
      ? {
          cmd: bin,
          args: ["tab", "create", "--workspace", where.workspaceId, "--cwd", session.cwd, "--label", label, "--focus"],
          captureId: rootPaneId,
          undo: { cmd: bin, args: ["pane", "close", "{id}"] },
        }
      : {
          cmd: bin,
          args: ["workspace", "create", "--cwd", session.cwd, "--label", where.label, "--focus"],
          captureId: rootPaneId,
          undo: { cmd: bin, args: ["pane", "close", "{id}"] },
        };
  if (platform === "win32") {
    return {
      steps: [create, { cmd: bin, args: ["pane", "run", "{id}", session.resumeCommand] }],
      where,
    };
  }
  const [, ...agentArgs] = session.resumeArgv;
  const start: LaunchStep = {
    cmd: bin,
    args: [
      "agent", "start", herdrAgentName(session.displayName, session.sessionId, HERDR_AGENT[session.provider]),
      "--kind", HERDR_AGENT[session.provider],
      "--pane", "{id}",
      "--timeout", "30000",
      "--", ...agentArgs,
    ],
    // herdr waits for the agent to be ready (up to the --timeout above).
    timeoutMs: 40_000,
  };
  return { steps: [create, start], where };
}
