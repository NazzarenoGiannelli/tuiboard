/**
 * Phase 5.1 stub. Renders a bordered placeholder so the dashboard layout
 * can be wired and visually verified before the real agent view lands in
 * Day 5.2.
 */

import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface AgentsBarProps {
  store: TuiStore;
  /** Fixed row height in the dashboard layout. Omit for fullscreen mode. */
  height?: number;
}

export function AgentsBar(props: AgentsBarProps) {
  const isActive = () => props.store.state.ui.activeZone === "agents";

  return (
    <box
      style={{
        flexDirection: "column",
        height: props.height,
        flexGrow: props.height ? 0 : 1,
        marginTop: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title="┤ Agents (live) ├"
      titleAlignment="left"
    >
      <text>
        <span style={{ fg: T.textDim }}>Agents · coming in Day 5.2</span>
      </text>
    </box>
  );
}
