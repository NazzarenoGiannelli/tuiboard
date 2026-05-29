/** The fixed Today/Tomorrow virtual panel — always on the left. */

import { For, Show, createEffect, createMemo } from "solid-js";

import { ATTR, T, boardColor } from "~/ui/glyphs";
import { TaskRow } from "~/ui/TaskRow";
import {
  buildVirtualItems,
  groupVirtualItems,
  type VirtualGroup,
} from "~/store/virtual-panel";
import type { TuiStore } from "~/store/index";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

const VP_ROW_PREFIX = "tuiboard-vp-row-";
const vpRowId = (flatIndex: number) => `${VP_ROW_PREFIX}${flatIndex}`;

const SECTION_HEADER: Record<string, { label: string; color: string }> = {
  overdue: { label: "● Overdue", color: T.overdue },
  today: { label: "● Today", color: T.today },
  tomorrow: { label: "→ Tomorrow", color: T.textDim },
};

// Only the agenda and priority buckets get a header. The "rest" bucket has
// no header of its own — its items already sit under their own
// `— board · column —` sub-dividers, so a generic label would be redundant.
const BUCKET_HEADER: Record<string, { label: string; color: string }> = {
  agenda: { label: "⏰ Agenda", color: T.accent },
  priority: { label: "🔺 Priority", color: T.highest },
};

export function VirtualPanel(props: { store: TuiStore }) {
  const items = createMemo(() => {
    props.store.state.rev; // recompute on any board mutation
    return buildVirtualItems(props.store.state.boards.map((b) => b.board));
  });
  const groups = createMemo(() => groupVirtualItems(items()));
  const isActive = createMemo(() => props.store.state.ui.activeZone === "virtual");
  const isZoomed = createMemo(
    () => props.store.state.ui.zoomed && props.store.state.ui.activeZone === "virtual",
  );
  const cursorRow = createMemo(() => props.store.state.ui.row);
  let scrollBoxRef: ScrollBoxLike | undefined;

  // Auto-scroll so the cursor's row stays visible. Without this, when the
  // panel's content overflows, pressing j/k advanced ui.row but the
  // scrollbox didn't follow — the cursor moved invisibly until the bottom
  // of the visible window happened to scroll past it. Now the scroll
  // tracks the cursor on every move (BoardView pattern).
  createEffect(() => {
    const row = cursorRow();
    if (!isActive() || !scrollBoxRef) return;
    setTimeout(() => {
      try {
        scrollBoxRef?.scrollChildIntoView(vpRowId(row));
      } catch {
        // Child not mounted yet — harmless.
      }
    }, 0);
  });

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
            <span style={{ fg: T.textDim }}>Nothing scheduled.</span>
          </text>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
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
            // Panel inner cell width seen by a TaskRow: panel 38 col
            // (or full width in zoom) − border 2 − panel padding 2 −
            // TaskRow padding 2 = 32 cols normal, ~terminal width − 6
            // when zoomed. Pass that so TaskRow can budget the title
            // dynamically against the row's actual overhead.
            availableWidth={isZoomed() ? 100 : 32}
            isMarkedFn={(r) => props.store.isMarked(r)}
            onClickItem={(flatIndex) => {
              props.store.setActiveZone("virtual");
              props.store.setCursor(0, flatIndex);
              // In calendar arm mode, a click also arms the task for the
              // timeline (click a task, then a slot to place it).
              if (props.store.state.ui.armMode) {
                const item = items().find((it) => it.flatIndex === flatIndex);
                if (item) {
                  props.store.armTimeline(item.ref);
                  props.store.setZoneVisible("timeline", true);
                }
              }
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
  availableWidth: number;
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
            <Show when={bucketHeader}>
              <box style={{ paddingLeft: 1, paddingRight: 1 }}>
                <text>
                  <span style={{ fg: bucketHeader!.color }}>{"  "}{bucketHeader!.label}</span>
                </text>
              </box>
            </Show>
            <Show
              when={group.subgroups && group.subgroups.length > 0}
              fallback={
                <For each={group.items}>
                  {(item) => (
                    <box id={vpRowId(item.flatIndex)}>
                      <TaskRow
                        task={item.task}
                        cursor={props.isActive && item.flatIndex === props.cursorRow}
                        marked={props.isMarkedFn(item.ref)}
                        availableWidth={props.availableWidth}
                        // Tint the title with the source board's accent so a
                        // cross-cutting Today/Tomorrow item is recognizable by
                        // its board at a glance (done-green still wins).
                        tintColor={boardColor(item.boardIndex)}
                        // Today / Tomorrow sections already say so in their
                        // header — drop the redundant per-row "today"/"tmrw"
                        // date label (the ⌚ time block stays). Overdue rows
                        // keep their MM/DD so you can see HOW overdue.
                        hideDateSuffix={
                          group.section === "today" || group.section === "tomorrow"
                        }
                        onClick={() => props.onClickItem(item.flatIndex)}
                      />
                    </box>
                  )}
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
                        <box id={vpRowId(item.flatIndex)}>
                          <TaskRow
                            task={item.task}
                            cursor={props.isActive && item.flatIndex === props.cursorRow}
                            marked={props.isMarkedFn(item.ref)}
                            availableWidth={props.availableWidth}
                            tintColor={boardColor(item.boardIndex)}
                            hideDateSuffix={
                              group.section === "today" || group.section === "tomorrow"
                            }
                            onClick={() => props.onClickItem(item.flatIndex)}
                          />
                        </box>
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
