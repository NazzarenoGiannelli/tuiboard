import { describe, expect, it } from "bun:test";

import { fitCells, layoutCardDetails, layoutLine } from "./agent-line";

const fields = {
  name: "Review the harness badge layout",
  branch: "feat/agents-harness-badge-23",
  model: "gpt-5.5-codex",
  cwd: "…Repos/Personal/tuiboard",
  age: " 3m",
};

describe("fitCells", () => {
  it("leaves short text alone and cuts long text at the tail", () => {
    expect(fitCells("hello", 10)).toBe("hello");
    expect(fitCells("hello world", 6)).toBe("hello…");
    expect(fitCells("anything", 0)).toBe("");
  });
});

describe("layoutLine", () => {
  it("shows every field when the row is wide", () => {
    expect(layoutLine(fields, 140)).toEqual({
      name: fields.name,
      branch: fields.branch,
      model: fields.model,
      right: "…Repos/Personal/tuiboard   3m",
    });
  });

  it("keeps the model when only the long branch doesn't fit", () => {
    const modelOnly = layoutLine(fields, 42 + 31 + 15 + 2);
    expect(modelOnly).toMatchObject({ branch: undefined, model: fields.model });
  });

  it("drops the model first, then the branch", () => {
    // 11 cells of fixed chrome + right (29) + gap (2) = 42; name 31.
    const noModel = layoutLine(fields, 42 + 31 + 30 + 2);
    expect(noModel.model).toBeUndefined();
    expect(noModel.branch).toBe(fields.branch);
    const nameOnly = layoutLine(fields, 42 + 31 + 5);
    expect(nameOnly).toMatchObject({ name: fields.name, branch: undefined, model: undefined });
  });

  it("gives up the cwd before squeezing the name below its minimum", () => {
    const narrow = layoutLine(fields, 40);
    expect(narrow.right).toBe(" 3m");
    // 40 − 11 chrome − 3 age − 2 gap = 24 cells for the name.
    expect(narrow.name).toBe("Review the harness badg…");
  });

  it("passes everything through before the row is measured", () => {
    expect(layoutLine(fields, undefined).model).toBe(fields.model);
  });
});

describe("layoutCardDetails", () => {
  it("joins present parts and cuts at the tail", () => {
    expect(layoutCardDetails(["opus-5", undefined, "~/x"], 100)).toBe("opus-5  ·  ~/x");
    expect(layoutCardDetails(["opus-5", "main", "~/a/very/long/path"], 11 + 14)).toBe(
      "opus-5  ·  ma…",
    );
  });
});
