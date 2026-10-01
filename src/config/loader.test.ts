import { describe, expect, test } from "bun:test";

import { normalizeOnOff } from "./loader";

describe("normalizeOnOff (update_check and friends)", () => {
  test("real booleans, as YAML parses on/off/yes/no", () => {
    expect(normalizeOnOff(true, false)).toBe(true);
    expect(normalizeOnOff(false, true)).toBe(false);
  });
  test("the words, in any case", () => {
    expect(normalizeOnOff("off", true)).toBe(false);
    expect(normalizeOnOff("Off", true)).toBe(false);
    expect(normalizeOnOff("no", true)).toBe(false);
    expect(normalizeOnOff("false", true)).toBe(false);
    expect(normalizeOnOff("ON", false)).toBe(true);
    expect(normalizeOnOff("yes", false)).toBe(true);
  });
  test("anything else keeps the default", () => {
    expect(normalizeOnOff(undefined, true)).toBe(true);
    expect(normalizeOnOff("maybe", false)).toBe(false);
    expect(normalizeOnOff(3, true)).toBe(true);
  });
});
