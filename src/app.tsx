/**
 * tuiboard — bootstrap.
 *
 * Loads config, builds the reactive store, parses argv, and dispatches
 * to one of four root views:
 *   - undefined → Dashboard (all 4 zones)
 *   - "board"   → BoardOnly  (kanban + virtual fullscreen)
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
import { buildVirtualItems } from "~/store/virtual-panel";
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
//   < 100     → hide virtual too (board is non-hideable)
//
// User F1/F2/F3 toggles still work — they last until the next resize, at
// which point auto re-evaluates. Acceptable trade-off: resize events are
// rare, predictable layout > sticky overrides.
function applyResponsiveLayout(): void {
  const width = process.stdout.columns ?? 200;
  store.setZoneVisible("timeline", width >= 150);
  store.setZoneVisible("agents", width >= 120);
  store.setZoneVisible("virtual", width >= 100);
}
applyResponsiveLayout();
process.stdout.on("resize", applyResponsiveLayout);

// Land on the Today/Tomorrow panel by default — for a daily-planning tool the
// first question is "what's on my plate today", and that panel answers it. On
// a narrow terminal where the panel auto-hides, fall back to the board.
if (store.state.ui.visibleZones.virtual) {
  store.setActiveZone("virtual");
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
  const virtualItems = createMemo(() =>
    buildVirtualItems(store.state.boards.map((b) => b.board)),
  );

  useKeyboard((key) => handleKey(store, key, virtualItems().length));

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        padding: 1,
      }}
    >
      <TopBar store={store} />
      <box style={{ height: 1 }} />
      {/*
        rootView and ModalLayer are siblings inside a flex-row so the
        modal can sit beside the view as a fixed-width, full-height
        side panel. ModalLayer renders only when ui.modal is set,
        otherwise its <Show> resolves to nothing and the rootView gets
        the whole row.
      */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1 }}>
          {rootViewFor(view, store)}
        </box>
        <ModalLayer store={store} />
      </box>
      <BottomBar store={store} />
    </box>
  );
}

await render(() => <App />, { useMouse: true });
