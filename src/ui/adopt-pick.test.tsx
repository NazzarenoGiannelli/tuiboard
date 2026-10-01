/**
 * The "Use files I already have" pick list with a long list of candidates.
 *
 * A vault folder can hold dozens of board-like files. The list used to render
 * every one, each wrapping onto two or three rows, so it grew taller than the
 * dialog and the renderer drew rows on top of each other. It is now one row per
 * candidate, in a window that follows the cursor and fits the terminal.
 *
 * The harness reproduces the app's vertical budget (one row of padding, the top
 * bar, a spacer, the bottom bar: 20 rows inside a 24-row terminal), so a list
 * that is too tall shows up here as it does on a screen.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";
import { ModalLayer } from "~/ui/Modal";
import { T } from "~/ui/glyphs";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
let dir: string;
let board: string;
const prevColumns = process.stdout.columns;
const ENV_KEYS = ["HOME", "USERPROFILE", "XDG_DATA_HOME", "TUIBOARD_CONFIG"] as const;
const prevEnv: Record<string, string | undefined> = {};
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-adopt-"));
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.XDG_DATA_HOME = dir;
  process.env.TUIBOARD_CONFIG = join(dir, "config.yaml");
  prevCwd = process.cwd();
  // loadConfig's zero-config fallback scans the cwd: keep it in the temp dir.
  process.chdir(dir);
  board = join(dir, "vault");
  mkdirSync(board);
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  process.chdir(prevCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

const LONG = "a long descriptive name that a vault board file might have";

/** `Board 00`, `Board 01`...; every fourth one carries a long suffix. */
function nameOf(i: number): string {
  const nn = String(i).padStart(2, "0");
  return i % 4 === 0 ? `Board ${nn} - ${LONG}` : `Board ${nn}`;
}

function makeBoards(count: number): void {
  for (let i = 0; i < count; i++) writeFileSync(join(board, nameOf(i) + ".md"), "## Todo\n- [ ] one\n- [ ] two\n");
}

async function pick(count: number, width: number, height = 24) {
  makeBoards(count);
  const store = createTuiStore({
    config: {
      root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
    } as any,
  });
  process.stdout.columns = width;
  if (width < 100) store.setNarrow(true);
  store.openBoardNew(true);
  store.boardNewChooseMode("adopt");
  store.boardNewSubmitText(board);
  expect(store.state.ui.boardNew?.step).toBe("pick");

  // The app's vertical budget around a dialog: padding, top bar, spacer, [dialog], bottom bar.
  const t = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: "100%", height: "100%", paddingTop: 1, paddingLeft: 1, paddingRight: 1 }}>
        <box style={{ height: 1 }}><text>top bar</text></box>
        <box style={{ height: 1 }} />
        <box style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
          <ModalLayer store={store} />
        </box>
        <box style={{ height: 1 }}><text>bottom bar</text></box>
      </box>
    ),
    { width, height },
  );
  renders.push(t as any);
  const settle = async () => { await t.renderOnce(); await t.renderOnce(); };
  await settle();
  const frame = () => {
    const lines = t.captureCharFrame().split("\n");
    if (process.env.DUMP) process.stderr.write(lines.join("\n") + "\n=====\n");
    return lines;
  };
  const press = async (name: string, times = 1) => {
    for (let n = 0; n < times; n++) handleKey(store, { name } as any, 0);
    await settle();
  };
  return { store, t, frame, press, settle };
}

/** Candidate rows in a frame, by the number each shows. A row that shows two names counts twice. */
function candidateRows(lines: string[]): Array<{ n: number; line: string }> {
  const out: Array<{ n: number; line: string }> = [];
  for (const line of lines) {
    for (const h of line.match(/Board \d\d/g) ?? []) out.push({ n: Number(h.slice(6)), line });
  }
  return out;
}

function expectIntegrity(lines: string[], width: number): void {
  const rows = candidateRows(lines);
  // One candidate per row: no row carries two names.
  expect(new Set(rows.map((r) => r.line)).size).toBe(rows.length);
  // Strictly ascending, no repeats: a window, not a smear.
  const nums = rows.map((r) => r.n);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  expect(new Set(nums).size).toBe(nums.length);
  expect(nums.length).toBeGreaterThanOrEqual(3);
  // Nothing past the terminal's edge.
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(width);
  // The dialog is closed at the bottom and the hint is there.
  const flat = lines.join("\n");
  expect(flat).toContain("Space tick");
  expect(flat).toContain("╰");
  // Every dialog row between the top and bottom border ends with the right border.
  const top = lines.findIndex((l) => l.includes("╭"));
  const bottom = lines.findIndex((l) => l.includes("╰"));
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeGreaterThan(top);
  for (let i = top + 1; i < bottom; i++) expect(lines[i]!.trimEnd().endsWith("│")).toBe(true);
}

