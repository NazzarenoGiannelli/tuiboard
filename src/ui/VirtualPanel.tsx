/** The fixed Today/Tomorrow virtual panel — always on the left. */

import { For, Show, createMemo } from "solid-js";

import { ATTR, T } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import {
  buildVirtualItems,
  groupVirtualItems,
  type VirtualGroup,
} from "~/store/virtual-panel";
import type { TuiStore } from "~/store/index";

const SECTION_HEADER: Record<string, { label: string; color: string }> = {
  overdue: { label: "● Overdue", color: T.overdue },
  today: { label: "● Today", color: T.high },
  tomorrow: { label: "→ Tomorrow", color: T.textDim },
};

const BUCKET_HEADER: Record<string, { label: string; color: string }> = {
  agenda: { label: "⏰ Agenda", color: T.accent },
  priority: { label: "🔺 Priorità", color: T.highest },
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
        marginRight: 2,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text wrapMode="none" truncate>
          <span style={{ fg: isActive() ? T.accent : T.textDim }}>
            {isActive() ? "▎" : " "}
          </span>
          <span style={{ fg: isActive() ? T.accent : T.text, attributes: ATTR.bold }}>
            Today / Tomorrow
          </span>
          <span style={{ fg: T.textDim }}>{"  ["}{items().length}{"]"}</span>
        </text>
      </box>

      <Show
        when={items().length > 0}
        fallback={
          <box style={{ paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
            <text>
              <span style={{ fg: T.textDim }}>Niente di schedulato.</span>
            </text>
          </box>
        }
      >
        <scrollbox
          style={{
            width: "100%",
            flexGrow: 1,
            rootOptions: {},
            contentOptions: {},
            scrollbarOptions: {
              trackOptions: {
                foregroundColor: T.accent,
                backgroundColor: T.border,
              },
            },
          }}
        >
          <RenderGroups
            groups={groups()}
            isActive={isActive()}
            cursorRow={cursorRow()}
          />
        </scrollbox>
      </Show>
    </box>
  );
}

function RenderGroups(props: {
  groups: VirtualGroup[];
  isActive: boolean;
  cursorRow: number;
}) {
  // Walking counter for cursor highlighting across the flat row index
  // (matches the order of items returned by buildVirtualItems).
  let globalIdx = 0;

  return (
    <For each={props.groups}>
      {(group, gi) => {
        const sectionHeader = isFirstOfSection(props.groups, gi())
          ? SECTION_HEADER[group.section]
          : undefined;
        const bucketHeader = BUCKET_HEADER[group.bucket];

        return (
          <box style={{ flexDirection: "column" }}>
            <Show when={sectionHeader}>
              <box style={{ paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
                <text>
                  <span style={{ fg: sectionHeader!.color, attributes: ATTR.bold }}>
                    {sectionHeader!.label}
                  </span>
                </text>
              </box>
            </Show>
            <box style={{ paddingLeft: 1, paddingRight: 1 }}>
              <text>
                <span style={{ fg: bucketHeader!.color }}>{"  "}{bucketHeader!.label}</span>
              </text>
            </box>
            <Show
              when={group.subgroups && group.subgroups.length > 0}
              fallback={
                <For each={group.items}>
                  {(item) => {
                    const myIdx = globalIdx++;
                    return (
                      <TaskRow
                        task={item.task}
                        cursor={props.isActive && myIdx === props.cursorRow}
                        contextTag={
                          group.bucket === "agenda" || group.bucket === "priority"
                            ? `${item.boardName}·${item.columnName}`
                            : undefined
                        }
                      />
                    );
                  }}
                </For>
              }
            >
              <For each={group.subgroups!}>
                {(sub) => (
                  <box style={{ flexDirection: "column" }}>
                    <box style={{ paddingLeft: 1, paddingRight: 1 }}>
                      <text wrapMode="none" truncate>
                        <span style={{ fg: T.textDim }}>
                          {"  — "}{sub.boardName}{" · "}{sub.columnName}{" —"}
                        </span>
                      </text>
                    </box>
                    <For each={sub.items}>
                      {(item) => {
                        const myIdx = globalIdx++;
                        return (
                          <TaskRow
                            task={item.task}
                            cursor={props.isActive && myIdx === props.cursorRow}
                          />
                        );
                      }}
                    </For>
                  </box>
                )}
              </For>
            </Show>
          </box>
        );
      }}
    </For>
  );
}

function isFirstOfSection(
  groups: VirtualGroup[],
  idx: number,
): boolean {
  if (idx === 0) return true;
  return groups[idx - 1]!.section !== groups[idx]!.section;
}
