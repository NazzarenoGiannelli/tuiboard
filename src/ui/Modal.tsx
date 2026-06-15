/**
 * Modal overlay router.
 *
 * Reads the active modal from the store and renders the appropriate dialog.
 * Each dialog handles its own input via the OpenTUI <input> element. Submit
 * (Enter) commits the action; Escape closes.
 *
 * Keyboard routing: when a modal is open, the OpenTUI <input> is focused, so
 * navigation keys are consumed by the input field. The main keyboard handler
 * still gets a chance for Escape, but to avoid conflicts the app's handleKey
 * checks `ui.modal` first and bails if set (only Escape passes through).
 */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { isTask } from "~/parser/markdown";
import {
  parseDateShortcut,
  parseQuickAdd,
  parseTimeBlockShortcut,
} from "~/store/parsers";
import { ATTR, T, cellWidth } from "~/ui/glyphs";
import { AGENDA_WIDTH } from "~/ui/layout";
import { formatHm } from "~/store/timeline";
import type { TuiStore } from "~/store/index";
import type { PriorityLevel, TimeBlock } from "~/types";

/** The modal panel matches the Agenda's width so it can drop into the Agenda's
 *  slot (the Dashboard renders it there while a modal is open) with no reflow. */
const MODAL_WIDTH = AGENDA_WIDTH;

export function ModalLayer(props: { store: TuiStore }) {
  const modal = createMemo(() => props.store.state.ui.modal);
  return (
    <Show when={modal()}>
      {/* Each modal's DialogShell IS the panel box (border + title + slot
          dimensions), so it drops into the Agenda's slot directly. */}
      <ModalRouter store={props.store} modal={modal()!} />
    </Show>
  );
}

function ModalRouter(props: { store: TuiStore; modal: NonNullable<TuiStore["state"]["ui"]["modal"]> }) {
  const m = props.modal;
  switch (m.kind) {
    case "add":      return <AddModal store={props.store} columnIndex={m.targetColumnIndex} />;
    case "edit":     return <EditModal store={props.store} modal={m} />;
    case "schedule": return <ScheduleModal store={props.store} modal={m} />;
    case "timeblock":return <TimeBlockModal store={props.store} modal={m} />;
    case "assign":   return <AssignModal store={props.store} modal={m} />;
    case "confirm-delete": return <ConfirmDeleteModal store={props.store} modal={m} />;
    case "detail":   return <DetailModal store={props.store} modal={m} />;
    case "agent-detail": return <AgentDetailModal store={props.store} modal={m} />;
    case "event":    return <EventModal store={props.store} />;
    case "event-edit": return <EventEditModal store={props.store} />;
    case "confirm-delete-event": return <ConfirmDeleteEventModal store={props.store} />;
    case "search":   return <SearchModal store={props.store} />;
    case "help":     return <HelpModal store={props.store} />;
  }
}

// ─── Common shell ────────────────────────────────────────────────────────────

interface DialogShellProps {
  title: string;
  hint?: string;
  children: any;
  width?: number;
}

function DialogShell(props: DialogShellProps) {
  void props.width;
  return (
    <box
      style={{
        // Byte-identical layout to the Agenda panel (TimelineView): same width,
        // marginLeft, flexGrow, border and padding, so it occupies the Agenda's
        // slot at the exact same size and the dashboard doesn't shift when a
        // modal opens. The title rides in the top border like the columns/zones.
        flexDirection: "column",
        width: MODAL_WIDTH,
        minWidth: MODAL_WIDTH,
        flexGrow: 0,
        marginLeft: 1,
        backgroundColor: T.panelBgActive,
        border: true,
        borderStyle: "rounded",
        borderColor: T.borderActive,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={`┤ ${props.title} ├`}
      titleAlignment="left"
    >
      {props.children}
      <Show when={props.hint}>
        <text>
          <span style={{ fg: T.textDim }}>{props.hint}</span>
        </text>
      </Show>
    </box>
  );
}

// ─── Add new task ────────────────────────────────────────────────────────────

function AddModal(props: { store: TuiStore; columnIndex: number }) {
  const [value, setValue] = createSignal("");

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      props.store.closeModal();
      return;
    }
    const board = props.store.state.boards[props.store.state.ui.activeBoardIndex]?.board;
    if (!board) return;
    const parsed = parseQuickAdd(trimmed);
    const ref = props.store.addTask(
      board.filepath,
      props.columnIndex,
      {
        displayTitle: parsed.title || trimmed,
        assignee: parsed.assignee,
        tags: parsed.tags,
        scheduled: parsed.scheduled,
        timeBlock: parsed.timeBlock,
        priority: parsed.priority,
      },
      "top",
    );
    if (ref) {
      props.store.setCursor(props.columnIndex, ref.taskIndex);
      props.store.flashBanner("info", `Added: ${parsed.title || trimmed}`);
    }
    props.store.closeModal();
  }

  return (
    <DialogShell
      title="New task"
      hint="Quick syntax: @assignee #tag t/m/+N HH:MM-HH:MM 🔺   ·   Enter to add, Esc to cancel"
      width={70}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => setValue(v)}
        onSubmit={((v: string) => submit(v)) as any}
      />
    </DialogShell>
  );
}