describe("the adopt pick list with 38 candidates", () => {
  for (const width of [80, 40]) {
    it(`at ${width}x24 every row is one candidate and the window follows the cursor down and back up`, async () => {
      const { frame, press } = await pick(38, width);

      let lines = frame();
      expectIntegrity(lines, width);
      let nums = candidateRows(lines).map((r) => r.n);
      expect(nums[0]).toBe(0);
      expect(lines.join("\n")).toContain("more below");
      expect(lines.join("\n")).not.toContain("more above");

      await press("j", 37);
      lines = frame();
      expectIntegrity(lines, width);
      nums = candidateRows(lines).map((r) => r.n);
      expect(nums[nums.length - 1]).toBe(37);
      expect(lines.join("\n")).toContain("more above");
      expect(lines.join("\n")).not.toContain("more below");
      // The cursor sits on the last row of the window.
      expect(candidateRows(lines).find((r) => r.n === 37)!.line).toContain("▶");

      await press("k", 37);
      lines = frame();
      expectIntegrity(lines, width);
      nums = candidateRows(lines).map((r) => r.n);
      expect(nums[0]).toBe(0);
      expect(lines.join("\n")).toContain("more below");
      expect(lines.join("\n")).not.toContain("more above");
    });
  }

  it("keeps the header on one row", async () => {
    const { frame } = await pick(38, 40);
    expect(frame().filter((l) => l.includes("board file(s)"))).toHaveLength(1);
  });

  it("a short list shows every candidate and no markers", async () => {
    const { frame } = await pick(3, 80);
    const lines = frame();
    expect(candidateRows(lines).map((r) => r.n)).toEqual([0, 1, 2]);
    expect(lines.join("\n")).not.toContain("more above");
    expect(lines.join("\n")).not.toContain("more below");
  });

  it("a long name is cut to its row with an ellipsis, the task count stays", async () => {
    const { frame } = await pick(8, 40);
    const row0 = frame().find((l) => l.includes("Board 00"))!;
    expect(row0).toContain("…");
    expect(row0).toMatch(/2 tasks/);
  });

  it("adopts exactly the candidates ticked, one of them below the first window", async () => {
    const { store, frame, press } = await pick(38, 80);
    await press("space"); // Board 00
    await press("j", 30);
    await press("space"); // Board 30, deep past the first window
    await press("j", 7);
    expect(store.state.ui.boardNew?.ticked).toEqual([0, 30]);
    // The tick is drawn on its row while that row is in view.
    await press("k", 7);
    expect(frame().find((l) => l.includes("Board 30"))!).toContain("✓");

    handleKey(store, { name: "enter" } as any, 0);
    const cfg = readFileSync(join(dir, "config.yaml"), "utf-8");
    expect(cfg).toContain("Board 00 - ");
    expect(cfg).toContain("Board 30.md");
    expect((cfg.match(/path:/g) ?? []).length).toBe(2);
  });
});

describe("resizing while the pick list is open", () => {
  it("re-cuts the header and the rows when the width shrinks from 80 to 40", async () => {
    const { t, frame, press, settle } = await pick(38, 80);
    await press("j", 5);
    t.resize(40, 24);
    await settle();
    const lines = frame();
    expectIntegrity(lines, 40);
    // The long names were whole-ish at 80 columns and are cut to the new row now.
    expect(lines.find((l) => l.includes("Board 04"))!).toContain("…");
    expect(lines.filter((l) => l.includes("board file(s)"))).toHaveLength(1);
  });

  it("recomputes the window when only the height changes", async () => {
    const { t, frame, press, settle } = await pick(38, 80, 24);
    await press("j", 20);
    const tall = candidateRows(frame()).length;
    t.resize(80, 14);
    await settle();
    const lines = frame();
    expectIntegrity(lines, 80);
    const nums = candidateRows(lines).map((r) => r.n);
    expect(nums).toContain(20);
    expect(nums.length).toBeLessThan(tall);
  });
});

// A span's colour is an RGBA whose buffer holds the four channels as 0-255.
const hexOf = (c: { buffer: ArrayLike<number> }) =>
  "#" + Array.from(c.buffer).slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

describe("the cursor is the only accent row", () => {
  it("in the first two steps too: the mode and examples lists leave no visited row blue", async () => {
    const store = createTuiStore({
      config: {
        root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
        resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
        zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
      } as any,
    });
    process.stdout.columns = 80;
    store.setNarrow(true);
    store.openBoardNew(true);
    const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width: 80, height: 24 });
    renders.push(t as any);
    const accentOf = (label: RegExp) => {
      for (const line of t.captureSpans().lines) {
        const sp = line.spans.find((x) => label.test(x.text));
        if (sp) return hexOf(sp.fg as any) === (T.accent as string).toLowerCase();
      }
      throw new Error("row not found: " + label);
    };
    const settle = async () => { await t.renderOnce(); await t.renderOnce(); };
    await settle();
    expect(accentOf(/Create a new board/)).toBe(true);
    expect(accentOf(/Use files I already have/)).toBe(false);
    store.boardNewMove(1); await settle();
    expect(accentOf(/Create a new board/)).toBe(false);
    expect(accentOf(/Use files I already have/)).toBe(true);
    store.boardNewMove(-1); await settle();
    expect(accentOf(/Create a new board/)).toBe(true);
    expect(accentOf(/Use files I already have/)).toBe(false);

    store.boardNewChooseMode("create");
    store.boardNewSubmitText("Work");
    store.boardNewSubmitText("");
    expect(store.state.ui.boardNew?.step).toBe("examples");
    await settle();
    expect(accentOf(/Yes/)).toBe(true);
    store.boardNewMove(1); await settle();
    expect(accentOf(/Yes/)).toBe(false);
    expect(accentOf(/No/)).toBe(true);
  });

  it("moving the cursor leaves exactly one candidate row in the accent colour", async () => {
    const { t, press } = await pick(38, 80);
    const accent = (T.accent as string).toLowerCase();
    const hex = hexOf;
    const accentRows = () => {
      const rows: string[] = [];
      for (const line of t.captureSpans().lines) {
        const text = line.spans.map((s) => s.text).join("");
        if (!/Board \d\d/.test(text)) continue;
        const name = line.spans.find((s) => /Board \d\d/.test(s.text));
        if (name && hex(name.fg as any) === accent) rows.push(text);
      }
      return rows;
    };
    expect(accentRows()).toHaveLength(1);
    for (const [name, times] of [["j", 1], ["j", 5], ["k", 2], ["j", 20], ["k", 25]] as const) {
      await press(name, times);
      expect(accentRows()).toHaveLength(1);
    }
  });
});
