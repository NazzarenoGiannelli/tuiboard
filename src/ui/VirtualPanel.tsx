/** The fixed Today/Tomorrow virtual panel — always on the left. */

import { For, Show, createMemo } from "solid-js";

import { ATTR, T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import { buildVirtualItems, groupVirtualItems } from "~/store/virtual-panel";
import type { TuiStore } from "~/store/index";

const SECTION_HEADER: Record<string, { label: string; color: string }> = {
  overdue: { label: "● Overdue", color: T.overdue },
  today: { label: "● Today", color: T.high },
  tomorrow: { label: "→ Tomorrow", color: T.textDim },
};

const BUCKET_HEADER: Record<string, { label: string; color: string }> = {
  agenda: { label: "⏰ Agenda", color: T.accent },
  priority: { label: "🔺 Priority", color: T.highest },
  rest: { label: "Altro", color: T.textDim },
};

export function VirtualPanel(props: { store: TuiStore }) {
  const items = createMemo(() => {
    return buildVirtualItems(props.store.state.boards.map((b) => b.board));
  });
  const groups = createMemo(() => groupVirtualItems(items()));
  const isActive = createMemo(() => props.store.state.ui.inVirtual);
  const cursorRow = createMemo(() => props.store.state.ui.row);

  return (
    <box
      style={{
        flexDirection: "column",
        width: 38,
        minWidth: 38,
        marginRight: 1,
        backgroundColor: isActive() ? T.panelBgActive : T.panelBg,
        border: true,
        borderColor: isActive() ? T.borderActive : T.border,
        padding: 1,
      }}
    >
      <text>
        <span style={{ fg: isActive() ? T.accent : T.text, attributes: ATTR.bold }}>
          Today / Tomorrow
        </span>
        <span style={{ fg: T.textDim }}>{"  ["}{items().length}{"]"}</span>
      </text>
      <box style={{ height: 1 }} />

      <Show
        when={items().length > 0}
        fallback={
          <text>
            <span style={{ fg: T.textDim }}>Niente di schedulato.</span>
          </text>
        }
      >
        <scrollbox
          style={{
            width: "100%",
            flexGrow: 1,
            rootOptions: { backgroundColor: isActive() ? T.panelBgActive : T.panelBg },
            contentOptions: { backgroundColor: isActive() ? T.panelBgActive : T.panelBg },
            scrollbarOptions: {
              trackOptions: {
                foregroundColor: T.accent,
                backgroundColor: T.border,
              },
            },
          }}
        >
          <PrintGroups
            groups={groups()}
            isActive={isActive()}
            cursorRow={cursorRow()}
          />
        </scrollbox>
      </Show>
    </box>
  );
}

function PrintGroups(props: {
  groups: ReturnType<typeof groupVirtualItems>;
  isActive: boolean;
  cursorRow: number;
}) {
  // Compute the flat list with global row indices so the cursor highlight
  // lines up with the navigation count.
  let globalIdx = 0;

  return (
    <For each={props.groups}>
      {(group, gi) => {
        const sectionHeader = gi() === 0 || isFirstOfSection(props.groups, gi())
          ? SECTION_HEADER[group.section]
          : undefined;
        const bucket = BUCKET_HEADER[group.bucket];

        return (
          <box style={{ flexDirection: "column" }}>
            <Show when={sectionHeader}>
              <Show when={gi() > 0}>
                <box style={{ height: 1 }} />
              </Show>
              <text>
                <span style={{ fg: sectionHeader!.color, attributes: ATTR.bold }}>
                  {sectionHeader!.label}
                </span>
              </text>
            </Show>
            <text>
              <span style={{ fg: bucket!.color }}>{"  "}{bucket!.label}</span>
            </text>
            <For each={group.items}>
              {(item) => {
                const myIdx = globalIdx++;
                return (
                  <TaskRow
                    task={item.task}
                    cursor={props.isActive && myIdx === props.cursorRow}
                    contextTag={`${item.boardName}·${item.columnName}`}
                  />
                );
              }}
            </For>
          </box>
        );
      }}
    </For>
  );
}

function isFirstOfSection(
  groups: ReturnType<typeof groupVirtualItems>,
  idx: number,
): boolean {
  if (idx === 0) return true;
  return groups[idx - 1]!.section !== groups[idx]!.section;
}