// ─── Edit existing ───────────────────────────────────────────────────────────

function EditModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "edit" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const [value, setValue] = createSignal(task?.displayTitle ?? "");

  function submit(text: string) {
    const t = text.trim();
    if (!t) {
      props.store.closeModal();
      return;
    }
    props.store.editDisplayTitle(props.modal.ref, t);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title="Edit task"
      hint="Enter to save, Esc to cancel"
      width={70}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => setValue(v)}
        onSubmit={((v: string) => submit(v)) as any}
      />
    </DialogShell>
  );
}

// ─── Schedule date ───────────────────────────────────────────────────────────

function ScheduleModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "schedule" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const markedCount = props.store.getMarkedRefs().length;
  const [value, setValue] = createSignal(task?.scheduled ?? "");
  const [error, setError] = createSignal<string | undefined>();

  function submit(text: string) {
    const d = parseDateShortcut(text);
    if (d === null) {
      setError(`Cannot parse "${text}". Try: t · m · +3 · lun · 2026-06-15`);
      return;
    }
    const n = props.store.applyToMarkedOr(props.modal.ref, (r) =>
      props.store.setScheduled(r, d ?? undefined),
    );
    if (n > 1) props.store.flashBanner("info", `${n} tasks scheduled`);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title={markedCount > 1 ? `Schedule · ${markedCount} tasks` : "Schedule"}
      hint="t = today · m = tomorrow · +3 = in 3 days · lun = next Monday · 2026-06-15 · empty/-clear · Esc to cancel"
      width={70}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => { setValue(v); setError(undefined); }}
        onSubmit={((v: string) => submit(v)) as any}
      />
      <Show when={error()}>
        <text>
          <span style={{ fg: T.bannerError }}>{error()!}</span>
        </text>
      </Show>
    </DialogShell>
  );
}

// ─── Time block ──────────────────────────────────────────────────────────────

function TimeBlockModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "timeblock" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const markedCount = props.store.getMarkedRefs().length;
  const init = task?.timeBlock
    ? `${fmtMin(task.timeBlock.startMin)}-${fmtMin(task.timeBlock.endMin)}`
    : "";
  const [value, setValue] = createSignal(init);
  const [error, setError] = createSignal<string | undefined>();

  function submit(text: string) {
    const r = parseTimeBlockShortcut(text);
    if (r === null) {
      setError(`Cannot parse "${text}". Try: n · 9:00 · 9-11 · 09:30-10:45 · - to clear`);
      return;
    }
    const n = props.store.applyToMarkedOr(props.modal.ref, (ref) =>
      props.store.setTimeBlock(ref, r ?? undefined),
    );
    if (n > 1) props.store.flashBanner("info", `${n} tasks time-blocked`);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title={markedCount > 1 ? `Time block · ${markedCount} tasks` : "Time block"}
      hint="n = now+30 · 9:00 · 9-11 · 09:30-10:45 · - to clear · Esc to cancel"
      width={70}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => { setValue(v); setError(undefined); }}
        onSubmit={((v: string) => submit(v)) as any}
      />
      <Show when={error()}>
        <text>
          <span style={{ fg: T.bannerError }}>{error()!}</span>
        </text>
      </Show>
    </DialogShell>
  );
}

// ─── New calendar event ──────────────────────────────────────────────────────

