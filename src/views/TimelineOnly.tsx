/** Standalone fullscreen view for the timeline. `tuiboard --view=timeline`. */

import { TimelineView } from "~/ui/TimelineView";
import { ModalLayer } from "~/ui/Modal";
import type { TuiStore } from "~/store/index";

export function TimelineOnly(props: { store: TuiStore }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <TimelineView store={props.store} />
      </box>
      <ModalLayer store={props.store} />
    </box>
  );
}
