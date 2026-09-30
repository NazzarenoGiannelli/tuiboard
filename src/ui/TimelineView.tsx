/**
 * Vertical 24h timeline column with click-to-arm scheduling.
 *
 * Renders today's time-blocked tasks as bands stacked on a per-15-minute
 * grid. Hour rows show their hour label on the left margin; the current
 * time is overlaid as a colored "now" line. Overlapping blocks are
 * rendered side-by-side via a 2-lane split row; a 3rd overlapping block
 * is dropped and reported as overflow via a banner.
 *
 * Mouse interaction (click-to-arm + click-to-place, like Python timeline.py):
 *
 *   Click on a band      → SELECT it (cursor); two clicks → ARM it (warm highlight)
 *   Armed: click any row → the block goes there, even inside its own body;
 *                          drag the body to move it, drag the bottom edge (↕) to resize
 *   Armed: two clicks    → keep it where it is and let go (like Enter)
 *   Click a tray row     → SELECT it; two clicks → ARM it and place it (like `c`)
 *   Click on empty row   → if armed, MOVE the armed block's start there;
 *                          if not, only a reminder (n adds an event, c places a task)
 *   Shift+click empty    → if armed, RESIZE the armed block's end there
 *
 * Keyboard interaction (handled in handleKey when activeZone === "timeline"):
 *
 *   j/k                  → one cursor over the "To place" tray (tasks of the day with
 *                          no hour yet), then the blocks in chronological order
 *   c                    → arm the task under the cursor; with no hour yet it is
 *                          placed in the first free half hour, so the keys below apply
 *   g                    → bounce kanban cursor to the underlying task
 *   Enter                → toggle done (like everywhere else)
 *   j/k while armed      → nudge armed block ±15 min (move)
 *   +/- while armed      → resize armed block end ±15 min
 *   Enter while armed    → keep, leave arm mode, back to where `c` started
 *   Esc while armed      → undo the placement, then the same way back
 *
 * Each timeline row is exactly 1 terminal line tall, so row index maps
 * 1:1 to MINS_PER_ROW (15) minute offsets from DAY_START_HOUR.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { googleTokenCanWrite } from "~/store/calendar";
import type { TaskRef } from "~/store/index";
import {
  DAY_START_HOUR,
  MINS_PER_ROW,
  TOTAL_ROWS,
  buildRowMap,
  buildCalendarEntries,
  buildTimelineEntries,
  buildUnscheduledToday,
  formatAgendaDay,
  formatHm,
  type RowMapEntry,
  type RowMapPair,
  type TimelineEntry,
} from "~/store/timeline";
import {
  ATTR,
  PRIORITY_COLOR,
  PRIORITY_GLYPH,
  T,
  boardColor,
} from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";
import { clickIntent, createClickTracker } from "~/ui/agenda-click";
import { useTerminalDimensions } from "@opentui/solid";
import { boxBody, boxBottom, boxTop, type Seg } from "~/ui/block-box";
import type { Task } from "~/types";

interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/** Minimal OpenTUI MouseEvent shape we touch (x, y, modifiers). */
interface MouseEventLike {
  x: number;
  y: number;
  modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean };
}

/**
 * The row of a block that resizes it: its closing rule (the row of its end time),
 * or its last body row when the block runs to the bottom of the day and has none.
 */
function handleRowOf(entry: { endRow: number }): number {
  return entry.endRow < TOTAL_ROWS ? entry.endRow : entry.endRow - 1;
}

interface TimelineViewProps {
  store: TuiStore;
  width?: number;
}

const ROW_ID_PREFIX = "tuiboard-tl-row-";
/** Minimum block duration in minutes — prevents zero-length blocks on resize. */
const MIN_BLOCK_MIN = 15;
/** Default duration applied when an armed (unscheduled) task is dropped. */
const DEFAULT_BLOCK_MIN = 30;