/**
 * Parse an event input line into title + time + (optional) date. Tokens are
 * peeled off the END, time first then date, so the natural order is
 * "Title [date] [time]":
 *   "Standup 9:00-9:30"          → title, 09:00-09:30, (default date)
 *   "Lunch tomorrow 12-13"       → title, 12:00-13:00, tomorrow
 *   "Review 2026-06-10 15-16"    → title, 15:00-16:00, that date
 * A trailing token is only consumed if it parses AND something is left for the
 * title, so a one-word title like "tomorrow" stays a title. `dateIso` is set
 * only when an explicit date token was found (caller falls back to its default).
 */
function peelEventInput(
  text: string,
  defStart: number,
  defEnd: number,
): { title: string; startMin: number; endMin: number; dateIso?: string; allDay: boolean } {
  let title = text.trim();
  let startMin = defStart;
  let endMin = defEnd;
  let dateIso: string | undefined;

  // 0) an "allday" / "all-day" keyword anywhere → date-only event (time ignored)
  let allDay = false;
  if (/(^|\s)(all-?day)(\s|$)/i.test(title)) {
    allDay = true;
    title = title.replace(/(^|\s)all-?day(\s|$)/i, " ").replace(/\s+/g, " ").trim();
  }

  // 1) trailing time token
  const mt = title.match(/\s(\S+)$/);
  const ttok = mt?.[1];
  if (mt && mt.index !== undefined && ttok) {
    const tb = parseTimeBlockShortcut(ttok);
    if (tb && tb.endMin > tb.startMin) {
      const rest = title.slice(0, mt.index).trim();
      if (rest) {
        title = rest;
        startMin = tb.startMin;
        endMin = tb.endMin;
      }
    }
  }
  // 2) trailing date token (on what's left)
  const md = title.match(/\s(\S+)$/);
  const dtok = md?.[1];
  if (md && md.index !== undefined && dtok) {
    const d = parseDateShortcut(dtok);
    if (typeof d === "string") {
      const rest = title.slice(0, md.index).trim();
      if (rest) {
        title = rest;
        dateIso = d;
      }
    }
  }
  return { title, startMin, endMin, dateIso, allDay };
}

/** Short "Mon 10 Jun" style label for an ISO date, for modal titles. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

/**
 * Two-step "new Google Calendar event" modal. Step 1: a title+time `<input>`
 * (time prefilled from the clicked slot; append `HH:MM-HH:MM` to override, and
 * a date token like `tomorrow` / `2026-06-10` to change the day).
 * Step 2: a non-input calendar list navigated via handleKey (no input focused),
 * preselected to the configured default. See `openEventModal` / `confirmEventPicker`.
 */
function EventModal(props: { store: TuiStore }) {
  const picker = () => props.store.state.ui.eventPicker;
  const defaultId = () => props.store.config.calendars?.google?.defaultCalendar;
  const [value, setValue] = createSignal("");
  const [error, setError] = createSignal<string | undefined>();

  function submit(text: string) {
    const p = picker();
    if (!p) return;
    const { title, startMin, endMin, dateIso, allDay } = peelEventInput(text, p.startMin, p.endMin);
    if (!title) {
      setError("Title required");
      return;
    }
    void props.store.advanceEventToStep2(title, startMin, endMin, dateIso, allDay);
  }

  return (
    <Show when={picker()}>
      <Show
        when={picker()!.step === 2}
        fallback={
          <DialogShell
            title="New event"
            hint={`${formatHm(picker()!.startMin)}-${formatHm(picker()!.endMin)} · add a time, a date (m · +3 · 2026-06-10), or "allday" · Enter add · Esc`}
          >
            <input
              focused
              value={value()}
              onInput={(v: string) => {
                setValue(v);
                setError(undefined);
              }}
              onSubmit={((v: string) => submit(v)) as any}
            />
            <Show when={error()}>
              <text>
                <span style={{ fg: T.bannerError }}>{error()!}</span>
              </text>
            </Show>
          </DialogShell>
        }
      >
        <DialogShell
          title={`Calendar · ${shortDate(picker()!.dateIso)} ${picker()!.allDay ? "all day" : `${formatHm(picker()!.startMin)}-${formatHm(picker()!.endMin)}`}`}
          hint="j/k choose · Enter create · Esc cancel"
        >
          <For each={picker()!.cals}>
            {(c, i) => {
              const isSel = () => i() === picker()!.sel;
              const isDefault = defaultId() ? c.id === defaultId() : c.primary;
              return (
                <box style={{ backgroundColor: isSel() ? T.cardBgCursor : undefined }}>
                  <text wrapMode="none" truncate>
                    <span style={{ fg: isSel() ? T.accent : T.textDim }}>
                      {isSel() ? "▶ " : "  "}
                    </span>
                    <span style={{ fg: c.color }}>{"● "}</span>
                    <span style={{ fg: T.text }}>{c.summary}</span>
                    <Show when={isDefault}>
                      <span style={{ fg: T.textDim }}>{"  (default)"}</span>
                    </Show>
                  </text>
                </box>
              );
            }}
          </For>
        </DialogShell>
      </Show>
    </Show>
  );
}

