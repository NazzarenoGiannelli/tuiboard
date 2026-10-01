import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import { createTuiStore } from "~/store/index";
import { BottomBar } from "~/ui/Chrome";
import { ModalLayer } from "~/ui/Modal";

const renders: Array<{ renderer: { destroy: () => void } }> = [];
let dir: string;
let prevXdg: string | undefined;
const prevColumns = process.stdout.columns;
// HOME-like variables the code under test reads at call time. Restored (or unset) afterwards.
const ENV_KEYS = ["HOME", "USERPROFILE", "TUIBOARD_CONFIG"] as const;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-setup-"));
  prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  // A config path that does not exist: findConfigPath never falls through to the real one.
  process.env.TUIBOARD_CONFIG = join(dir, "no-config.yaml");
});
afterEach(() => {
  for (const r of renders.splice(0)) r.renderer.destroy();
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  process.stdout.columns = prevColumns as number;
  rmSync(dir, { recursive: true, force: true });
});

async function setup(width: number, withBoard: boolean, extra: Record<string, unknown> = {}) {
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
      // no `calendars` key at all (unless `extra` brings one): the dialog must read that without throwing
      ...extra,
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

  it("puts the Updates heading after the calendars and before its status row", async () => {
    const flat = flatten(await setup(100, true));
    const lastCalendar = flat.lastIndexOf("setup microsoft");
    const heading = flat.indexOf("Updates");
    const status = flat.indexOf("Update notice");
    expect(lastCalendar).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(lastCalendar);
    expect(status).toBeGreaterThan(heading);
  });

  it("with the agents zone off, never says a tool has 0 sessions", async () => {
    // zones.agents is "off" in setup(): the session list is empty by construction, not by use.
    for (const width of [100, 40]) {
      const flat = flatten(await setup(width, true));
      expect(flat).not.toMatch(/\d+ sessions?/);
      expect(flat).toContain("Claude Code");
    }
  });

  it("opens without throwing with no config, a broken calendar token path and whatever agent folders exist", async () => {
    const frame = await setup(100, false, {
      calendars: { google: { token: join(dir, "nonexistent", "token.json") } },
    });
    const flat = flatten(frame);
    expect(flat).toContain("Setup");
    expect(flat).toContain("none yet");
    expect(flat).toContain("tuiboard calendar-setup google");
  });

  it("right after the wizard creates a board it is listed, not 'none yet'", async () => {
    writeFileSync(join(dir, "no-config.yaml"), "boards: []\n");
    const store = createTuiStore({
      config: {
        root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
        resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
        zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
      } as any,
    });
    store.openBoardNew(true);
    store.boardNewChooseMode("create");
    store.boardNewSubmitText("Work");
    store.boardNewSubmitText("");
    store.boardNewAnswerExamples(true);
    store.openModal({ kind: "setup" });
    process.stdout.columns = 100;
    const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><ModalLayer store={store} /></box>, { width: 100, height: 40 });
    renders.push(t as any);
    await t.renderOnce(); await t.renderOnce();
    const flat = flatten(t.captureCharFrame());
    expect(flat).toContain("Setup");
    expect(flat).not.toContain("none yet");
    expect(flat).toContain("Work");
    await store.dispose();
  });

  it("the bottom bar shows the open dialog's own keys: Esc close for Setup, Enter alone for the first-run welcome", async () => {
    const make = () => createTuiStore({
      config: {
        root: dir, loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
        resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
        zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
      } as any,
    });
    process.stdout.columns = 100;
    const barOf = async (store: ReturnType<typeof make>) => {
      const t = await testRender(() => <box style={{ width: "100%", height: "100%" }}><BottomBar store={store} /></box>, { width: 100, height: 6 });
      renders.push(t as any);
      await t.renderOnce(); await t.renderOnce();
      return t.captureCharFrame();
    };
    const welcome = make();
    welcome.openBoardNew(true); // no boards: the mandatory welcome
    const welcomeBar = await barOf(welcome);
    expect(welcomeBar).toContain("Enter confirm");
    expect(welcomeBar).not.toContain("Esc");
    const info = make();
    info.openModal({ kind: "setup" });
    const setupBar = await barOf(info);
    expect(setupBar).toContain("Esc close");
    expect(setupBar).not.toContain("Enter confirm");
    await welcome.dispose();
    await info.dispose();
  });
});
