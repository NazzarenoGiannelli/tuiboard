import { describe, expect, it } from "bun:test";

import { handleKey } from "~/input/handleKey";
import { createTuiStore } from "~/store/index";

const store = () => createTuiStore({
  config: {
    root: process.cwd(), loaded: false, boards: [], assignees: [], doneColumn: "Done", archiveColumn: "Archive",
    resumeTerminal: "auto", resumeShell: "auto", statusIndicators: "symbols", copyResumeCommand: "x",
    zones: { planner: "on", agenda: "on", agents: "off" }, updateCheck: true,
  } as any,
});

describe("Shift+S opens Setup, s still schedules", () => {
  it("S opens the setup dialog", () => {
    const s = store();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal?.kind).toBe("setup");
    s.dispose();
  });

  it("Esc and S close it, other keys do nothing", () => {
    const s = store();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    handleKey(s, { name: "j" }, 0);
    expect(s.state.ui.modal?.kind).toBe("setup");
    handleKey(s, { name: "escape" }, 0);
    expect(s.state.ui.modal).toBeUndefined();
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal).toBeUndefined();
    s.dispose();
  });

  it("a capital S typed into another dialog does not open Setup", () => {
    const s = store();
    s.openModal({ kind: "search" } as any);
    handleKey(s, { name: "s", shift: true, sequence: "S" }, 0);
    expect(s.state.ui.modal?.kind).toBe("search");
    s.dispose();
  });
});