export function TimelineView(props: TimelineViewProps) {
  // The boxes close at the lane's right-hand edge, so the lane's width has to be
  // known: a fixed width when the Agenda sits beside the board, otherwise the
  // terminal's minus the app padding (2), the border (2) and the padding (2).
  const dims = useTerminalDimensions();
  const laneInner = () => (props.width ? props.width - 4 : Math.max(24, dims().width - 6));
  const isActive = () => props.store.state.ui.activeZone === "timeline";
  const cursor = () => props.store.state.ui.row;
  const armedRef = () => props.store.state.ui.armedTimelineRef;
  const armMode = () => props.store.state.ui.armMode;

  // Which day the Agenda is showing (today + offset). Drives task entries,
  // the calendar overlay, and the "now" line.
  const viewedDate = () => props.store.agendaDate();
  const isToday = () => props.store.state.ui.agendaOffset === 0;

  // The Google event currently selected (clicked) for edit/delete, if any.
  const selectedCal = () => props.store.state.ui.selectedCalEvent;
  const selectedCalKey = () => {
    const s = selectedCal();
    return s ? `${s.calendarId}:${s.eventId}` : undefined;
  };

  // Task entries drive the cursor + arm/keyboard interactions.
  const entries = createMemo(() => {
    props.store.state.rev; // recompute on any board mutation
    return buildTimelineEntries(
      props.store.state.boards.map((b) => b.board),
      viewedDate(),
    );
  });

  // The "To place" tray: the day's open tasks that have no hour yet. It is the
  // top of the Agenda's cursor (rows 0..n-1), the time-blocked entries follow,
  // so j/k walks both and every task key works on either.
  const tray = createMemo(() => {
    props.store.state.rev;
    return buildUnscheduledToday(
      props.store.state.boards.map((b) => b.board),
      viewedDate(),
    );
  });

  // Tell the calendar store which day to fetch whenever the viewed day changes.
  createEffect(() => {
    props.store.calendar.setActiveDate(viewedDate());
  });

  // Read-only calendar events (Google / Microsoft), merged into the grid for
  // display only — not cursor-navigable. Timed events go on the 24h grid;
  // all-day events are pulled out into a chip strip at the top (no time slot).
  const calEntries = createMemo(() =>
    buildCalendarEntries(props.store.calendar.events().filter((e) => !e.allDay)),
  );
  const allDayEvents = createMemo(() =>
    props.store.calendar.events().filter((e) => e.allDay),
  );

  // Recompute the row map every minute so the "now" marker stays current.
  // The now-line only renders on today's view (a sentinel hides it elsewhere).
  const nowMin = useNowMin();
  const rowMap = createMemo(() => {
    const merged: TimelineEntry[] = [...entries(), ...calEntries()].sort(
      (a, b) => a.startMin - b.startMin,
    );
    return buildRowMap(merged, isToday() ? nowMin() : -1);
  });

  /** Find the armed entry in the current entries list (if still present). */
  const armedEntry = createMemo<TimelineEntry | undefined>(() => {
    const ref = armedRef();
    if (!ref) return undefined;
    return entries().find(
      (e) =>
        e.ref.boardPath === ref.boardPath &&
        e.ref.columnIndex === ref.columnIndex &&
        e.ref.taskIndex === ref.taskIndex,
    );
  });

  /** The armed task itself, whether it's a scheduled block or an unscheduled. */
  const armedTask = createMemo<Task | undefined>(() => {
    const ref = armedRef();
    if (!ref) return undefined;
    return props.store.getTask(ref);
  });

  /** True when arming an unscheduled-today task (drop = create new block). */
  const armedIsUnscheduled = createMemo(() => {
    const t = armedTask();
    return !!t && !t.timeBlock;
  });

  let scrollBoxRef: ScrollBoxLike | undefined;

  // Scroll-to-now on mount.
  onMount(() => {
    setTimeout(() => {
      try {
        const target = nowRowId(rowMap().rows);
        if (target) scrollBoxRef?.scrollChildIntoView(target);
      } catch {
        // First-paint races — harmless.
      }
    }, 50);
  });

  // Scroll-to-cursor when navigation moves the cursor entry off-screen.
  // Keep the block under the cursor on screen — all of it, with a row of context,
  // not just its first row: a block at the end of the day used to end up with only
  // its first quarter of an hour showing at the bottom edge. `scrollChildIntoView`
  // moves only as far as needed, so a block that is already in view does not make
  // the grid jump.
  const revealBlock = (entry: TimelineEntry) => {
    try {
      scrollBoxRef?.scrollChildIntoView(rowIdFor(Math.min(TOTAL_ROWS - 1, entry.endRow + 1)));
      scrollBoxRef?.scrollChildIntoView(rowIdFor(Math.max(0, entry.startRow - 1)));
    } catch {
      // Child not yet mounted on first frame — harmless.
    }
  };
  createEffect(() => {
    const c = cursor() - tray().length;
    if (!isActive() || !scrollBoxRef) return;
    if (!entries()[c]) return;
    // Decide at the moment of scrolling, not when the cursor changed: a click sets
    // the zone (which parks the cursor on row 0) and then the clicked row, and
    // scrolling for each of those in turn sent the grid to the first block of the
    // day before settling on the clicked one, which then sat at the bottom edge.
    setTimeout(() => {
      const now = entries()[cursor() - tray().length];
      if (now) revealBlock(now);
    }, 0);
  });

  const cursorEntry = createMemo(() => entries()[cursor() - tray().length]);

  // One click selects, two arm (see agenda-click.ts).
  const clicks = createClickTracker();
  const sameTask = (a: TaskRef | undefined, b: TaskRef) =>
    !!a && a.boardPath === b.boardPath && a.columnIndex === b.columnIndex && a.taskIndex === b.taskIndex;
  const keyOf = (prefix: string, r: TaskRef) => `${prefix}:${r.boardPath}:${r.columnIndex}:${r.taskIndex}`;

  // A press on the armed block starts a grab: dragging the body moves it, dragging
  // its bottom edge (the handle) resizes it, and releasing without dragging is a
  // plain click that puts it at the row clicked. Positions are relative to where
  // the press landed (rows moved x 15 min), so they do not depend on where the
  // panel sits on screen.
  interface Drag {
    mode: "move" | "resize";
    ref: TaskRef;
    startY: number;
    origStart: number;
    origEnd: number;
    moved: boolean;
  }
  let drag: Drag | undefined;

  /** Leave the armed task where it is and let go, like Enter. */
  const keepArmed = () => {
    const e = armedEntry();
    props.store.endArm(true);
    props.store.flashBanner("info", e ? `✓ ${formatHm(e.startMin)}-${formatHm(e.endMin)} kept` : "Kept");
  };

  /**
   * Click on a block band. With nothing armed, one click SELECTS it (the cursor
   * moves, Enter ticks it, m/t/s/b work on it) and two ARM it. Once a task is
   * armed, a click on its own block GRABS it (a click puts it at the row clicked,
   * a drag carries it), a click on another block places the armed task at that
   * block's start, and two clicks anywhere KEEP it where the first one put it.
   * Arm mode, turned on with `c`, arms on every click. Rules: agenda-click.ts.
   */
  const onBlockClick = (entry: TimelineEntry, event: MouseEventLike, rowIndex: number) => {
    props.store.setActiveZone("timeline");

    // Calendar events can't be armed or time-block-moved. While a task is armed,
    // a click places that task at this slot (unchanged). Otherwise: an editable
    // Google event gets SELECTED for edit/delete (toggles off on re-click); a
    // read-only event just reports that it can't be changed.
    if (entry.kind !== "task") {
      if (armedRef()) {
        onEmptyRowClick(entry.startRow, event);
        return;
      }
      if (entry.kind === "calendar") {
        if (entry.editable && entry.calendarId && entry.eventId) {
          const wasSelected = selectedCalKey() === `${entry.calendarId}:${entry.eventId}`;
          props.store.selectCalEvent({
            calendarId: entry.calendarId,
            eventId: entry.eventId,
            title: entry.title,
            startMin: entry.startMin,
            endMin: entry.endMin,
            dateIso: viewedDate(),
            color: entry.color,
          });
          if (!wasSelected) {
            props.store.flashBanner("info", `Selected "${tailTruncate(entry.title, 28)}" · e edit · d delete · Esc`);
          }
        } else {
          props.store.flashBanner("info", "Read-only event — not on a writable calendar");
        }
      }
      return;
    }

    const arm = armedRef();
    const armedState = !arm ? "none" : sameTask(arm, entry.ref) ? "same" : "other";
    // Armed, a double click is "the same row twice" wherever it lands; otherwise
    // it is "the same block twice".
    const intent = clickIntent({
      kind: clicks.click(arm ? `row:${rowIndex}` : keyOf("band", entry.ref)),
      armMode: armMode(),
      armed: armedState,
      target: "band",
    });

    if (intent === "keep") {
      keepArmed();
      return;
    }
    if (intent === "place") {
      // Put the armed task where this band starts — lets the user pile two
      // blocks at the same minute (e.g. both at 9:00).
      placeArmedAt(entry.startRow, event);
      return;
    }

    const idx = entries().indexOf(entry);
    if (idx >= 0) props.store.setCursor(0, tray().length + idx);

    if (intent === "grab") {
      drag = {
        mode: rowIndex === handleRowOf(entry) ? "resize" : "move",
        ref: entry.ref,
        startY: event.y,
        origStart: entry.startMin,
        origEnd: entry.endMin,
        moved: false,
      };
    } else if (intent === "arm") {
      props.store.armTimeline(entry.ref);
      props.store.flashBanner(
        "info",
        `◉ ${formatHm(entry.startMin)}-${formatHm(entry.endMin)} · click to move · drag ↕ to resize · 2× click keep`,
      );
    }
  };

  /** Carry the grabbed block to where the pointer is (`y`), in 15-minute steps. */
  const applyDrag = (d: Drag, y: number) => {
    const steps = y - d.startY;
    if (steps !== 0) d.moved = true;
    const cur = props.store.getTask(d.ref)?.timeBlock;
    if (!cur) return;
    const delta = steps * MINS_PER_ROW;
    const DAY_END = 24 * 60 - 1;
    let next: { startMin: number; endMin: number };
    if (d.mode === "move") {
      const length = d.origEnd - d.origStart;
      const startMin = Math.max(0, Math.min(DAY_END - length, d.origStart + delta));
      next = { startMin, endMin: startMin + length };
    } else {
      next = { startMin: d.origStart, endMin: Math.max(d.origStart + MIN_BLOCK_MIN, Math.min(DAY_END, d.origEnd + delta)) };
    }
    if (next.startMin === cur.startMin && next.endMin === cur.endMin) return;
    props.store.setTimeBlock(d.ref, next);
    props.store.flashBanner("info", `${d.mode === "move" ? "✋" : "↕"} ${formatHm(next.startMin)}-${formatHm(next.endMin)}`);
  };

  /** The pointer moved with the button down after a press on the armed block. */
  const onBlockDrag = (event: MouseEventLike) => {
    if (drag) applyDrag(drag, event.y);
  };

  /** The button came up (or a drag ended) on a row of the grid. */
  const onBlockRelease = (rowIndex: number, event: MouseEventLike) => {
    const d = drag;
    if (!d) return;
    drag = undefined;
    // The release carries the pointer's last position, and the drag events alone
    // can stop a row short of it: apply it too.
    applyDrag(d, event.y);
    // A press that never dragged is a plain click: the block goes to that row.
    // On the handle a plain click does nothing; dragging is how it resizes.
    if (!d.moved && d.mode === "move" && armedRef()) placeArmedAt(rowIndex, event);
  };

  /**
   * Click on a row of the "To place" tray: one click selects it, two arm it
   * and put it in the first free half hour, exactly as `c` does. In arm mode
   * every click arms.
   */
  const onTrayClick = (index: number) => {
    const item = tray()[index];
    if (!item) return;
    props.store.setActiveZone("timeline");
    props.store.setCursor(0, index);
    const arm = armedRef();
    const intent = clickIntent({
      kind: clicks.click(keyOf("tray", item.ref)),
      armMode: armMode(),
      armed: !arm ? "none" : sameTask(arm, item.ref) ? "same" : "other",
      target: "tray",
    });
    if (intent === "arm") {
      // Arming only arms: the task stays in the tray, marked, until a click on
      // a slot (or the first j/k) says where it goes.
      props.store.armInAgenda(item.ref);
      props.store.flashBanner(
        "info",
        `◉ Armed ${tailTruncate(item.task.displayTitle, 28)} · click a slot to place it · esc cancel`,
      );
    } else if (intent === "keep") {
      keepArmed();
    }
  };

  /**
   * Click on an empty / hour row when a task is armed. Behavior depends
   * on whether the armed task already has a time block:
   *   - Has block + plain click  → MOVE start to clicked row (keep duration)
   *   - Has block + shift+click  → RESIZE end to clicked row
   *   - No block (unscheduled)   → CREATE block at clicked row, 30min default
   */
  const onEmptyRowClick = (rowIndex: number, event: MouseEventLike) => {
    if (armedRef() && clicks.click(`row:${rowIndex}`) === "double") {
      // Two clicks on the same row: the first put the armed task there, the
      // second keeps it, like Enter.
      keepArmed();
      return;
    }
    placeArmedAt(rowIndex, event);
  };

  /** Move (or create, or resize) the armed task's block to the row clicked. */
  const placeArmedAt = (rowIndex: number, event: MouseEventLike) => {
    const armed = armedTask();
    const ref = armedRef();
    if (!armed || !ref) {
      // Nothing armed. A click used to open the new-event dialog here, which is
      // how a stray click became a calendar event; the dialog is `n` now, and
      // the click says what to press instead of doing nothing.
      props.store.flashBanner("info", "Nothing armed · n adds an event · c places a task");
      return;
    }
    const targetMin = DAY_START_HOUR * 60 + rowIndex * MINS_PER_ROW;

    // Unscheduled task → create a fresh block at the clicked row.
    if (!armed.timeBlock) {
      const startMin = Math.max(0, targetMin);
      const endMin = Math.min(24 * 60 - 1, startMin + DEFAULT_BLOCK_MIN);
      // A time block only renders on the timeline when the task is also
      // scheduled for the viewed day — so arming a task from ANY board and
      // dropping it here pins it to whatever day the Agenda is showing
      // (otherwise it'd vanish: block set, wrong date).
      props.store.setScheduled(ref, viewedDate());
      props.store.setTimeBlock(ref, { startMin, endMin });
      props.store.flashBanner(
        "info",
        `⌚ ${formatHm(startMin)}-${formatHm(endMin)} · +/- length · j/k move · Enter done · Esc cancel`,
      );
      // Stays armed (#73): the default length is rarely the right one, so
      // +/- and j/k apply straight away, without re-clicking the band.
      return;
    }

    // Existing block: move (plain click) or resize (shift+click).
    const block = armed.timeBlock;
    const shift = !!event.modifiers?.shift;
    if (shift) {
      const newEnd = Math.max(block.startMin + MIN_BLOCK_MIN, targetMin);
      props.store.setTimeBlock(ref, {
        startMin: block.startMin,
        endMin: Math.min(24 * 60 - 1, newEnd),
      });
      props.store.flashBanner(
        "info",
        `↕ Resized → ${formatHm(block.startMin)}-${formatHm(newEnd)}`,
      );
    } else {
      const duration = block.endMin - block.startMin;
      const newStart = Math.max(0, targetMin);
      const newEnd = Math.min(24 * 60 - 1, newStart + duration);
      props.store.setTimeBlock(ref, { startMin: newStart, endMin: newEnd });
      props.store.flashBanner(
        "info",
        `✋ Moved → ${formatHm(newStart)}-${formatHm(newEnd)}`,
      );
    }
    // Keep armed so the user can chain adjustments. Esc to release.
  };

  return (
    <box
      style={{
        flexDirection: "column",
        width: props.width,
        minWidth: props.width,
        flexGrow: props.width ? 0 : 1,
        // A fixed width means it sits beside the board and needs the gap; a
        // full-width Agenda is alone on screen and lines up with the others.
        marginLeft: props.width ? 1 : 0,
        border: true,
        borderStyle: "rounded",
        // Arm mode paints the border warm so the special scheduling mode is
        // unmistakable, even when the keyboard focus is elsewhere.
        borderColor: armMode()
          ? T.warmActive
          : isActive()
            ? T.borderActive
            : T.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ Agenda · ${formatAgendaDay(props.store.state.ui.agendaOffset, viewedDate())} · ${entries().length}${armMode() ? "  ◉ ARM" : ""} ├`}
      titleAlignment="left"
    >
      {/* One line says what is armed; the keys that apply are on the bottom bar. */}
      <Show when={armedTask()}>
        <text selectable={false} wrapMode="none" truncate>
          <span style={{ fg: T.warmActive, attributes: ATTR.bold }}>{"◉ "}</span>
          <span style={{ fg: T.warm, attributes: ATTR.bold }}>
            {armedEntry()
              ? `${formatHm(armedEntry()!.startMin)}-${formatHm(armedEntry()!.endMin)} `
              : ""}
            {tailTruncate(armedTask()!.displayTitle, 34)}
          </span>
        </text>
      </Show>
      <Show when={armMode() && !armedTask()}>
        <text selectable={false} wrapMode="none">
          <span style={{ fg: T.warmActive, attributes: ATTR.bold }}>{"◉ ARM MODE "}</span>
          <span style={{ fg: T.textDim }}>{"click a task, then a slot"}</span>
        </text>
      </Show>
      {/* A selected calendar event shows its own action hint. */}
      <Show when={selectedCal()}>
        <text selectable={false} wrapMode="none">
          <span style={{ fg: T.warm, attributes: ATTR.bold }}>
            {"📅 "}{tailTruncate(selectedCal()!.title, 28)}{" "}
          </span>
          <span style={{ fg: T.textDim }}>
            {"  e edit · d delete · Esc deselect"}
          </span>
        </text>
      </Show>
      {/* Day-navigation hint — always visible in the resting state (not while
          arming or with an event selected) so the [ ] day-switch is
          discoverable. Off-today, the "\ today" reset is highlighted. */}
      <Show when={!armMode() && !armedTask() && !selectedCal()}>
        <text selectable={false} wrapMode="none">
          <span style={{ fg: T.warm }}>{"◷ "}</span>
          <span style={{ fg: T.textDim }}>{"[ ] change day · "}</span>
          <span style={{ fg: isToday() ? T.textDim : T.warm }}>{"\\ today"}</span>
        </text>
      </Show>
      <Show when={tray().length > 0}>
        <TrayList
          items={tray()}
          cursor={cursor()}
          active={isActive()}
          armedRef={armedRef()}
          onClickItem={onTrayClick}
        />
      </Show>
      <Show when={!armedTask() && rowMap().overflow > 0}>
        <text selectable={false} wrapMode="none">
          <span style={{ fg: T.bannerWarn }}>
            {`⚠ ${rowMap().overflow} block${rowMap().overflow === 1 ? "" : "s"} hidden by 3-way overlap`}
          </span>
        </text>
      </Show>

      {/* All-day events ride in a chip strip above the 24h grid (like Google
          Calendar's top band) — they have no time slot to sit in. Display only. */}
      <Show when={allDayEvents().length > 0}>
        <box style={{ flexDirection: "row", height: 1 }}>
          <text selectable={false} wrapMode="none" style={{ flexShrink: 0 }}>
            <span style={{ fg: T.textDim }}>{"▦ "}</span>
          </text>
          <For each={allDayEvents().slice(0, 8)}>
            {(e) => (
              <text selectable={false} wrapMode="none" truncate style={{ flexShrink: 1, marginRight: 1 }}>
                <span style={{ fg: e.color }}>{"●"}</span>
                <span style={{ fg: T.text }}>{" " + tailTruncate(e.title, 18)}</span>
              </text>
            )}
          </For>
          <Show when={allDayEvents().length > 8}>
            <text selectable={false} wrapMode="none" style={{ flexShrink: 0 }}>
              <span style={{ fg: T.textDim }}>{`+${allDayEvents().length - 8}`}</span>
            </text>
          </Show>
        </box>
      </Show>

      {/* The 24h grid owns the rest of the panel. Tasks are armed for scheduling
          from the board / planner panel via the `C` shortcut, then placed by
          clicking a slot here. */}
      <scrollbox
        ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
        style={{
          width: "100%",
          flexGrow: 1,
          // Its content is the whole day (64 rows). Left at the default basis
          // that height is what the flex algorithm starts from, and the short
          // lines above the grid (armed, day navigation, the tray) are the
          // ones squeezed to pay for it. Basis 0 hands the grid what is left.
          flexBasis: 0,
          minHeight: 0,
          scrollX: false,
          scrollY: true,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={rowMap().rows}>
          {(pair, i) => (
            <box id={rowIdFor(i())}>
              <TimelineRow
                pair={pair}
                rowIndex={i()}
                cursorEntry={isActive() ? cursorEntry() : undefined}
                armedEntry={armedEntry()}
                selectedCalKey={selectedCalKey()}
                innerWidth={laneInner()}
                onBlockClick={onBlockClick}
                onEmptyRowClick={onEmptyRowClick}
                onBlockDrag={onBlockDrag}
                onBlockRelease={onBlockRelease}
              />
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  );
}

/**
 * Bounce the kanban cursor to a specific task. Called from handleKey when
 * Enter is pressed in the timeline zone — moved out of the click handler
 * so single-click stays inside the timeline (arm only).
 */
export function jumpToKanban(store: TuiStore, ref: TaskRef): void {
  const boardIdx = store.state.boards.findIndex(
    (b) => b.board.filepath === ref.boardPath,
  );
  if (boardIdx < 0) return;
  store.setActiveBoard(boardIdx);
  // setActiveBoard resets col/row to 0, then we override.
  store.setActiveZone("board");
  // The kanban cursor uses the visible-tasks index, not the all-tasks
  // index. Compute it: visible open-tasks list, find this task's position.
  const board = store.state.boards[boardIdx]!.board;
  const col = board.columns[ref.columnIndex];
  if (!col) return;
  const allTasks = col.children.filter(
    (c): c is import("~/types").Task => !("kind" in c),
  );
  const targetTask = allTasks[ref.taskIndex];
  if (!targetTask) return;
  const openTasks = allTasks.filter((t) => !t.done);
  const visibleRow = openTasks.indexOf(targetTask);
  store.setCursor(ref.columnIndex, Math.max(0, visibleRow));
}

interface TimelineRowProps {
  pair: RowMapPair;
  rowIndex: number;
  /** When set, the cursor task — used to highlight whichever lane owns it. */
  cursorEntry: TimelineEntry | undefined;
  /** When set, the armed entry — used to tint its rows warm. */
  armedEntry: TimelineEntry | undefined;
  /** `${calendarId}:${eventId}` of the selected calendar event, if any. */
  selectedCalKey: string | undefined;
  /** Panel content width (border+padding already removed). Undefined = fullscreen. */
  innerWidth?: number;
  onBlockClick: (entry: TimelineEntry, event: MouseEventLike, rowIndex: number) => void;
  onEmptyRowClick: (rowIndex: number, event: MouseEventLike) => void;
  /** The pointer moved with the button down, after a press on the armed block. */
  onBlockDrag: (event: MouseEventLike) => void;
  /** The button came up (or the drag ended) on a row of the grid. */
  onBlockRelease: (rowIndex: number, event: MouseEventLike) => void;
}

function TimelineRow(props: TimelineRowProps) {
  const left = () => props.pair.left;
  const right = () => props.pair.right;

  // NOW marker: always full width.
  const isNow = () => left().kind === "now";
  // Right lane occupied → split row horizontally.
  const isSplit = () => right().kind !== "empty";

  // The closing rule belongs to its block but is not part of its fill: no
  // cursor, armed or selection tint on it.
  const leftIsCursor = () =>
    !!props.cursorEntry &&
    left().entry !== undefined &&
    left().kind !== "edge" &&
    left().entry === props.cursorEntry;
  const rightIsCursor = () =>
    !!props.cursorEntry &&
    right().entry !== undefined &&
    right().kind !== "edge" &&
    right().entry === props.cursorEntry;

  const leftIsBlock = () => isBlockKind(left().kind);
  const rightIsBlock = () => isBlockKind(right().kind);

  /** This lane's row belongs to the armed block, its closing rule included. */
  const leftOwnsArmed = () => !!props.armedEntry && left().entry === props.armedEntry;
  const leftIsArmed = () => leftOwnsArmed() && left().kind !== "edge";
  const rightIsArmed = () =>
    !!props.armedEntry && right().entry === props.armedEntry && right().kind !== "edge";

  const isSelectedCal = (e: TimelineEntry | undefined) =>
    !!props.selectedCalKey &&
    e?.kind === "calendar" &&
    `${e.calendarId}:${e.eventId}` === props.selectedCalKey;
  const leftIsSelCal = () => isSelectedCal(left().entry);
  const rightIsSelCal = () => isSelectedCal(right().entry);

  const entryDone = (e: TimelineEntry | undefined) =>
    e?.kind === "task" && e.task.done;
  const leftIsDone = () => entryDone(left().entry);
  const rightIsDone = () => entryDone(right().entry);

  // Cell budget per lane, so RowContent can tail-truncate the title (keeping
  // the head readable) instead of leaning on OpenTUI's middle-ellipsis.
  const innerW = () => props.innerWidth ?? 200;
  const splitLeftW = () => Math.floor((innerW() - 1) / 2);
  const splitRightW = () => innerW() - 1 - splitLeftW();

  /** Mouse handler factory for a lane cell. */
  const cellMouseDown = (cellEntry: TimelineEntry | undefined) => {
    return (event: MouseEventLike) => {
      if (cellEntry) {
        props.onBlockClick(cellEntry, event, props.rowIndex);
      } else {
        // Empty / hour / now row — placement target when armed.
        props.onEmptyRowClick(props.rowIndex, event);
      }
    };
  };

  /** Drag and release travel with the press, so they are wired wherever a press is. */
  const onDrag = (event: MouseEventLike) => props.onBlockDrag(event);
  const onRelease = (event: MouseEventLike) => props.onBlockRelease(props.rowIndex, event);

  return (
    <Show
      when={isSplit() && !isNow()}
      fallback={
        // Full-width single lane (covers empty / hour / now / single-block).
        <box
          style={{
            flexDirection: "row",
            height: 1,
            backgroundColor: laneBg(
              leftIsCursor(),
              leftIsArmed(),
              leftIsSelCal(),
              leftIsBlock(),
              leftIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
          onMouseDrag={onDrag}
          onMouseUp={onRelease}
          onMouseDragEnd={onRelease}
        >
          <text selectable={false} wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} laneWidth={innerW()} armed={leftOwnsArmed()} />
          </text>
        </box>
      }
    >
      {/* Split row: hour prefix + left lane + separator + right lane. */}
      <box
        style={{
          flexDirection: "row",
          height: 1,
        }}
      >
        <box
          style={{
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            backgroundColor: laneBg(
              leftIsCursor(),
              leftIsArmed(),
              leftIsSelCal(),
              leftIsBlock(),
              leftIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(left().entry)}
          onMouseDrag={onDrag}
          onMouseUp={onRelease}
          onMouseDragEnd={onRelease}
        >
          <text selectable={false} wrapMode="none" truncate style={{ flexGrow: 1 }}>
            <RowContent row={left()} rowIndex={props.rowIndex} laneWidth={splitLeftW()} armed={leftOwnsArmed()} />
          </text>
        </box>
        <text selectable={false} style={{ width: 1, flexShrink: 0 }} wrapMode="none">
          <span style={{ fg: T.border }}>{"╎"}</span>
        </text>
        <box
          style={{
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            backgroundColor: laneBg(
              rightIsCursor(),
              rightIsArmed(),
              rightIsSelCal(),
              rightIsBlock(),
              rightIsDone(),
            ),
          }}
          onMouseDown={cellMouseDown(right().entry)}
        >
          <text selectable={false} wrapMode="none" truncate style={{ flexGrow: 1 }}>
            {/* Right lane skips the 3-char hour prefix that's already on the row. */}
            <RowContent row={right()} rowIndex={props.rowIndex} laneWidth={splitRightW()} skipPrefix />
          </text>
        </box>
      </box>
    </Show>
  );
}

interface RowContentProps {
  row: RowMapEntry;
  rowIndex: number;
  /** When true, omit the leading 3-char hour-gutter spacer. */
  skipPrefix?: boolean;
  /** Cell budget for this lane — used to tail-truncate the block title. */
  laneWidth?: number;
  /** The armed block: its bottom edge becomes a handle to drag. */
  armed?: boolean;
}

/**
 * The gutter of a row: blank, or the hour on the rows that start one. A block
 * that covers an hour row used to hide its label; the ruler has to stay readable.
 */
function hourPrefix(rowIndex: number): string {
  if ((rowIndex * MINS_PER_ROW) % 60 !== 0) return "   ";
  return String(DAY_START_HOUR + Math.floor((rowIndex * MINS_PER_ROW) / 60)).padStart(2, "0") + " ";
}

function RowContent(props: RowContentProps) {
  const r = props.row;
  const prefix = props.skipPrefix ? "" : hourPrefix(props.rowIndex);

  if (r.kind === "now") {
    return (
      <>
        <span style={{ fg: T.overdue, attributes: ATTR.bold }}>
          {"━━ "}
          {formatHm(r.nowMin ?? 0)}{" "}
        </span>
        <span style={{ fg: T.overdue }}>{"━".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "hour") {
    // Hour anchor row: '07  ──────────' — number + horizontal grid line.
    // Gives the eye a strong tick mark to scan against.
    const label = (r.hour ?? 0).toString().padStart(2, "0");
    return (
      <>
        <span style={{ fg: T.textDim }}>{label} </span>
        <span style={{ fg: T.border }}>{"─".repeat(120)}</span>
      </>
    );
  }
  if (r.kind === "empty") {
    // 15-min sub-row: dotted '···' fill so the grid is visually
    // continuous. Reads as 'tick mark every 15 min' without competing
    // with block content (which paints on top with a solid bg color).
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <span style={{ fg: T.border }}>{"·".repeat(120)}</span>
      </>
    );
  }
  if ((r.kind === "head" || r.kind === "body" || r.kind === "fill" || r.kind === "edge") && r.entry) {
    const e = r.entry;
    // A box as wide as the lane, less the gutter: its corners land on the lane's
    // edges. The top edge is on the row of the block's start and the bottom edge on
    // the row of its end, so both line up with the grid's lines.
    const w = Math.max(8, (props.laneWidth ?? 200) - (props.skipPrefix ? 0 : 3));
    const isCal = e.kind === "calendar";
    const color = isCal ? e.color : boardColor(e.boardIndex);
    const oneRow = e.endRow - e.startRow === 1;
    const title = isCal ? e.title : e.task.displayTitle;
    const done = !isCal && e.task.done;
    // Armed can change after the row was built (the rows are kept when only the
    // armed block changes), so the segments are derived, not computed once.
    const segs = createMemo((): Seg[] => {
    if (r.kind === "head") {
      const time = `${formatHm(e.startMin)}-${formatHm(e.endMin)}`;
      const who = !isCal && e.task.assignee ? ` @${e.task.assignee}` : "";
      const prio = !isCal && e.task.priority !== "none" ? " 🔺" : "";
      const mark = isCal ? " 📅" : "";
      // A quarter of an hour is one row: the title rides in the top edge, there
      // is no body row to put it on.
      return boxTop(`${time}${who}${prio}${mark}${oneRow ? " " + title : ""}`, w, !!r.joined);
    }
    if (r.kind === "body") return boxBody(title, w, done ? "✓ " : "");
    if (r.kind === "fill") return boxBody("", w);
    return boxBottom(w, !!props.armed);
    });
    const lit = () => !!props.armed;
    const fgOf = (role: Seg["role"]) =>
      role === "border" || role === "label"
        ? lit() ? T.warmActive : color
        : role === "handle"
          ? done && r.kind === "body" ? T.done : T.warmActive
          : role === "text"
            ? isCal ? color : done ? T.done : T.text
            : undefined;
    return (
      <>
        <span style={{ fg: T.textDim }}>{prefix}</span>
        <For each={segs()}>
          {(seg) => (
            <span style={{ fg: fgOf(seg.role), attributes: seg.role === "label" ? ATTR.bold : undefined }}>
              {seg.text}
            </span>
          )}
        </For>
      </>
    );
  }
  return <span> </span>;
}

/** Local tail-truncate helper (mirrors TaskRow's). Keeps the head + `…`. */
function tailTruncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max < 2) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowIdFor(rowIndex: number): string {
  return `${ROW_ID_PREFIX}${rowIndex}`;
}

function nowRowId(rows: RowMapPair[]): string | undefined {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.left.kind === "now") return rowIdFor(i);
  }
  return undefined;
}

function isBlockKind(k: RowMapEntry["kind"]): boolean {
  return k === "head" || k === "body" || k === "fill";
}

/**
 * Pick the background color for a lane cell based on its state. Cursor wins
 * over armed, armed wins over plain "is a block row", and a non-block (hour
 * / empty / now) gets the terminal default.
 */
function laneBg(
  isCursor: boolean,
  isArmed: boolean,
  isSelectedCal: boolean,
  isBlock: boolean,
  isDone: boolean,
): string | undefined {
  if (isArmed || isSelectedCal) return T.warmDim;
  if (isCursor) return T.cardBgCursor;
  if (isBlock) return isDone ? T.cardBlockBgDone : T.cardBlockBg;
  return undefined;
}

/**
 * Reactive "minutes since midnight". Ticks once per minute via setInterval
 * so the now-line slides down throughout the day without manual refresh.
 */
function useNowMin() {
  const [now, setNow] = createSignal(getNowMin());
  const handle = setInterval(() => setNow(getNowMin()), 60_000);
  onCleanup(() => clearInterval(handle));
  return now;
}

function getNowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Imports used implicitly inside the JSX above (silence dead-import warnings).
void DAY_START_HOUR;
void MINS_PER_ROW;
void TOTAL_ROWS;

// ─── "To place" tray ────────────────────────────────────────────────────────

/** Rows of the tray drawn at once; the window follows the cursor. */
const TRAY_ROWS = 3;

function TrayList(props: {
  items: ReadonlyArray<{ ref: TaskRef; task: Task }>;
  /** The Agenda's cursor: the tray owns rows 0..items-1. */
  cursor: number;
  active: boolean;
  armedRef: TaskRef | undefined;
  onClickItem: (index: number) => void;
}) {
  const n = () => props.items.length;
  const focused = () => props.active && props.cursor < n();
  // Keep the cursor row inside the window, roughly centred.
  const start = () =>
    focused() ? Math.max(0, Math.min(n() - TRAY_ROWS, props.cursor - 1)) : 0;
  const shown = () =>
    props.items.slice(start(), start() + TRAY_ROWS).map((item, i) => ({ item, index: start() + i }));
  const isArmed = (r: TaskRef) =>
    !!props.armedRef &&
    props.armedRef.boardPath === r.boardPath &&
    props.armedRef.columnIndex === r.columnIndex &&
    props.armedRef.taskIndex === r.taskIndex;
  return (
    <box style={{ flexDirection: "column" }}>
      <text selectable={false} wrapMode="none">
        <span style={{ fg: T.warm }}>{"▤ "}</span>
        <span style={{ fg: T.textDim }}>
          {`To place · ${n()}`}
          {n() > TRAY_ROWS ? ` · ${start() + 1}-${Math.min(n(), start() + TRAY_ROWS)}` : ""}
        </span>
        <Show when={focused()}>
          <span style={{ fg: T.textDim }}>{"  c place · ⏎ done"}</span>
        </Show>
      </text>
      <For each={shown()}>
        {({ item, index }) => (
          <box
            style={{
              height: 1,
              flexDirection: "row",
              backgroundColor: props.active && index === props.cursor ? T.cardBgCursor : undefined,
            }}
            onMouseDown={() => props.onClickItem(index)}
          >
            <text selectable={false} wrapMode="none" truncate>
              <span style={{ fg: isArmed(item.ref) ? T.warmActive : T.textDim }}>
                {isArmed(item.ref) ? "◉ " : "  "}
              </span>
              <span style={{ fg: PRIORITY_COLOR[item.task.priority] }}>
                {PRIORITY_GLYPH[item.task.priority] ? PRIORITY_GLYPH[item.task.priority] + " " : ""}
              </span>
              <span style={{ fg: T.text }}>{item.task.displayTitle}</span>
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
