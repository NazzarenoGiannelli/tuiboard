/** Standalone fullscreen view for the agent view. `tuiboard --view=agents`. */

import { AgentsBar } from "~/ui/AgentsBar";
import { ModalLayer } from "~/ui/Modal";
import type { TuiStore } from "~/store/index";

export function AgentsOnly(props: { store: TuiStore }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <AgentsBar store={props.store} />
      <ModalLayer store={props.store} />
    </box>
  );
}
