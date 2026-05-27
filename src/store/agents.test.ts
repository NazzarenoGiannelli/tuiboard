import { describe, expect, it } from "bun:test";
import {
  classifyStatus,
  cwdFromSlug,
  cwdShort,
  formatAge,
  parseTranscript,
  type LivePidRecord,
} from "./agents";

describe("cwdFromSlug", () => {
  it("decodes a Windows drive-letter slug", () => {
    expect(cwdFromSlug("C--Users-nazza-Documents-Repos-Blits")).toBe(
      "C:\\Users\\nazza\\Documents\\Repos\\Blits",
    );
  });

  it("decodes a POSIX absolute path slug", () => {
    expect(cwdFromSlug("-home-foo-projects-myrepo")).toBe(
      "/home/foo/projects/myrepo",
    );
  });

  it("decodes a macOS user directory slug", () => {
    expect(cwdFromSlug("-Users-foo-code-blits")).toBe("/Users/foo/code/blits");
  });

  it("falls back to host separator for ambiguous bare slugs", () => {
    // No leading dash and no drive letter — host OS picks the separator.
    const sep = process.platform === "win32" ? "\\" : "/";
    expect(cwdFromSlug("workdir-x")).toBe(`workdir${sep}x`);
  });
});

describe("cwdShort", () => {
  it("returns the last 3 parts prefixed with ellipsis when path is long", () => {
    expect(cwdShort("C:\\Users\\nazza\\Documents\\Repos\\Blits")).toBe(
      "…Documents\\Repos\\Blits",
    );
  });

  it("returns the full path when 3 or fewer parts", () => {
    expect(cwdShort("C:\\Users\\nazza")).toBe("C:\\Users\\nazza");
  });
});

describe("classifyStatus", () => {
  const now = 1_700_000_000_000; // fixed instant
  const minutes = (n: number) => n * 60_000;
  const days = (n: number) => n * 86_400_000;

  it("returns live-busy when PID record fresh AND status busy", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("live-busy");
  });

  it("returns live-idle when PID record fresh AND status idle/missing", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(1) };
    expect(classifyStatus(now, now, live)).toBe("live-idle");
  });

  it("returns stale-pid when PID record older than 5min", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(10), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("stale-pid");
  });

  it("returns dormant when no PID and jsonl mtime within 7 days", () => {
    expect(classifyStatus(now, now - days(2), undefined)).toBe("dormant");
  });

  it("returns archived when jsonl mtime older than 7 days and no PID", () => {
    expect(classifyStatus(now, now - days(10), undefined)).toBe("archived");
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000;

  it("formats seconds", () => {
    expect(formatAge(now - 30_000, now)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
  });

  it("formats hours", () => {
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("formats days", () => {
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("returns dash for zero", () => {
    expect(formatAge(0, now)).toBe("—");
  });
});

describe("parseTranscript", () => {
  const SAMPLE_JSONL = [
    JSON.stringify({ type: "user", message: { role: "user", content: "Ciao" }, gitBranch: "main" }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", name: "Read" },
        ],
      },
    }),
    JSON.stringify({ type: "custom-title", customTitle: "Refactor store" }),
  ].join("\n");

  it("extracts title, last messages, counts, branch", () => {
    const result = parseTranscript(SAMPLE_JSONL);
    expect(result.customTitle).toBe("Refactor store");
    expect(result.lastUser).toBe("Ciao");
    expect(result.firstHumanUser).toBe("Ciao");
    expect(result.lastAssistant).toBe("Hello");
    expect(result.messageCount).toBe(2);
    expect(result.toolCount).toBe(1);
    expect(result.gitBranch).toBe("main");
  });

  it("tolerates malformed lines", () => {
    const broken = SAMPLE_JSONL + "\n{this is not json\n";
    const result = parseTranscript(broken);
    expect(result.lastUser).toBe("Ciao"); // still got the good lines
  });

  it("handles empty input", () => {
    const result = parseTranscript("");
    expect(result.messageCount).toBe(0);
    expect(result.customTitle).toBeUndefined();
  });

  it("skips skill-bootstrap and system-tag user messages when picking firstHumanUser", () => {
    const lines = [
      // Synthetic skill loader injected by Claude Code on /morning
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "Base directory for this skill: C:\\Users\\nazza\\.claude\\skills\\morning",
        },
      }),
      // System-injected reminder tag
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "<system-reminder>do the thing</system-reminder>" },
      }),
      // Real human prompt
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Davvero buongiorno, partiamo dal recap di ieri" },
      }),
    ].join("\n");
    const result = parseTranscript(lines);
    expect(result.firstHumanUser).toBe("Davvero buongiorno, partiamo dal recap di ieri");
    // lastUser still tracks the literal last message regardless
    expect(result.lastUser).toBe("Davvero buongiorno, partiamo dal recap di ieri");
  });

  it("returns undefined firstHumanUser when every user message is synthetic", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Base directory for this skill: X" },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "<task-notification>noisy</task-notification>" },
      }),
    ].join("\n");
    const result = parseTranscript(lines);
    expect(result.firstHumanUser).toBeUndefined();
    expect(result.lastUser).toBe("<task-notification>noisy</task-notification>");
  });
});
