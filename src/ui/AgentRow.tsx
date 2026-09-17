/**
 * Render of an AgentSession, in two densities:
 *
 *   line  (AgentsBar — the 5-row dashboard strip)
 *     cursor · status · harness · name · branch · model ……right-pinned: cwd_short · age
 *     Fitted to the measured row width (see agent-line.ts): on a narrow row the
 *     model goes first, then the branch, then the cwd — the name survives longest.
 *
 *   card  (AgentsOnly — fullscreen / zoomed Agents view)
 *     cursor · status · harness · name ………………………………… age
 *              model · branch · cwd                         (dimmed)
 */

import { Show, createMemo, createSignal, onMount } from "solid-js";
import { homedir } from "node:os";

import { layoutCardDetails, layoutCardName, layoutLine } from "~/ui/agent-line";
import { clockNow } from "~/ui/clock";
import { T } from "~/ui/glyphs";
import { herdrPlace, type IndicatorStyle } from "~/store/herdr";
import {
  HARNESS,
  cwdShort,
  formatAge,
  shortModel,
  type AgentProvider,
  type AgentSession,
  type AgentStatus,
} from "~/store/agents";

const STATUS_COLOR: Record<AgentStatus, string> = {
  "live-blocked": T.overdue,  // needs you
  "live-busy":    T.today,    // bright accent for actively-running
  "live-done":    T.done,     // finished, not looked at yet
  "live-idle":    T.scheduled, // warm but quieter
  "stale":        T.bannerWarn,
  "dormant":      T.textDim,
  "archived":     T.textDone,
};

/**
 * herdr's two `status_indicators` styles, copied as-is so the same state reads
 * the same in both tools. `stale` is tuiboard's own (no herdr equivalent).
 */
const STATUS_GLYPH: Record<IndicatorStyle, Record<AgentStatus, string>> = {
  dots: {
    "live-blocked": "●",
    "live-busy":    "●",
    "live-done":    "●",
    "live-idle":    "○",
    "stale":        "△",
    "dormant":      "·",
    "archived":     "·",
  },
  symbols: {
    "live-blocked": "×",
    "live-busy":    "◐",
    "live-done":    "✓",
    "live-idle":    "○",
    "stale":        "△",
    "dormant":      "·",
    "archived":     "·",
  },
};



/** One hue per harness so the badge reads before the letters do. */
export const HARNESS_COLOR: Record<AgentProvider, string> = {
  "claude-code": T.warm,    // orange
  codex:         T.accent,  // blue-cyan
  opencode:      "#d27ee0", // violet-fuchsia
  pi:            "#c3d94e", // acid yellow-green
};

/** Card cwd: `~`-relative when under $HOME, shortened when still long. */
const HOME = homedir();
const CARD_CWD_MAX = 60;
function cardCwd(cwd: string): string {
  const underHome = cwd === HOME || cwd.startsWith(HOME + "/") || cwd.startsWith(HOME + "\\");
  const shown = underHome ? "~" + cwd.slice(HOME.length) : cwd;
  return shown.length > CARD_CWD_MAX ? cwdShort(cwd) : shown;
}

interface AgentRowProps {
  session: AgentSession;
  cursor?: boolean;
  /** Maximum chars for displayName before truncation. Default 40. */
  nameMaxChars?: number;
  /** `line` (default) for the dashboard strip, `card` for the fullscreen view. */
  variant?: "line" | "card";
  /** Status glyph style (default symbols, as in herdr). */
  indicators?: IndicatorStyle;
  onClick?: () => void;
}