// ─── Edit existing calendar event ────────────────────────────────────────────

/**
 * Edit the selected Google Calendar event's title + time (same calendar). A
 * single `<input>` prefilled with "Title HH:MM-HH:MM"; Enter saves via PATCH.
 * Reads `ui.selectedCalEvent` (set by clicking an editable event in the Agenda).
 */
function EventEditModal(props: { store: TuiStore }) {
  const sel = () => props.store.state.ui.selectedCalEvent;
  const s0 = sel();
  const [value, setValue] = createSignal(
    s0 ? `${s0.title} ${formatHm(s0.startMin)}-${formatHm(s0.endMin)}` : "",
  );
  const [error, setError] = createSignal<string | undefined>();

  function submit(text: string) {
    const s = sel();
    if (!s) {
      props.store.closeModal();
      return;
    }
    const { title, startMin, endMin, dateIso } = peelEventInput(text, s.startMin, s.endMin);
    if (!title) {
      setError("Title required");
      return;
    }
    void props.store.confirmEventEdit(title, startMin, endMin, dateIso);
  }

  return (
    <Show when={sel()}>
      <DialogShell
        title={`Edit event · ${shortDate(sel()!.dateIso)}`}
        hint="change title, HH:MM-HH:MM, and/or a date (m · +3 · lun · 2026-06-10) · Enter save · Esc"
      >
        <input
          focused
          value={value()}
          onInput={(v: string) => {
            setValue(v);
            setError(undefined);
          }}
          onSubmit={((v: string) => submit(v)) as any}
        />
        <Show when={error()}>
          <text>
            <span style={{ fg: T.bannerError }}>{error()!}</span>
          </text>
        </Show>
      </DialogShell>
    </Show>
  );
}

// ─── Confirm delete calendar event ───────────────────────────────────────────

function ConfirmDeleteEventModal(props: { store: TuiStore }) {
  const sel = () => props.store.state.ui.selectedCalEvent;
  return (
    <DialogShell title="Delete event?" hint="⏎/y confirm · Esc/n cancel">
      <text wrapMode="none" truncate>
        <span style={{ fg: sel()?.color ?? T.text }}>{"📅 "}</span>
        <span style={{ fg: T.text }}>{sel()?.title ?? "(missing)"}</span>
        <Show when={sel()}>
          <span style={{ fg: T.textDim }}>
            {`  ${formatHm(sel()!.startMin)}-${formatHm(sel()!.endMin)}`}
          </span>
        </Show>
      </text>
      <text>
        <span style={{ fg: T.textDim }}>Deletes from Google Calendar — cannot be undone here.</span>
      </text>
    </DialogShell>
  );
}

// ─── Assign ──────────────────────────────────────────────────────────────────

function AssignModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "assign" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const markedCount = props.store.getMarkedRefs().length;
  const [value, setValue] = createSignal(task?.assignee ?? "");

  function submit(text: string) {
    const t = text.trim().replace(/^@/, "");
    const n = props.store.applyToMarkedOr(props.modal.ref, (r) =>
      props.store.setAssignee(r, t || undefined),
    );
    if (n > 1) props.store.flashBanner("info", `${n} tasks assigned`);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title={markedCount > 1 ? `Assignee — ${markedCount} selected tasks` : "Assignee"}
      hint="Name without @ · empty to clear · Esc to cancel"
      width={50}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => setValue(v)}
        onSubmit={((v: string) => submit(v)) as any}
      />
    </DialogShell>
  );
}

// ─── Confirm delete ──────────────────────────────────────────────────────────

function ConfirmDeleteModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "confirm-delete" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const markedCount = props.store.getMarkedRefs().length;
  const bulk = markedCount > 1;
  return (
    <DialogShell
      title={bulk ? `Delete ${markedCount} selected tasks?` : "Delete task?"}
      hint="⏎/y confirm · Esc/n cancel"
      width={70}
    >
      <text>
        <span style={{ fg: T.text }}>
          {bulk
            ? `${markedCount} marked tasks will be deleted.`
            : task?.displayTitle ?? "(missing)"}
        </span>
      </text>
    </DialogShell>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function DetailModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "detail" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const lb = props.store.getBoardByPath(props.modal.ref.boardPath);
  const column = lb?.board.columns[props.modal.ref.columnIndex];
  if (!task) {
    return <DialogShell title="Task not found" hint="Esc to close" width={50}><text>{" "}</text></DialogShell>;
  }
  return (
    <DialogShell title="Detail" hint="Esc to close" width={90}>
      <text wrapMode="word">
        <span style={{ fg: T.text, attributes: ATTR.bold }}>{task.displayTitle}</span>
      </text>
      <box style={{ height: 1 }} />
      <text>
        <span style={{ fg: T.textDim }}>Board:    </span>
        <span style={{ fg: T.text }}>{lb?.board.name ?? "?"} · {column?.name ?? "?"}</span>
      </text>
      <Show when={task.scheduled}>
        <text>
          <span style={{ fg: T.textDim }}>Scheduled: </span>
          <span style={{ fg: T.scheduled }}>⏳ {task.scheduled}</span>
        </text>
      </Show>
      <Show when={task.due}>
        <text>
          <span style={{ fg: T.textDim }}>Due:       </span>
          <span style={{ fg: T.scheduled }}>📅 {task.due}</span>
        </text>
      </Show>
      <Show when={task.doneDate}>
        <text>
          <span style={{ fg: T.textDim }}>Done:      </span>
          <span style={{ fg: T.textDone }}>✅ {task.doneDate}</span>
        </text>
      </Show>
      <Show when={task.timeBlock}>
        <text>
          <span style={{ fg: T.textDim }}>Time:      </span>
          <span style={{ fg: T.time }}>
            ⌚ {fmtMin(task.timeBlock!.startMin)}-{fmtMin(task.timeBlock!.endMin)}
          </span>
        </text>
      </Show>
      <Show when={task.assignee}>
        <text>
          <span style={{ fg: T.textDim }}>Assignee:  </span>
          <span style={{ fg: T.assignee }}>@{task.assignee}</span>
        </text>
      </Show>
      <Show when={task.priority !== "none"}>
        <text>
          <span style={{ fg: T.textDim }}>Priority:  </span>
          <span style={{ fg: T.highest }}>{task.priority}</span>
        </text>
      </Show>
      <Show when={task.tags.length > 0}>
        <text wrapMode="word">
          <span style={{ fg: T.textDim }}>Tags:      </span>
          <span style={{ fg: T.tag }}>{task.tags.map((t) => "#" + t).join(" ")}</span>
        </text>
      </Show>
      <Show when={task.wikilinks.length > 0}>
        <box style={{ height: 1 }} />
        <text>
          <span style={{ fg: T.textDim }}>Wikilinks (open in Obsidian):</span>
        </text>
        <For each={task.wikilinks}>
          {(link) => (
            <text wrapMode="word">
              <span style={{ fg: T.tag }}>  → [[{link}]]</span>
            </text>
          )}
        </For>
      </Show>
    </DialogShell>
  );
}

// ─── Search ──────────────────────────────────────────────────────────────────

function SearchModal(props: { store: TuiStore }) {
  const [value, setValue] = createSignal("");

  function submit(text: string) {
    const q = text.trim().toLowerCase();
    if (!q) {
      props.store.closeModal();
      return;
    }
    // First open-task match across boards, in display order.
    const boards = props.store.state.boards;
    for (let bi = 0; bi < boards.length; bi++) {
      const board = boards[bi]!.board;
      for (let ci = 0; ci < board.columns.length; ci++) {
        const col = board.columns[ci]!;
        const allTasks = col.children.filter(isTask);
        const openTasks = props.store.applyBoardFilter(
          allTasks.filter((t) => !t.done),
        );
        const matchIdx = openTasks.findIndex((t) =>
          t.displayTitle.toLowerCase().includes(q),
        );
        if (matchIdx >= 0) {
          props.store.setActiveBoard(bi);
          props.store.setActiveZone("board");
          props.store.setCursor(ci, matchIdx);
          props.store.closeModal();
          props.store.flashBanner(
            "info",
            `Found in [${board.name} · ${col.name}]`,
          );
          return;
        }
      }
    }
    props.store.flashBanner("warn", `No match for "${text}"`);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title="Search tasks"
      hint="Enter to find first match · Esc to cancel"
      width={70}
    >
      <input
        focused
        value={value()}
        onInput={(v: string) => setValue(v)}
        onSubmit={((v: string) => submit(v)) as any}
      />
    </DialogShell>
  );
}

