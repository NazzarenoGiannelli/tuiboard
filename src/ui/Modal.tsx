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

import { For, Show, createMemo, createSignal } from "solid-js";

import {
  parseDateShortcut,
  parseQuickAdd,
  parseTimeBlockShortcut,
} from "~/store/parsers";
import { ATTR, T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";
import type { PriorityLevel, TimeBlock } from "~/types";

export function ModalLayer(props: { store: TuiStore }) {
  const modal = createMemo(() => props.store.state.ui.modal);
  return (
    <Show when={modal()}>
      <box
        style={{
          flexDirection: "column",
          marginTop: 1,
          backgroundColor: T.panelBgActive,
          border: true,
          borderColor: T.borderActive,
          padding: 1,
        }}
      >
        <ModalRouter store={props.store} modal={modal()!} />
      </box>
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
    <box style={{ flexDirection: "column" }}>
      <text>
        <span style={{ fg: T.accent, attributes: ATTR.bold }}>{props.title}</span>
      </text>
      <box style={{ height: 1 }} />
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
      hint="Quick syntax: @assignee #tag t/tm/+N HH:MM-HH:MM 🔺   ·   Enter to add, Esc to cancel"
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
  const [value, setValue] = createSignal(task?.scheduled ?? "");
  const [error, setError] = createSignal<string | undefined>();

  function submit(text: string) {
    const d = parseDateShortcut(text);
    if (d === null) {
      setError(`Cannot parse "${text}". Try: t · tm · +3 · lun · 2026-06-15`);
      return;
    }
    props.store.setScheduled(props.modal.ref, d ?? undefined);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title={`Schedule: ${task?.displayTitle.slice(0, 50) ?? ""}`}
      hint="t = today · tm = tomorrow · +3 = in 3 days · lun = next Monday · 2026-06-15 · empty/-clear · Esc to cancel"
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
    props.store.setTimeBlock(props.modal.ref, r ?? undefined);
    props.store.closeModal();
  }

  return (
    <DialogShell
      title={`Time block: ${task?.displayTitle.slice(0, 50) ?? ""}`}
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

// ─── Assign ──────────────────────────────────────────────────────────────────

function AssignModal(props: { store: TuiStore; modal: Extract<NonNullable<TuiStore["state"]["ui"]["modal"]>, { kind: "assign" }> }) {
  const task = props.store.getTask(props.modal.ref);
  const [value, setValue] = createSignal(task?.assignee ?? "");

  function submit(text: string) {
    const t = text.trim().replace(/^@/, "");
    props.store.setAssignee(props.modal.ref, t || undefined);
    props.store.closeModal();
  }

  return (
    <DialogShell title="Assignee" hint="Name without @ · empty to clear · Esc to cancel" width={50}>
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
  return (
    <DialogShell
      title="Delete task?"
      hint="y to confirm · Esc/n to cancel"
      width={70}
    >
      <text>
        <span style={{ fg: T.text }}>{task?.displayTitle ?? "(missing)"}</span>
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

// ─── Help ────────────────────────────────────────────────────────────────────

function HelpModal(props: { store: TuiStore }) {
  void props;
  return (
    <DialogShell title="tuiboard — keyboard reference" hint="Esc/? to close" width={90}>
      <text>
        <span style={{ fg: T.textDim }}>{"Navigation\n"}</span>
        <span style={{ fg: T.text }}>{"  h j k l  ←↑↓→     Move cursor (or browse virtual panel)\n"}</span>
        <span style={{ fg: T.text }}>{"  Tab               Next board\n"}</span>
        <span style={{ fg: T.text }}>{"  1..9              Jump to board N\n"}</span>
        <span style={{ fg: T.text }}>{"  v                 Toggle Today/Tomorrow panel focus\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nSingle-task actions\n"}</span>
        <span style={{ fg: T.text }}>{"  Enter             Toggle done\n"}</span>
        <span style={{ fg: T.text }}>{"  o                 Open detail view\n"}</span>
        <span style={{ fg: T.text }}>{"  n                 New task in current column (quick-add syntax)\n"}</span>
        <span style={{ fg: T.text }}>{"  e                 Edit task text\n"}</span>
        <span style={{ fg: T.text }}>{"  s                 Schedule date modal (t/tm/+N/lun/YYYY-MM-DD)\n"}</span>
        <span style={{ fg: T.text }}>{"  t                 Set scheduled = today\n"}</span>
        <span style={{ fg: T.text }}>{"  m                 Set scheduled = tomorrow\n"}</span>
        <span style={{ fg: T.text }}>{"  b                 Set time block modal\n"}</span>
        <span style={{ fg: T.text }}>{"  a                 Set assignee\n"}</span>
        <span style={{ fg: T.text }}>{"  d                 Delete task (with confirm)\n"}</span>
        <span style={{ fg: T.text }}>{"  X                 Archive task → moves to Archive column\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nMulti-select\n"}</span>
        <span style={{ fg: T.text }}>{"  Space             Mark / unmark task — single-task actions then\n"}</span>
        <span style={{ fg: T.text }}>{"                    apply to ALL marked instead of just the cursor\n"}</span>
        <span style={{ fg: T.text }}>{"  Esc               Clear marks (when no modal is open)\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nBulk\n"}</span>
        <span style={{ fg: T.text }}>{"  T                 Reset ALL overdue tasks (any board) to today\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nView\n"}</span>
        <span style={{ fg: T.text }}>{"  z                 Zoom active panel/column to full width\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nGlobal\n"}</span>
        <span style={{ fg: T.text }}>{"  Ctrl-Z            Undo last mutation\n"}</span>
        <span style={{ fg: T.text }}>{"  ?                 This help\n"}</span>
        <span style={{ fg: T.text }}>{"  q · Ctrl-C        Quit\n"}</span>
      </text>
    </DialogShell>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
