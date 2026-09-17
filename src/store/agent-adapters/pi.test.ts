import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PI_STALE_AFTER_MS,
  classifyPiStatus,
  createPiAdapter,
  defaultPiSessionsDir,
  parsePiSession,
} from "./pi";

const UUID = "3f2c9a1e-8b7d-4c6e-9f10-a1b2c3d4e5f6";

// Lines shaped after Pi 0.85's docs/session-format.md examples.
const header = (extra: object = {}) =>
  JSON.stringify({ type: "session", version: 3, id: UUID, timestamp: "2026-09-17T10:00:00.000Z", cwd: "/home/u/app", ...extra });
let n = 0;
const entry = (type: string, fields: object) =>
  JSON.stringify({ type, id: (n++).toString(16).padStart(8, "0"), parentId: null, timestamp: "2026-09-17T10:00:01.000Z", ...fields });
const user = (content: unknown) => entry("message", { message: { role: "user", content, timestamp: 1 } });
const assistant = (content: unknown[], stopReason: string, model = "anthropic/claude-sonnet-4.5") =>
  entry("message", {
    message: { role: "assistant", content, api: "openai-completions", provider: "openrouter", model, usage: {}, stopReason, timestamp: 2 },
  });
const toolResult = entry("message", {
  message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
});
const toolCall = { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } };

const FINISHED = [
  header(),
  user("fix the flaky test"),
  assistant([{ type: "thinking", thinking: "…" }, toolCall], "toolUse"),
  toolResult,
  assistant([{ type: "text", text: "Fixed." }], "stop"),
].join("\n");

describe("parsePiSession", () => {
  it("reads header, prompt, reply, model, tools and a finished turn", () => {
    expect(parsePiSession(FINISHED)).toEqual({
      sessionId: UUID,
      cwd: "/home/u/app",
      firstUser: "fix the flaky test",
      lastUser: "fix the flaky test",
      lastAssistant: "Fixed.",
      model: "anthropic/claude-sonnet-4.5",
      messageCount: 3,
      toolCount: 1,
      turnOpen: false,
    });
  });

  it("keeps the turn open while the model or a tool is still working", () => {
    expect(parsePiSession([header(), user("go")].join("\n")).turnOpen).toBe(true);
    expect(parsePiSession([header(), user("go"), assistant([toolCall], "toolUse")].join("\n")).turnOpen).toBe(true);
    expect(parsePiSession([header(), user("go"), assistant([toolCall], "toolUse"), toolResult].join("\n")).turnOpen).toBe(true);
  });

  it("closes the turn on stop, length, error and aborted", () => {
    for (const reason of ["stop", "length", "error", "aborted"]) {
      expect(parsePiSession([header(), user("go"), assistant([], reason)].join("\n")).turnOpen).toBe(false);
    }
  });

  it("uses the latest session_info name and model_change", () => {
    const r = parsePiSession(
      [
        FINISHED,
        entry("session_info", { name: "First" }),
        entry("session_info", { name: "Refactor auth" }),
        entry("model_change", { provider: "openai", modelId: "gpt-5.5" }),
      ].join("\n"),
    );
    expect(r.name).toBe("Refactor auth");
    expect(r.model).toBe("gpt-5.5");
  });

  it("reads array user content and ignores non-conversation entries", () => {
    const r = parsePiSession(
      [
        header(),
        user([{ type: "text", text: "look at this" }, { type: "image", data: "…", mimeType: "image/png" }]),
        entry("custom", { customType: "ext", data: {} }),
        entry("label", { targetId: "00000000", label: "x" }),
      ].join("\n"),
    );
    expect(r.lastUser).toBe("look at this");
    expect(r.messageCount).toBe(1);
  });

  it("tolerates malformed lines and empty input", () => {
    expect(parsePiSession(FINISHED + "\n{nope").lastAssistant).toBe("Fixed.");
    expect(parsePiSession("")).toEqual({ messageCount: 0, toolCount: 0, turnOpen: false });
  });
});

describe("classifyPiStatus", () => {
  const now = 1_700_000_000_000;
  it("maps turn state and age", () => {
    expect(classifyPiStatus(now, now, true)).toBe("live-busy");
    expect(classifyPiStatus(now, now - PI_STALE_AFTER_MS - 1, true)).toBe("stale");
    expect(classifyPiStatus(now, now, false)).toBe("dormant");
    expect(classifyPiStatus(now, now - 8 * 86_400_000, true)).toBe("archived");
  });
});

describe("defaultPiSessionsDir", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "tuiboard-pi-home-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("honors the session-dir env, settings.json, then the default", () => {
    expect(defaultPiSessionsDir({ PI_CODING_AGENT_SESSION_DIR: "/x/s", PI_CODING_AGENT_DIR: dir })).toBe("/x/s");
    expect(defaultPiSessionsDir({ PI_CODING_AGENT_DIR: dir })).toBe(join(dir, "sessions"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ sessionDir: "store/sessions" }));
    expect(defaultPiSessionsDir({ PI_CODING_AGENT_DIR: dir })).toBe(join(dir, "store", "sessions"));
  });
});

describe("createPiAdapter", () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), "tuiboard-pi-"))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when Pi has no sessions dir", () => {
    expect(createPiAdapter(join(root, "missing")).discover(Date.now())).toEqual([]);
  });

  it("lists sessions from every project folder", () => {
    const proj = join(root, "--home-u-app--");
    mkdirSync(proj);
    writeFileSync(join(proj, `2026-09-17T10-00-00-000Z_${UUID}.jsonl`), FINISHED);
    writeFileSync(join(proj, "notes.txt"), "ignored");
    const other = join(root, "--home-u-other--");
    mkdirSync(other);
    const named = "11111111-2222-4333-8444-555555555555";
    writeFileSync(
      join(other, `2026-09-17T11-00-00-000Z_${named}.jsonl`),
      [header({ id: named, cwd: "/home/u/other" }), user("go"), entry("session_info", { name: "Named one" })].join("\n"),
    );

    const byId = new Map(createPiAdapter(root).discover(Date.now()).map((s) => [s.sessionId, s]));
    expect([...byId.keys()].sort()).toEqual([named, UUID].sort());
    expect(byId.get(UUID)).toMatchObject({
      provider: "pi",
      cwd: "/home/u/app",
      status: "dormant",
      displayName: "fix the flaky test · 3f2c9a1e",
      model: "anthropic/claude-sonnet-4.5",
      messageCount: 3,
      toolCount: 1,
      resumeCommand: `pi --session ${UUID}`,
    });
    expect(byId.get(named)).toMatchObject({ status: "live-busy", customTitle: "Named one", displayName: "Named one" });
  });
});