// ─── Agent detail ────────────────────────────────────────────────────────────

function AgentDetailModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "agent-detail" }> }) {
  const session = createMemo(() =>
    props.store.agents.sessions().find((s) => s.sessionId === props.modal.sessionId),
  );
  return (
    <DialogShell title="Agent session detail" hint="Esc/o to close" width={100}>
      <Show
        when={session()}
        fallback={
          <text>
            <span style={{ fg: T.textDim }}>Session no longer present.</span>
          </text>
        }
      >
        {(s: () => NonNullable<ReturnType<typeof session>>) => (
          <box style={{ flexDirection: "column" }}>
            <text wrapMode="word">
              <span style={{ fg: T.text, attributes: ATTR.bold }}>
                {s().displayName}
              </span>
            </text>
            <box style={{ height: 1 }} />
            <text>
              <span style={{ fg: T.textDim }}>session   </span>
              <span style={{ fg: T.accent }}>{s().sessionId}</span>
            </text>
            <text>
              <span style={{ fg: T.textDim }}>status    </span>
              <span style={{ fg: T.text }}>{s().status}</span>
            </text>
            <text>
              <span style={{ fg: T.textDim }}>cwd       </span>
              <span style={{ fg: T.text }}>{s().cwd}</span>
            </text>
            <Show when={s().gitBranch}>
              <text>
                <span style={{ fg: T.textDim }}>branch    </span>
                <span style={{ fg: T.warm }}>{s().gitBranch}</span>
              </text>
            </Show>
            <text>
              <span style={{ fg: T.textDim }}>messages  </span>
              <span style={{ fg: T.text }}>
                {s().messageCount} ({s().toolCount} tool uses)
              </span>
            </text>
            <Show when={s().customTitle}>
              <text>
                <span style={{ fg: T.textDim }}>★ name    </span>
                <span style={{ fg: T.warm }}>{s().customTitle}</span>
              </text>
            </Show>
            <Show when={s().aiTitle && s().aiTitle !== s().customTitle}>
              <text>
                <span style={{ fg: T.textDim }}>ai title  </span>
                <span style={{ fg: T.text }}>{s().aiTitle}</span>
              </text>
            </Show>
            <Show when={s().lastUser}>
              <box style={{ height: 1 }} />
              <text>
                <span style={{ fg: T.textDim }}>last user prompt:</span>
              </text>
              <text wrapMode="word">
                <span style={{ fg: T.text }}>
                  {truncate(s().lastUser ?? "", 400)}
                </span>
              </text>
            </Show>
            <Show when={s().lastAssistant}>
              <box style={{ height: 1 }} />
              <text>
                <span style={{ fg: T.textDim }}>last assistant reply:</span>
              </text>
              <text wrapMode="word">
                <span style={{ fg: T.text }}>
                  {truncate(s().lastAssistant ?? "", 400)}
                </span>
              </text>
            </Show>
            <box style={{ height: 1 }} />
            <text>
              <span style={{ fg: T.textDim }}>
                resume — press Enter in the agents list to open this in WezTerm:
              </span>
            </text>
            <text wrapMode="word">
              <span style={{ fg: T.scheduled }}>
                claude --resume {s().sessionId}
              </span>
            </text>
          </box>
        )}
      </Show>
    </DialogShell>
  );
}

function truncate(s: string, n: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= n) return trimmed;
  return trimmed.slice(0, n) + "…";
}

// ─── Help ────────────────────────────────────────────────────────────────────

/**
 * Width (cells) of the key column. The longest key label is 15 cells
 * ("shift+click row"), so 16 leaves room for a one-cell separator and keeps
 * every description starting at the same column. `cellWidth` (not `.length`)
 * is used so wide arrow/emoji glyphs are budgeted correctly.
 */
