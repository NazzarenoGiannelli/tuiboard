import { describe, expect, it } from "bun:test";

import { isMinusKey, isPlusKey } from "./keys";

describe("isPlusKey", () => {
  it("recognises the main-row and the keypad +", () => {
    expect(isPlusKey({ name: "+", sequence: "+" })).toBe(true);
    expect(isPlusKey({ name: "=", sequence: "+", shift: true })).toBe(true);
    expect(isPlusKey({ name: "kpplus", sequence: "\x1b[57413u" })).toBe(true);
    expect(isPlusKey({ name: "kpplus", sequence: "+" })).toBe(true);
  });

  it("leaves = and other keys alone", () => {
    expect(isPlusKey({ name: "=", sequence: "=" })).toBe(false);
    expect(isPlusKey({ name: "kpminus", sequence: "-" })).toBe(false);
  });
});

describe("isMinusKey", () => {
  it("recognises the main-row and the keypad -", () => {
    expect(isMinusKey({ name: "-", sequence: "-" })).toBe(true);
    expect(isMinusKey({ name: "kpminus", sequence: "\x1b[57412u" })).toBe(true);
    expect(isMinusKey({ name: "kpplus", sequence: "+" })).toBe(false);
  });
});
