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

import { isTask } from "~/parser/markdown";
import {
  parseDateShortcut,
  parseQuickAdd,
  parseTimeBlockShortcut,
} from "~/store/parsers";
import { ATTR, T } from "~/ui/glyphs";
import type { TuiStore } from "~/store/index";
import type { PriorityLevel, TimeBlock } from "~/types";

/** Fixed side-panel width for any modal. Wide enough for Detail / Help
 *  without being absurd for Edit / Confirm. */
const MODAL_WIDTH = 64;

export function ModalLayer(props: { store: TuiStore }) {
  const modal = createMemo(() => props.store.state.ui.modal);
  return (
    <Show when={modal()}>
      <box
        style={{
          flexDirection: "column",
          width: MODAL_WIDTH,
          minWidth: MODAL_WIDTH,
          flexGrow: 0,
          flexShrink: 0,
          // Stretch to the parent's height so the modal panel matches
          // the timeline / board zones it sits next to. Same contract as
          // every other zone — fixed cross-axis size, full-height fill.
          alignSelf: "stretch",
          marginLeft: 1,
          backgroundColor: T.panelBgActive,
          border: true,
          borderStyle: "rounded",
          borderColor: T.borderActive,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
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
    case "agent-detail": return <AgentDetailModal store={props.store} modal={m} />;
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
              <span style={{ fg: T.textDim }}>resume command (copy by hand for now):</span>
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

function HelpModal(props: { store: TuiStore }) {
  void props;
  return (
    <DialogShell title="tuiboard — keyboard reference" hint="Esc/? to close" width={92}>
      <text>
        <span style={{ fg: T.textDim }}>{"Navigation\n"}</span>
        <span style={{ fg: T.text }}>{"  h j k l  ←↑↓→     Move cursor inside the active zone\n"}</span>
        <span style={{ fg: T.text }}>{"  Tab               Next board (kanban zone)\n"}</span>
        <span style={{ fg: T.text }}>{"  1..9              Jump to board N\n"}</span>
        <span style={{ fg: T.text }}>{"  v                 Toggle Today/Tomorrow virtual panel focus\n"}</span>
        <span style={{ fg: T.text }}>{"  Shift-Tab         Cycle active zone (virtual → board → timeline → agents)\n"}</span>
        <span style={{ fg: T.text }}>{"  F1 / F2 / F3      Toggle visibility of Virtual / Timeline / Agents zones\n"}</span>
        <span style={{ fg: T.text }}>{"  z                 Zoom active zone (or column) to full screen\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nTask actions (work in board, virtual, AND timeline zones)\n"}</span>
        <span style={{ fg: T.text }}>{"  Enter             Toggle done\n"}</span>
        <span style={{ fg: T.text }}>{"  o                 Open detail view\n"}</span>
        <span style={{ fg: T.text }}>{"  e                 Edit task text\n"}</span>
        <span style={{ fg: T.text }}>{"  s                 Schedule date modal (t/tm/+N/lun/YYYY-MM-DD)\n"}</span>
        <span style={{ fg: T.text }}>{"  t                 Set scheduled = today\n"}</span>
        <span style={{ fg: T.text }}>{"  m                 Set scheduled = tomorrow\n"}</span>
        <span style={{ fg: T.text }}>{"  .                 Schedule now — time block at next 15-min slot (30min)\n"}</span>
        <span style={{ fg: T.text }}>{"  b                 Set time block modal\n"}</span>
        <span style={{ fg: T.text }}>{"  p                 Cycle priority (none → 🔺 → ⏫ → 🔼 → 🔽 → ⏬ → none)\n"}</span>
        <span style={{ fg: T.text }}>{"  a                 Set assignee\n"}</span>
        <span style={{ fg: T.text }}>{"  d                 Delete task (with confirm)\n"}</span>
        <span style={{ fg: T.text }}>{"  X                 Archive task → moves to Archive column\n"}</span>
        <span style={{ fg: T.text }}>{"  c                 Copy task to clipboard (markdown line)\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nTimeline-specific (click-to-arm scheduling)\n"}</span>
        <span style={{ fg: T.text }}>{"  click band         Arm the block (warm highlight)\n"}</span>
        <span style={{ fg: T.text }}>{"  click empty row    While armed: move block start to that row's time\n"}</span>
        <span style={{ fg: T.text }}>{"  shift+click row    While armed: resize block end to that row's time\n"}</span>
        <span style={{ fg: T.text }}>{"  j / k              While armed: nudge block ±15 min\n"}</span>
        <span style={{ fg: T.text }}>{"  + / -              While armed: resize block end ±15 min\n"}</span>
        <span style={{ fg: T.text }}>{"  Enter              While armed: commit + jump to source task\n"}</span>
        <span style={{ fg: T.text }}>{"  Esc                Disarm\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nBoard-only actions\n"}</span>
        <span style={{ fg: T.text }}>{"  n                 New task in current column (quick-add syntax)\n"}</span>
        <span style={{ fg: T.text }}>{"  g                 Grab task — h/l then moves it between columns; g/Esc to drop\n"}</span>
        <span style={{ fg: T.text }}>{"  f                 Cycle board filter: all → today → overdue → tomorrow → followup\n"}</span>
        <span style={{ fg: T.text }}>{"  /                 Search task titles — jumps cursor to first match\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nMulti-select\n"}</span>
        <span style={{ fg: T.text }}>{"  Space             Mark / unmark task — single-task actions then\n"}</span>
        <span style={{ fg: T.text }}>{"                    apply to ALL marked instead of just the cursor\n"}</span>
        <span style={{ fg: T.text }}>{"  Esc               Clear marks (when no modal is open)\n"}</span>
        <span style={{ fg: T.textDim }}>{"\nBulk\n"}</span>
        <span style={{ fg: T.text }}>{"  T                 Reset ALL overdue tasks (any board) to today\n"}</span>
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