const HELP_KEYW = 16;

interface HelpSection {
  emoji: string;
  title: string;
  /** Scope note shown dim under the header (kept verbatim from the original). */
  note?: string;
  /** [keyLabel, description] pairs — descriptions are verbatim. */
  rows: [string, string][];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    emoji: "🧭",
    title: "Navigation",
    rows: [
      ["h j k l  ←↑↓→", "Move cursor inside the active zone"],
      ["Tab", "Next board (kanban zone)"],
      ["1..9", "Jump to board N"],
      ["v", "Toggle Today/Tomorrow planner panel focus"],
      ["Shift-Tab", "Cycle active zone (planner → board → timeline → agents)"],
      ["F1 / F2 / F3", "Toggle visibility of Planner / Timeline / Agents zones"],
      ["z", "Zoom active zone (or column) to full screen"],
      ["r", "Refresh everything (boards from disk, agents, agenda calendar)"],
    ],
  },
  {
    emoji: "⚙️",
    title: "Task actions",
    note: "work in board, planner, AND timeline zones",
    rows: [
      ["Enter", "Toggle done"],
      ["o", "Open detail view"],
      ["e", "Edit task text"],
      ["s", "Schedule date modal (t/m/+N/lun/YYYY-MM-DD — same t/m as the board)"],
      ["t", "Set scheduled = today"],
      ["m", "Set scheduled = tomorrow"],
      [".", "Schedule now — time block at next 15-min slot (30min)"],
      ["b", "Set time block modal"],
      ["p", "Cycle priority (none → 🔺 → ⏫ → 🔼 → 🔽 → ⏬ → none)"],
      ["a", "Set assignee"],
      ["d", "Delete task (with confirm)"],
      ["X", "Archive task → moves to Archive column"],
      ["C", "Copy task to clipboard (markdown line)"],
    ],
  },
  {
    emoji: "📅",
    title: "Agenda — day navigation",
    note: "works from any zone",
    rows: [
      ["[ / ]", "Previous / next day (tasks + calendar events)"],
      ["\\", "Jump back to today"],
    ],
  },
  {
    emoji: "⏰",
    title: "Agenda — scheduling",
    rows: [
      ["n / click slot", "New Google Calendar event (needs: calendar-setup google --write) append date+time: Lunch tomorrow 12-13 · Review 2026-06-10 15-16 · Holiday 25-12 allday"],
      ["click an event", "Select an editable Google event — then e edit · d delete · Esc"],
      ["c (any zone)", "Toggle ARM MODE — then click a task, click a slot, repeat"],
      ["click empty row", "Place the armed task here (30-min block, or move if it has one)"],
      ["click band", "Arm an existing block (or place the armed task at its start)"],
      ["shift+click row", "While armed (existing block): resize end to that row"],
      ["j / k", "While armed: nudge block ±15 min"],
      ["+ / -", "While armed: resize block end ±15 min"],
      ["Enter", "While armed: commit + jump to source task"],
      ["Esc", "Disarm / exit arm mode"],
    ],
  },
  {
    emoji: "📋",
    title: "Board-only actions",
    rows: [
      ["n", "New task in current column (quick-add syntax)"],
      ["g", "Grab task — h/l then moves it between columns; g/Esc to drop"],
      ["f", "Cycle board filter: all → today → overdue → tomorrow → followup"],
      ["/", "Search task titles — jumps cursor to first match"],
    ],
  },
  {
    emoji: "🤖",
    title: "Agents zone",
    rows: [
      ["Enter", "Open (resume) the selected session in a new WezTerm tab"],
      ["o", "Session detail (cwd, branch, last prompts, resume cmd)"],
    ],
  },
  {
    emoji: "☑️",
    title: "Multi-select",
    rows: [
      ["Space", "Mark / unmark task (cursor stays — mark in any order) Every task action (done/schedule/time block/assign/priority/archive/delete) then applies to ALL marked"],
      ["Esc", "Clear the selection (when no modal is open)"],
    ],
  },
  {
    emoji: "📦",
    title: "Bulk",
    rows: [["T", "Reset ALL overdue tasks (any board) to today"]],
  },
  {
    emoji: "🌐",
    title: "Global",
    rows: [
      ["Ctrl-Z", "Undo last mutation"],
      ["?", "This help"],
      ["q · Ctrl-C", "Quit"],
    ],
  },
];

