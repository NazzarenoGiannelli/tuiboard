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

  // Build a flat token list for the tab row so we can render as a single
  // <text> without JSX fragments (which OpenTUI's Solid renderer doesn't
  // play well with inside <text>).
  const tabsText = () => {
    const parts: Array<{ text: string; active: boolean; brand?: boolean }> = [];
    parts.push({ text: "tuiboard", active: false, brand: true });
    parts.push({ text: `  ${isoToday()}   `, active: false });
    boards().forEach((b: { board: { name: string } }, i: number) => {
      const isActive = i === active();
      parts.push({
        text: isActive ? `[${i + 1} ${b.board.name}]` : ` ${i + 1} ${b.board.name} `,
        active: isActive,
      });
      parts.push({ text: " ", active: false });
    });
    return parts;
  };

  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", height: 1 }}>
      <text wrapMode="none" truncate style={{ flexGrow: 1, flexShrink: 1 }}>
        <For each={tabsText()}>
          {(p) => (
            <span
              style={{
                fg: p.brand
                  ? T.accent
                  : p.active
                    ? T.accent
                    : T.textDim,
                attributes: p.brand || p.active ? ATTR.bold : 0,
              }}
            >
              {p.text}
            </span>
          )}
        </For>
      </text>
      <Show when={activeStats()}>
        <text wrapMode="none" style={{ flexShrink: 0, marginLeft: 2 }}>
          <span style={{ fg: T.textDim }}>
            {activeStats()!.open} open · {activeStats()!.done} done · {activeStats()!.cols} cols
          </span>
        </text>
      </Show>
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
        <text>
          <span style={{ fg: T.textDim }}>
            {"hjkl move · Tab/1-9 board · S-Tab zone · F1/F2/F3 toggle · v panel · z zoom · Space mark · ⏎ done · o detail · n/e/s/b/a/X act · d del · ⌃Z undo · ? help · q quit"}
          </span>
        </text>
      </box>
    </box>
  );
}
