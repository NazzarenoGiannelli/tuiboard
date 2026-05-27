/**
 * Single-line render of an AgentSession. Used in both AgentsBar (compact
 * dashboard strip) and AgentsOnly (fullscreen list).
 *
 * Layout: cursor · status-dot · name · git branch · cwd_short · age
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
      {/* No `truncate` — see TaskRow for rationale. Our own displayName
          tail-truncation in AgentRow controls the visible string; OpenTUI
          hard-clips at cell boundary without inserting middle ellipses. */}
      <text style={{ flexGrow: 1, flexShrink: 1 }} wrapMode="none">
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
        <span style={{ fg: T.textDim }}>{"  "}{props.session.cwdShort}</span>
      </text>
      <text style={{ flexShrink: 0 }} wrapMode="none">
        <span style={{ fg: T.textDim }}>{" "}{ageStr()}</span>
      </text>
    </box>
  );
}