/**
 * Flattened render+scroll units: one "header" block per section (carrying its
 * optional note) followed by one "row" block per shortcut. `ui.helpScroll` is
 * an index into this list; `j`/`k` step it and the matching `<box id>` is
 * scrolled into view.
 */
type HelpBlock =
  | { kind: "header"; emoji: string; title: string; note?: string }
  | { kind: "row"; keyLabel: string; desc: string };

const HELP_BLOCKS: HelpBlock[] = HELP_SECTIONS.flatMap((s) => [
  { kind: "header", emoji: s.emoji, title: s.title, note: s.note } as HelpBlock,
  ...s.rows.map(([keyLabel, desc]) => ({ kind: "row", keyLabel, desc }) as HelpBlock),
]);

/** Dim dot leader that pads `key` out to the fixed key column (with one leading
 *  separator space). Empty for keys that already fill the column. */
function helpDots(key: string): string {
  const n = HELP_KEYW - cellWidth(key) - 1;
  return n > 0 ? "·".repeat(n) : "";
}

/** Minimal structural view of OpenTUI's <scrollbox> ref (mirrors TimelineView). */
interface ScrollBoxLike {
  scrollChildIntoView(id: string): void;
}

/**
 * Keyboard reference.
 *
 * Each shortcut is a SINGLE full-width `<text wrapMode="word">` (key + dim dot
 * leader + description as spans). A single full-width text manages its own
 * wrapped height correctly; a wrapping `<text>` placed as a flex *sibling* in a
 * row does NOT (the next row overpaints it — the "bleed-into-neighbor" glitch
 * documented in TaskRow). When a description wraps it returns to column 0 in the
 * dim description color, visually distinct from the accent key.
 *
 * The whole list lives in a `<scrollbox>` so it never clips on short terminals;
 * `j`/`k` move `ui.helpScroll` and the focused block is scrolled into view.
 */
function HelpModal(props: { store: TuiStore }) {
  let scrollBoxRef: ScrollBoxLike | undefined;

  createEffect(() => {
    const raw = props.store.state.ui.helpScroll;
    const clamped = Math.max(0, Math.min(raw, HELP_BLOCKS.length - 1));
    if (clamped !== raw) {
      props.store.setHelpScroll(clamped);
      return; // effect re-runs with the corrected value
    }
    scrollBoxRef?.scrollChildIntoView(`help-b${clamped}`);
  });

  return (
    <DialogShell title="tuiboard — keyboard reference" hint="Esc/? close · j/k scroll" width={92}>
      <scrollbox
        ref={(r: ScrollBoxLike) => (scrollBoxRef = r)}
        style={{
          width: "100%",
          flexGrow: 1,
          scrollX: false,
          scrollY: true,
          rootOptions: {},
          contentOptions: {},
          scrollbarOptions: { visible: false },
        }}
      >
        <For each={HELP_BLOCKS}>
          {(block, i) => (
            <box id={`help-b${i()}`} style={{ flexDirection: "column" }}>
              <Show when={block.kind === "header"}>
                {/* blank line above every section header except the first */}
                <Show when={i() > 0}>
                  <box style={{ height: 1 }} />
                </Show>
                <text wrapMode="none" truncate>
                  <span style={{ fg: T.warm, attributes: ATTR.bold }}>
                    {`${(block as { emoji: string }).emoji}  ${(block as { title: string }).title}`}
                  </span>
                </text>
                {/* scope note on its own wrapping line, kept verbatim */}
                <Show when={(block as { note?: string }).note}>
                  <text wrapMode="word">
                    <span style={{ fg: T.textDone, attributes: ATTR.italic }}>
                      {(block as { note: string }).note}
                    </span>
                  </text>
                </Show>
              </Show>
              <Show when={block.kind === "row"}>
                <text wrapMode="word">
                  <span style={{ fg: T.accent, attributes: ATTR.bold }}>
                    {(block as { keyLabel: string }).keyLabel}
                  </span>
                  <span style={{ fg: T.border }}>
                    {` ${helpDots((block as { keyLabel: string }).keyLabel)}`}
                  </span>
                  <span style={{ fg: T.textDim }}>
                    {` ${(block as { desc: string }).desc}`}
                  </span>
                </text>
              </Show>
            </box>
          )}
        </For>
      </scrollbox>
    </DialogShell>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
