/** The fixed Today/Tomorrow virtual panel — always on the left. */

import { For, Show, createMemo } from "solid-js";

import { ATTR, T, boardColor } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import {
  buildVirtualItems,
  groupVirtualItems,
  type VirtualGroup,
} from "~/store/virtual-panel";
import type { TuiStore } from "~/store/index";

const SECTION_HEADER: Record<string, { label: string; color: string }> = {
  overdue: { label: "● Overdue", color: T.overdue },
  today: { label: "● Today", color: T.today },
  tomorrow: { label: "→ Tomorrow", color: T.warmDim },
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
  const isActive = createMemo(() => props.store.state.ui.activeZone === "virtual");
  const isZoomed = createMemo(
    () => props.store.state.ui.zoomed && props.store.state.ui.activeZone === "virtual",
  );
  const cursorRow = createMemo(() => props.store.state.ui.row);

  // Decorate title with vertical "tabs" `┤ … ├` so it visually breaks
  // through the rounded border line (Superfile-style).
  const titleText = () =>
    `┤ ${isZoomed() ? "⤢ " : ""}Today / Tomorrow  ${items().length} ├`;

  return (
    <box
      style={{
        flexDirection: "column",
        width: isZoomed() ? undefined : 38,
        minWidth: isZoomed() ? undefined : 38,
        flexGrow: isZoomed() ? 1 : 0,
        marginRight: 1,
        border: true,
        borderStyle: "rounded",
        // Today/Tomorrow panel keeps its warm identity at all times — when
        // focused it brightens, otherwise it dims, but never goes cool.
        borderColor: isActive() ? T.warmActive : T.warm,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={titleText()}
      titleAlignment="left"
    >
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
            rootOptions: {},
            contentOptions: {},
            scrollbarOptions: {
              visible: false,
            },
          }}
        >
          <RenderGroups
            groups={groups()}
            isActive={isActive()}
            cursorRow={cursorRow()}
            titleMaxChars={isZoomed() ? 84 : 28}
            isMarkedFn={(r) => props.store.isMarked(r)}
            onClickItem={(flatIndex) => {
              props.store.setActiveZone("virtual");
              props.store.setCursor(0, flatIndex);
            }}
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
  titleMaxChars: number;
  isMarkedFn: (ref: import("~/store/index").TaskRef) => boolean;
  onClickItem: (flatIndex: number) => void;
}) {
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
                    const showTag =
                      group.bucket === "agenda" || group.bucket === "priority";
                    return (
                      <TaskRow
                        task={item.task}
                        cursor={props.isActive && item.flatIndex === props.cursorRow}
                        marked={props.isMarkedFn(item.ref)}
                        titleMaxChars={props.titleMaxChars}
                        contextTag={showTag ? item.boardName : undefined}
                        contextColor={showTag ? boardColor(item.boardIndex) : undefined}
                        onClick={() => props.onClickItem(item.flatIndex)}
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
                      {(item) => (
                        <TaskRow
                          task={item.task}
                          cursor={props.isActive && item.flatIndex === props.cursorRow}
                          marked={props.isMarkedFn(item.ref)}
                          titleMaxChars={props.titleMaxChars}
                          onClick={() => props.onClickItem(item.flatIndex)}
                        />
                      )}
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