export function AgentRow(props: AgentRowProps) {
  const ageStr = createMemo(() =>
    formatAge(props.session.lastActivityMs, clockNow()),
  );
  const nameMax = () => props.nameMaxChars ?? 40;
  const displayName = createMemo(() => {
    const n = props.session.displayName;
    return n.length > nameMax() ? n.slice(0, nameMax() - 1) + "…" : n;
  });
  const model = createMemo(() => shortModel(props.session.model));

  // Measured row width; undefined until the first layout pass.
  const [width, setWidth] = createSignal<number | undefined>();
  let rowRef: { width: number } | undefined;
  const measure = () => {
    if (rowRef && rowRef.width > 0) setWidth(rowRef.width);
  };
  onMount(() => setTimeout(measure, 0));
  const sizeProps = {
    ref: (r: { width: number }) => (rowRef = r),
    onSizeChange: measure,
  };

  const line = createMemo(() =>
    layoutLine(
      {
        name: displayName(),
        branch: props.session.gitBranch,
        model: model(),
        cwd: props.session.cwdShort,
        age: ageStr().padStart(3),
      },
      width(),
    ),
  );
  const cardName = createMemo(() => layoutCardName(displayName(), width()));
  const details = createMemo(() =>
    layoutCardDetails(
      [
        model(),
        props.session.herdr && herdrPlace(props.session.herdr),
        props.session.gitBranch,
        cardCwd(props.session.cwd),
      ],
      width(),
    ),
  );

  // cursor · status glyph · harness badge — shared by both variants.
  const lead = () => [
    <span style={{ fg: props.cursor ? T.accent : T.textDim }}>
      {props.cursor ? "▶ " : "  "}
    </span>,
    <span style={{ fg: STATUS_COLOR[props.session.status] }}>
      {STATUS_GLYPH[props.indicators ?? "symbols"][props.session.status]}{" "}
    </span>,
    <span style={{ fg: HARNESS_COLOR[props.session.provider] }}>
      {HARNESS[props.session.provider].code}{" "}
    </span>,
  ];

  return (
    <Show
      when={props.variant === "card"}
      fallback={
        <box
          {...sizeProps}
          style={{
            flexDirection: "row",
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: props.cursor ? T.cardBgCursor : undefined,
          }}
          onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
        >
          {/* `truncate` stays on as a safety net only — layoutLine already
              fits the fields to the measured width with a tail cut, while
              OpenTUI's own truncation would elide mid-string. */}
          <text style={{ flexGrow: 1, flexShrink: 1 }} wrapMode="none" truncate>
            {lead()}
            <span style={{ fg: T.text }}>{line().name}</span>
            <Show when={line().branch}>
              <span style={{ fg: T.warmDim }}>{"  "}{line().branch}</span>
            </Show>
            <Show when={line().model}>
              <span style={{ fg: T.textDim }}>{"  "}{line().model}</span>
            </Show>
          </text>
          {/* cwd + age pinned together on the right. The age is right-aligned in a
              fixed-width field (pad to 3: "59m" / "23h" / "10d") so the END of each
              cwd lands on the same column across rows — a 1- vs 2-digit age no
              longer shoves the directory names out of vertical alignment. */}
          <text style={{ flexShrink: 0 }} wrapMode="none">
            <span style={{ fg: T.textDim }}>{"  "}{line().right}</span>
          </text>
        </box>
      }
    >
      <box
        {...sizeProps}
        style={{
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: props.cursor ? T.cardBgCursor : undefined,
        }}
        onMouseDown={props.onClick ? (() => props.onClick!()) : undefined}
      >
        <box style={{ flexDirection: "row" }}>
          <text style={{ flexGrow: 1, flexShrink: 1 }} wrapMode="none" truncate>
            {lead()}
            <span style={{ fg: T.text }}>{cardName()}</span>
          </text>
          <text style={{ flexShrink: 0 }} wrapMode="none">
            <span style={{ fg: T.textDim }}>{"  "}{ageStr().padStart(3)}</span>
          </text>
        </box>
        {/* Indent = width of "▶ ● cc " so the details line up under the name. */}
        <box style={{ flexDirection: "row", paddingLeft: 7 }}>
          <text style={{ flexGrow: 1, flexShrink: 1 }} wrapMode="none" truncate>
            <span style={{ fg: T.textDim }}>{details()}</span>
          </text>
        </box>
      </box>
    </Show>
  );
}
