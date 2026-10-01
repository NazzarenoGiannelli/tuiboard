import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { createTuiStore } from "~/store/index";
import { ModalLayer } from "~/ui/Modal";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
let dir: string;
let prevXdg: string | undefined;
const prevColumns = process.stdout.columns;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-setup-"));
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

async function setup(width: number, withBoard: boolean) {
  const boards: { path: string; name: string }[] = [];
  if (withBoard) {
    mkdirSync(join(dir, "boards"), { recursive: true });
    const p = join(dir, "boards", "Work.md");
    writeFileSync(p, "## Todo\n");
    boards.push({ path: p, name: "Work" });
  }
  const store = createTuiStore({
    config: {
      root: dir, loaded: false, boards, assignees: [], doneColumn: "Done", archiveColumn: "Archive",
      resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
      zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
      // no `calendars` key at all: the dialog must read that without throwing
    } as any,
  });
  process.stdout.columns = width;
  if (width < 60) store.setNarrow(true);
  store.openModal({ kind: "setup" });
  const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width, height: 40 });
  renders.push(t as any);
  await t.renderOnce(); await t.renderOnce();
  const f = t.captureCharFrame();
  if (process.env.DUMP) console.log(f.split(String.fromCharCode(10)).filter((l) => l.trim()).join(String.fromCharCode(10)));
  return f;
}

const flatten = (frame: string) => frame.replace(/[│╭╮╰╯─┤├]/g, " ").replace(/\s+/g, " ");

describe("the Setup dialog", () => {
  it("lists boards, agents, calendar and updates, with the calendar remedy", async () => {
    const frame = await setup(100, true);
    const flat = flatten(frame);
    expect(frame).toContain("Setup");
    expect(flat).toContain("Boards");
    expect(flat).toContain("Work");
    expect(flat).toContain("Agents");
    expect(flat).toContain("Calendar");
    expect(flat).toContain("Updates");
    expect(flat).toContain("tuiboard calendar-setup google");
  });

  it("uses a check for a ready item and a circle for a not-set-up one", async () => {
    const frame = await setup(100, true);
    expect(frame).toContain("✓");
    expect(frame).toContain("○");
    const noBoards = await setup(100, false);
    expect(flatten(noBoards)).toContain("none yet");
  });

  it("fits a 40-column pane: the remedy is whole and the right border stays visible", async () => {
    const frame = await setup(40, true);
    const flat = flatten(frame);
    expect(flat).toContain("tuiboard calendar-setup google");
    expect(flat).toContain("tuiboard calendar-setup microsoft");
    const rows = frame.split("\n").filter((l) => l.trim().length > 0);
    for (const line of rows) expect(line.length).toBeLessThanOrEqual(40);
    const textRows = rows.filter((l) => /[A-Za-z]/.test(l.replace(/[┤├]/g, "")));
    // every row carrying text still ends on the dialog's right border
    for (const line of textRows) expect(line.trimEnd().endsWith("│") || line.trimEnd().endsWith("╮")).toBe(true);
  });
});
