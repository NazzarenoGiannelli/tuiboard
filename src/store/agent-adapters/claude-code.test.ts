import { describe, expect, it } from "bun:test";
import {
  classifyStatus,
  createTranscriptReader,
  cwdFromSlug,
  parseTranscript,
  type LivePidRecord,
} from "./claude-code";

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

  it("returns stale when PID record older than 5min", () => {
    const live: LivePidRecord = { mtimeMs: now - minutes(10), status: "busy" };
    expect(classifyStatus(now, now, live)).toBe("stale");
  });

  it("returns dormant when no PID and jsonl mtime within 7 days", () => {
    expect(classifyStatus(now, now - days(2), undefined)).toBe("dormant");
  });

  it("returns archived when jsonl mtime older than 7 days and no PID", () => {
    expect(classifyStatus(now, now - days(10), undefined)).toBe("archived");
  });
});

describe("parseTranscript", () => {
  const SAMPLE_JSONL = [
    JSON.stringify({ type: "user", message: { role: "user", content: "Ciao" }, gitBranch: "main" }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-5",
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
    expect(result.model).toBe("claude-opus-5");
  });

  it("ignores synthetic assistant models", () => {
    const synthetic = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", model: "<synthetic>", content: [] },
    });
    expect(parseTranscript(SAMPLE_JSONL + "\n" + synthetic).model).toBe("claude-opus-5");
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

describe("createTranscriptReader", () => {
  const user = (text: string) =>
    JSON.stringify({ type: "user", gitBranch: "main", message: { role: "user", content: text } });
  const assistant = (text: string, tools = 0) =>
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text }, ...Array.from({ length: tools }, () => ({ type: "tool_use" }))],
      },
    });
  const A = [user("first è prompt"), assistant("hello", 2)].join("\n") + "\n";
  const B = [user("second"), assistant("bye è", 1)].join("\n") + "\n";

  /** A fake disk that records every byte range that gets read. */
  function fakeDisk(initial: string) {
    let content = Buffer.from(initial, "utf-8");
    const reads: Array<[number, number]> = [];
    return {
      set: (text: string) => (content = Buffer.from(text, "utf-8")),
      size: () => content.length,
      reads,
      io: {
        readRange(_path: string, start: number, end: number) {
          reads.push([start, end]);
          return content.subarray(start, end);
        },
      },
    };
  }

  it("parses a file the same way parseTranscript does", () => {
    const disk = fakeDisk(A + B);
    const reader = createTranscriptReader(disk.io);
    expect(reader.read("t.jsonl", disk.size(), 1)).toEqual(parseTranscript(A + B));
  });

  it("does not read a file that has not changed", () => {
    const disk = fakeDisk(A);
    const reader = createTranscriptReader(disk.io);
    const first = reader.read("t.jsonl", disk.size(), 1);
    expect(reader.read("t.jsonl", disk.size(), 1)).toEqual(first);
    expect(disk.reads).toHaveLength(1);
  });

  it("reads only what was appended", () => {
    const disk = fakeDisk(A);
    const reader = createTranscriptReader(disk.io);
    reader.read("t.jsonl", disk.size(), 1);
    const firstEnd = disk.size();
    disk.set(A + B);
    const after = reader.read("t.jsonl", disk.size(), 2);
    expect(disk.reads[1]).toEqual([firstEnd, disk.size()]);
    expect(after).toEqual(parseTranscript(A + B));
    expect(after.messageCount).toBe(4);
    expect(after.toolCount).toBe(3);
  });

  it("leaves a half-written last line for the next scan", () => {
    const partial = user("cut in half").slice(0, 30);
    const disk = fakeDisk(A + partial);
    const reader = createTranscriptReader(disk.io);
    expect(reader.read("t.jsonl", disk.size(), 1)).toEqual(parseTranscript(A));

    const full = user("cut in half") + "\n";
    disk.set(A + full);
    const done = reader.read("t.jsonl", disk.size(), 2);
    // The second read starts where the last whole line ended, so the half line is read again.
    expect(disk.reads[1]![0]).toBe(Buffer.byteLength(A));
    expect(done).toEqual(parseTranscript(A + full));
  });

  it("starts over when the file gets shorter", () => {
    const disk = fakeDisk(A + B);
    const reader = createTranscriptReader(disk.io);
    reader.read("t.jsonl", disk.size(), 1);
    disk.set(B);
    expect(reader.read("t.jsonl", disk.size(), 2)).toEqual(parseTranscript(B));
  });

  it("gives the same answer whatever the chunk size, multi-byte characters included", () => {
    const whole = parseTranscript(A + B);
    for (const chunk of [1, 3, 7, 64, 100_000]) {
      const disk = fakeDisk(A + B);
      const reader = createTranscriptReader(disk.io, chunk);
      expect(reader.read("t.jsonl", disk.size(), 1)).toEqual(whole);
    }
  });

  it("returns an empty result, and forgets the file, when it cannot be read", () => {
    const reader = createTranscriptReader({
      readRange() {
        throw new Error("EBUSY");
      },
    });
    expect(reader.read("t.jsonl", 10, 1)).toEqual({ messageCount: 0, toolCount: 0 });
    reader.prune(new Set());
  });

  it("prune drops files that are gone, so a new file at the same path starts clean", () => {
    const disk = fakeDisk(A);
    const reader = createTranscriptReader(disk.io);
    reader.read("t.jsonl", disk.size(), 1);
    reader.prune(new Set());
    disk.set(B);
    expect(reader.read("t.jsonl", disk.size(), 2)).toEqual(parseTranscript(B));
  });
});
