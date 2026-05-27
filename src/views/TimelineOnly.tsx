/** Standalone fullscreen view for the timeline. `tuiboard --view=timeline`. */

import { TimelineView } from "~/ui/TimelineView";
import type { TuiStore } from "~/store/index";

export function TimelineOnly(props: { store: TuiStore }) {
  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
      <TimelineView store={props.store} />
    </box>
  );
}
