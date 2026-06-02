/**
 * tuiboard — bootstrap.
 *
 * Loads config, builds the reactive store, parses argv, and dispatches
 * to one of four root views:
 *   - undefined → Dashboard (all 4 zones)
 *   - "board"   → BoardOnly  (kanban + planner fullscreen)
 *   - "timeline"→ TimelineOnly
 *   - "agents"  → AgentsOnly
 *
 * The store and keyboard handler are shared across all four; only the
 * root layout component changes.
 */

import { createMemo } from "solid-js";
import { render, useKeyboard } from "@opentui/solid";

import { parseArgs, type ViewKind } from "~/cli/args";
import { loadConfig } from "~/config/loader";
import { handleKey } from "~/input/handleKey";
import {
  createTuiStore,
  type TuiStore,
} from "~/store/index";
import { buildPlannerItems } from "~/store/planner-panel";
import { T } from "~/ui/glyphs";
import { TopBar, BottomBar } from "~/ui/Chrome";
import { ModalLayer } from "~/ui/Modal";
import { BoardOnly } from "~/views/BoardOnly";
import { Dashboard } from "~/views/Dashboard";
import { TimelineOnly } from "~/views/TimelineOnly";
import { AgentsOnly } from "~/views/AgentsOnly";

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const config = loadConfig();
if (config.boards.length === 0) {
  console.error(
    "No boards found. Create `.tuiboard/config.yaml` with a `boards:` list," +
      " or run from a directory containing markdown files with `- [ ]` tasks.",
  );
  process.exit(1);
}

const store = createTuiStore({ config });

if (store.state.boards.length === 0) {
  console.error("All boards failed to load. Check paths in .tuiboard/config.yaml.");
  process.exit(1);
}

process.on("SIGINT", () => {
  store.dispose().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  store.dispose().finally(() => process.exit(0));
});

// ─── Responsive layout ──────────────────────────────────────────────────────
// Auto-hide optional zones when the terminal isn't wide enough to host them
// comfortably. Breakpoints from the design spec (§4.2):
//   ≥ 150 col → all four zones
//   120–149   → hide timeline
//   100–119   → hide agents too
//   < 100     → hide planner too (board is non-hideable)
//
// This only reports what FITS. The store combines it with each zone's enabled
// flag and the user's desired visibility, so F1/F2/F3 toggles persist across
// resizes and a disabled/hidden zone is never force-shown.
function applyResponsiveLayout(): void {
  const width = process.stdout.columns ?? 200;
  // Report which zones FIT at this width. The store ANDs this with each zone's
  // enabled flag and the user's desired visibility, so a disabled or
  // intentionally-hidden zone is never force-shown just because there's room.
  store.applyResponsiveFits({
    planner: width >= 100,
    timeline: width >= 150,
    agents: width >= 120,
  });
}
applyResponsiveLayout();
process.stdout.on("resize", applyResponsiveLayout);

// Land on the Today/Tomorrow panel by default — for a daily-planning tool the
// first question is "what's on my plate today", and that panel answers it. On
// a narrow terminal where the panel auto-hides, fall back to the board.
if (store.state.ui.visibleZones.planner) {
  store.setActiveZone("planner");
}

const { view } = parseArgs(process.argv.slice(2));

// ─── App shell ──────────────────────────────────────────────────────────────

function rootViewFor(v: ViewKind | undefined, s: TuiStore) {
  switch (v) {
    case "board":    return <BoardOnly store={s} />;
    case "timeline": return <TimelineOnly store={s} />;
    case "agents":   return <AgentsOnly store={s} />;
    default:         return <Dashboard store={s} />;
  }
}

function App() {
  const plannerItems = createMemo(() =>
    buildPlannerItems(store.state.boards.map((b) => b.board)),
  );

  useKeyboard((key) => handleKey(store, key, plannerItems().length));

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        // No bottom padding: the keyboard cheat-sheet sits flush on the last
        // row, which gives the board + agenda one extra row of height. Safe
        // thanks to the flexBasis:0 main row — the content just fills the space.
        paddingTop: 1,
        paddingLeft: 1,
        paddingRight: 1,
        paddingBottom: 0,
      }}
    >
      <TopBar store={store} />
      <box style={{ height: 1 }} />
      {/*
        The default Dashboard renders its modal inside the Agenda's slot, so the
        layout stays put when a modal opens. The standalone `--view=` modes have
        no Agenda slot, so they get the modal here as a right-hand panel.
        (`view` is fixed at launch, never reactive.)

        `flexBasis: 0` + `minHeight: 0` are load-bearing: without them the row's
        flex-basis is `auto`, so the Agenda's tall scrollbox inflates the row to
        its content height (1 row past the terminal). That overflow vanishes
        when a modal (no scrollbox) takes the slot — which is exactly the 1-row
        "shift" the whole bottom strip used to do. Basis 0 makes the row grow
        purely from the available space, ignoring content, so it's stable.
      */}
      <box style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <box style={{ flexDirection: "column", flexGrow: 1 }}>
          {rootViewFor(view, store)}
        </box>
        {view ? <ModalLayer store={store} /> : null}
      </box>
      <BottomBar store={store} />
    </box>
  );
}

await render(() => <App />, { useMouse: true });
