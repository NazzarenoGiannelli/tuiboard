import { describe, expect, it } from "bun:test";

describe("test runner smoke", () => {
  it("can run a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
