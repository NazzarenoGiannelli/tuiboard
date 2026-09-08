/**
 * Shared chrome — top tab bar (boards + brand + stats) and bottom keybar
 * (banner + shortcut hint line). Used by every root view so the user
 * always sees the same orientation regardless of --view=X mode.
 */

import { For, Show } from "solid-js";

import { isHiddenColumn } from "~/config/loader";
import { isoToday } from "~/store/index";
import { ATTR, T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

export function TopBar(props: { store: TuiStore }) {
  const boards = () => props.store.state.boards;
  const active = () => props.store.state.ui.activeBoardIndex;
  const activeStats = () => {
    const b = boards()[active()]?.board;
    if (!b) return undefined;
    let open = 0, done = 0, cols = 0;
    for (const c of b.columns) {
      if (!isHiddenColumn(props.store.config, c.name)) cols++;
      for (const child of c.children) {
        if (!("kind" in child)) {
          if (child.done) done++;
          else open++;
        }
      }
    }
    return { open, done, cols };
  };

  // Single-pane: one zone fills the screen, so the tab strip has nothing left
  // to orient anybody — you cannot see the zones you are not in. It is replaced
  // by where you are in the ring. When the two compete for room the position
  // wins: the board name is one keystroke from being obvious, the ring
  // position is not.
  const singlePane = () => props.store.singlePane();
  const paneLabel = () => {
    const p = props.store.currentPane();
    if (!p) return "";
    const { at, of } = p.position;
    return `⤢ ${p.label}  ‹ ${at + 1}/${of} ›`;
  };

  return (
    <Show when={!singlePane()} fallback={<CompactBar store={props.store} label={paneLabel()} />}>
    <box style={{ flexDirection: "row", justifyContent: "space-between", height: 1 }}>
      <box style={{ flexDirection: "row", flexShrink: 1, overflow: "hidden" }}>
        {/* Brand + date */}
        <text wrapMode="none" style={{ flexShrink: 0 }}>
          <span style={{ fg: T.todayPale, attributes: ATTR.bold }}>tuiboard</span>
          <span style={{ fg: T.textDim }}>{`  ${isoToday()}   `}</span>
        </text>
        {/* Clickable board tabs */}
        <For each={boards()}>
          {(b: { board: { name: string } }, i) => {
            const isActive = () => i() === active();
            return (
              <box
                style={{ flexShrink: 0, flexDirection: "row" }}
                onMouseDown={() => props.store.setActiveBoard(i())}
              >
                <text wrapMode="none">
                  <span
                    style={{
                      fg: isActive() ? T.accent : T.textDim,
                      attributes: isActive() ? ATTR.bold : 0,
                    }}
                  >
                    {isActive()
                      ? `[${i() + 1} ${b.board.name}] `
                      : ` ${i() + 1} ${b.board.name}  `}
                  </span>
                </text>
              </box>
            );
          }}
        </For>
        {/* New board — the browser's new-tab button, in a terminal. Clickable
            like the tabs beside it; `+` does the same from the keyboard. */}
        <box
          style={{ flexShrink: 0, flexDirection: "row" }}
          onMouseDown={() => props.store.openBoardNew()}
        >
          <text wrapMode="none">
            <span style={{ fg: T.textDim }}> + </span>
          </text>
        </box>
      </box>
      <Show when={activeStats()}>
        <text wrapMode="none" style={{ flexShrink: 0, marginLeft: 2 }}>
          <span style={{ fg: T.textDim }}>
            {activeStats()!.open} open · {activeStats()!.done} done · {activeStats()!.cols} cols
          </span>
        </text>
      </Show>
    </box>
    </Show>
  );
}

/**
 * The narrow-terminal top bar: board name, then the ring position. Everything
 * else — the date, the per-board counters, the other tabs — is dropped rather
 * than truncated mid-word, which is what the full bar does at 60 columns.
 */
function CompactBar(props: { store: TuiStore; label: string }) {
  const boardName = () =>
    props.store.state.boards[props.store.state.ui.activeBoardIndex]?.board.name ?? "";
  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", height: 1 }}>
      <text wrapMode="none" style={{ flexShrink: 1 }}>
        <span style={{ fg: T.textDim }}>{boardName() + "  "}</span>
      </text>
      <text wrapMode="none" style={{ flexShrink: 0 }}>
        <span style={{ fg: T.accent, attributes: ATTR.bold }}>{props.label}</span>
      </text>
    </box>
  );
}

export function BottomBar(props: { store: TuiStore }) {
  const banner = () => props.store.state.ui.banner;
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <Show
          when={banner()}
          fallback={
            <text>
              <span style={{ fg: T.textDim }}>{" "}</span>
            </text>
          }
        >
          {(b: () => NonNullable<ReturnType<typeof banner>>) => (
            <text>
              <span
                style={{
                  fg:
                    b().kind === "error"
                      ? T.bannerError
                      : b().kind === "warn"
                        ? T.bannerWarn
                        : T.bannerInfo,
                }}
              >
                {"⚑ "}{b().text}
              </span>
            </text>
          )}
        </Show>
      </box>
      <box style={{ height: 1, flexDirection: "row" }}>
        {/*
          Curated cheat-sheet: only the keys that keep you unstuck (move,
          switch zone/board, help, quit) plus the highest-frequency, on-brand
          actions (done, new, schedule). Everything else — zoom, toggles,
          multi-select, edit/assign/archive/delete, undo — lives in `?`.
        */}
        <text wrapMode="none" truncate>
          <span style={{ fg: T.textDim }}>
            {"hjkl ↑↓←→ move · Tab board · ⇧Tab zone · ⏎ done · n new · t today · b block · c schedule · r refresh · z zoom · ? help · q quit"}
          </span>
        </text>
      </box>
    </box>
  );
}
