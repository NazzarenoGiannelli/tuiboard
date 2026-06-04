import { describe, expect, it } from "bun:test";

import { isoToday, isoTomorrow } from "./index";
import { parseDateShortcut, parseQuickAdd, parseTimeBlockShortcut } from "./parsers";

describe("parseDateShortcut", () => {
  it("maps t / today / oggi to today", () => {
    expect(parseDateShortcut("t")).toBe(isoToday());
    expect(parseDateShortcut("today")).toBe(isoToday());
    expect(parseDateShortcut("oggi")).toBe(isoToday());
  });

  it("maps m to tomorrow (consistent with the board's m key)", () => {
    expect(parseDateShortcut("m")).toBe(isoTomorrow());
  });

  it("keeps tm / tom / tomorrow / domani as tomorrow aliases", () => {
    expect(parseDateShortcut("tm")).toBe(isoTomorrow());
    expect(parseDateShortcut("tom")).toBe(isoTomorrow());
    expect(parseDateShortcut("tomorrow")).toBe(isoTomorrow());
    expect(parseDateShortcut("domani")).toBe(isoTomorrow());
  });

  it("is case-insensitive", () => {
    expect(parseDateShortcut("M")).toBe(isoTomorrow());
    expect(parseDateShortcut("T")).toBe(isoToday());
  });

  it("clears on empty / dash, fails on garbage", () => {
    expect(parseDateShortcut("")).toBeUndefined();
    expect(parseDateShortcut("-")).toBeUndefined();
    expect(parseDateShortcut("zzz")).toBeNull();
  });

  it("parses ISO dates literally", () => {
    expect(parseDateShortcut("2026-06-10")).toBe("2026-06-10");
  });
});

describe("parseQuickAdd date tokens", () => {
  it("treats a standalone m as tomorrow and strips it from the title", () => {
    const r = parseQuickAdd("Pay invoice m");
    expect(r.scheduled).toBe(isoTomorrow());
    expect(r.title).toBe("Pay invoice");
  });

  it("treats a standalone t as today", () => {
    const r = parseQuickAdd("Standup t");
    expect(r.scheduled).toBe(isoToday());
    expect(r.title).toBe("Standup");
  });
});

describe("parseTimeBlockShortcut", () => {
  it("parses loose H-H ranges and HH:MM-HH:MM", () => {
    expect(parseTimeBlockShortcut("9-11")).toEqual({ startMin: 540, endMin: 660 });
    expect(parseTimeBlockShortcut("09:30-10:45")).toEqual({ startMin: 570, endMin: 645 });
  });

  it("clears on empty / dash", () => {
    expect(parseTimeBlockShortcut("")).toBeUndefined();
    expect(parseTimeBlockShortcut("-")).toBeUndefined();
  });
});
