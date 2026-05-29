/**
 * Single-line render of an AgentSession. Used in both AgentsBar (compact
 * dashboard strip) and AgentsOnly (fullscreen list).
 *
 * Layout: cursor · status-dot · name · git branch  ……right-pinned: cwd_short · age
 */

import { Show, createMemo } from "solid-js";

import { T } from "~/ui/glyphs";
import { formatAge, type AgentSession, type AgentStatus } from "~/store/agents";

const STATUS_COLOR: Record<AgentStatus, string> = {
  "live-busy": T.today,     // bright accent for actively-running
  "live-idle": T.scheduled, // warm but quieter
  "stale-pid": T.bannerWarn,
  "dormant":   T.textDim,
  "archived":  T.textDone,
};

const STATUS_GLYPH: Record<AgentStatus, string> = {
  "live-busy": "●",
  "live-idle": "○",
  "stale-pid": "△",
  "dormant":   "·",
  "archived":  "·",
};

interface AgentRowProps {
  session: AgentSession;
  cursor?: boolean;
  /** Maximum chars for displayName before truncation. Default 40. */
  nameMaxChars?: number;
  onClick?: () => void;
}

export function AgentRow(props: AgentRowProps) {
  const ageStr = createMemo(() =>
    formatAge(props.session.lastActivityMs, Date.now()),
  );
  const nameMax = () => props.nameMaxChars ?? 40;
  const displayName = createMemo(() => {
    const n = props.session.displayName;
    return n.length > nameMax() ? n.slice(0, nameMax() - 1) + "…" : n;
  });

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: props.cursor ? T.cardBgCursor : undefined,
      }}
      onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
    >
      {/* `truncate` is on as a safety net — our own displayName tail
          truncation in AgentRow normally controls the visible string,
          but OpenTUI's clip-at-cell-bound prevents bleed into adjacent
          renderables in edge cases (terminal emoji width quirks etc.). */}
      <text style={{ flexGrow: 1, flexShrink: 1 }} wrapMode="none" truncate>
        <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
          {props.cursor ? "▶ " : "  "}
        </span>
        <span style={{ fg: STATUS_COLOR[props.session.status] }}>
          {STATUS_GLYPH[props.session.status]}{" "}
        </span>
        <span style={{ fg: T.text }}>{displayName()}</span>
        <Show when={props.session.gitBranch}>
          <span style={{ fg: T.textDim }}>{"  "}{props.session.gitBranch}</span>
        </Show>
      </text>
      {/* cwd + age pinned together on the right, so the session titles align
          cleanly on the left instead of being pushed around by the path. */}
      <text style={{ flexShrink: 0 }} wrapMode="none">
        <span style={{ fg: T.textDim }}>
          {props.session.cwdShort}{"   "}{ageStr()}
        </span>
      </text>
    </box>
  );
}
