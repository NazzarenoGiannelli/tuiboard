import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  OMP_STALE_AFTER_MS,
  classifyOmpStatus,
  createOmpAdapter,
  defaultOmpSessionsDir,
  parseOmpSession,
} from "./omp";

// omp session IDs are 16-char hex strings (not UUIDs like Pi).
const SESSION_ID = "1f9d2a6b9c0d1234";

let n = 0;
const header = (extra: object = {}) =>
  JSON.stringify({
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-09-17T10:00:00.000Z",
    cwd: "/home/u/app",
    title: "",
    titleSource: "auto",
    ...extra,
  });
const entry = (type: string, fields: object) =>
  JSON.stringify({ type, id: (n++).toString(16).padStart(8, "0"), parentId: null, timestamp: "2026-09-17T10:00:01.000Z", ...fields });
const user = (content: unknown) => entry("message", { message: { role: "user", content, timestamp: 1 } });
const assistant = (content: unknown[], stopReason: string, model = "anthropic/claude-sonnet-4.5") =>
  entry("message", { message: { role: "assistant", content, api: "openai-completions", provider: "openrouter", model, usage: {}, stopReason, timestamp: 2 } });
const toolResult = entry("message", {
  message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
});
const toolCall = { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } };
const sessionExit = JSON.stringify({
  type: "custom",
  customType: "session_exit",
  data: { reason: "user exit", kind: "normal", recordedAt: "2026-09-17T10:10:00.000Z" },
});

/** 256-byte title slot: JSON padded to 255 chars + newline. */
function makeTitleSlot(title: string, titleSource = "auto"): string {
  const json = JSON.stringify({ type: "title", title, titleSource });
  return json.padEnd(255, " ") + "\n";
}

const FINISHED = [
  header(),
  user("fix the flaky test"),
  assistant([{ type: "thinking", thinking: "…" }, toolCall], "toolUse"),
  toolResult,
  assistant([{ type: "text", text: "Fixed." }], "stop"),
].join("\n");

describe("parseOmpSession", () => {
  it("reads header, prompt, reply, model, tools and a finished turn", () => {
    expect(parseOmpSession(FINISHED)).toMatchObject({
      sessionId: SESSION_ID,
      cwd: "/home/u/app",
      firstUser: "fix the flaky test",
      lastUser: "fix the flaky test",
      lastAssistant: "Fixed.",
      model: "anthropic/claude-sonnet-4.5",
      messageCount: 3,
      toolCount: 1,
      turnOpen: false,
      exited: false,
    });
  });

  it("reads session name from the 256-byte title slot (new format)", () => {
    const slot = makeTitleSlot("My omp session");
    const r = parseOmpSession(slot + header({ title: "" }) + "\n" + user("hello"));
    expect(r.name).toBe("My omp session");
  });

  it("reads session name from header.title (legacy format — no slot)", () => {
    const r = parseOmpSession([header({ title: "Legacy session" }), user("hello")].join("\n"));
    expect(r.name).toBe("Legacy session");
  });

  it("header.title wins over the title slot", () => {
    const slot = makeTitleSlot("Slot name");
    const r = parseOmpSession(slot + header({ title: "Header name" }) + "\n" + user("hello"));
    expect(r.name).toBe("Header name");
  });

  it("model_change with role=smol does not override the session model", () => {
    const changeDefault = entry("model_change", { model: "anthropic/claude-opus-5", role: "default" });
    const changeSmol = entry("model_change", { model: "anthropic/claude-haiku-4-5", role: "smol" });
    const r = parseOmpSession(
      [header(), user("go"), assistant([], "stop", "anthropic/claude-opus-5"), changeDefault, changeSmol].join("\n"),
    );
    expect(r.model).toBe("anthropic/claude-opus-5");
  });

  it("model_change with no role updates the session model", () => {
    const change = entry("model_change", { model: "gpt-5" });
    const r = parseOmpSession([header(), user("go"), change].join("\n"));
    expect(r.model).toBe("gpt-5");
  });

  it("trailing session_exit gives dormant even when the tail is a toolResult", () => {
    const content = [header(), user("go"), assistant([toolCall], "toolUse"), toolResult, sessionExit].join("\n");
    const r = parseOmpSession(content);
    expect(r.exited).toBe(true);
    expect(r.turnOpen).toBe(false);
  });

  it("tolerates malformed lines and empty input", () => {
    expect(parseOmpSession(FINISHED + "\n{nope").lastAssistant).toBe("Fixed.");
    expect(parseOmpSession("")).toEqual({ messageCount: 0, toolCount: 0, turnOpen: false, exited: false });
  });
});

describe("classifyOmpStatus", () => {
  const now = 1_700_000_000_000;
  it("maps exited + turn state and age correctly", () => {
    expect(classifyOmpStatus(now, now, true, false)).toBe("live-busy");
    expect(classifyOmpStatus(now, now - OMP_STALE_AFTER_MS - 1, true, false)).toBe("stale");
    expect(classifyOmpStatus(now, now, false, false)).toBe("dormant");
    expect(classifyOmpStatus(now, now, true, true)).toBe("dormant");
    expect(classifyOmpStatus(now, now - 8 * 86_400_000, true, false)).toBe("archived");
  });
});

describe("defaultOmpSessionsDir", () => {
  it("uses PI_CONFIG_DIR when set, defaults to .omp", () => {
    const home = homedir();
    expect(defaultOmpSessionsDir({})).toBe(join(home, ".omp", "agent", "sessions"));
    expect(defaultOmpSessionsDir({ PI_CONFIG_DIR: ".myomp" })).toBe(join(home, ".myomp", "agent", "sessions"));
  });

  it("honors PI_CODING_AGENT_SESSION_DIR (shared with Pi)", () => {
    expect(defaultOmpSessionsDir({ PI_CODING_AGENT_SESSION_DIR: "/x/s" })).toBe("/x/s");
  });
});

describe("createOmpAdapter", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tuiboard-omp-"));
    n = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when omp sessions dir does not exist", () => {
    expect(createOmpAdapter(join(root, "missing"), join(root, "pi")).discover(Date.now())).toEqual([]);
  });

  it("returns [] when omp sessions dir equals Pi sessions dir (dedup)", () => {
    const shared = join(root, "shared");
    mkdirSync(shared, { recursive: true });
    expect(createOmpAdapter(shared, shared).discover(Date.now())).toEqual([]);
  });

  it("lists omp sessions from every project folder", () => {
    const sessionsDir = join(root, "omp-sessions");
    const piDir = join(root, "pi-sessions");
    const proj = join(sessionsDir, "-home-u-app-");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, `2026-09-17T10-00-00-000Z_${SESSION_ID}.jsonl`), FINISHED);
    writeFileSync(join(proj, "notes.txt"), "ignored");

    const sessions = createOmpAdapter(sessionsDir, piDir).discover(Date.now());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "omp",
      sessionId: SESSION_ID,
      cwd: "/home/u/app",
      status: "dormant",
      resumeCommand: `omp --resume ${SESSION_ID}`,
      resumeArgv: ["omp", "--resume", SESSION_ID],
    });
  });
});
