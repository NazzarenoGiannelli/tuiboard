/**
 * Phase 5.1 stub. Renders a bordered placeholder so the dashboard layout
 * can be wired and visually verified before the real timeline lands in
 * Day 5.3.
 */

import { T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";

interface TimelineViewProps {
  store: TuiStore;
  width?: number;
}

export function TimelineView(props: TimelineViewProps) {
  const isActive = () => props.store.state.ui.activeZone === "timeline";

  return (
    <box
      style={{
        flexDirection: "column",
        width: props.width,
        minWidth: props.width,
        flexGrow: props.width ? 0 : 1,
        marginLeft: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: isActive() ? T.borderActive : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title="┤ Timeline ├"
      titleAlignment="left"
    >
      <text>
        <span style={{ fg: T.textDim }}>Timeline · coming in Day 5.3</span>
      </text>
    </box>
  );
}
