/**
 * tuiboard — Day 1 render.
 *
 * Loads boards via config, parses them, and shows a flat dashboard:
 * one column per board column, tasks listed inside. No editing yet —
 * this is the "does it render correctly?" milestone.
 */

import { readFileSync } from "node:fs";
import { For, Show, createMemo, createSignal } from "solid-js";
import { render, useKeyboard } from "@opentui/solid";

import { loadConfig } from "~/config/loader";
import { isTask, parseBoard } from "~/parser/markdown";
import type { Board, Task } from "~/types";

// ─── Data loading (one-shot for Day 1, watcher in Day 2) ────────────────────

const config = loadConfig();
if (config.boards.length === 0) {
  console.error(
    "No boards found. Create `.tuiboard/config.yaml` with a `boards:` list," +
      " or run from a directory containing markdown files with `- [ ]` tasks.",
  );
  process.exit(1);
}

const boards: Board[] = [];
for (const b of config.boards) {
  try {
    const content = readFileSync(b.path, "utf-8");
    const { board } = parseBoard(content, { filepath: b.path });
    if (b.name) board.name = b.name;
    boards.push(board);
  } catch (e) {
    console.error(`Skipping ${b.path}: ${(e as Error).message}`);
  }
}

// ─── Theme ──────────────────────────────────────────────────────────────────

const T = {
  bg: "#16161e",
  panelBg: "#1f2335",
  cardBg: "#292e42",
  cardBgDone: "#1a1b26",
  border: "#414868",
  text: "#c0caf5",
  textDim: "#737aa2",
  textDone: "#565f89",
  accent: "#7aa2f7",
  highest: "#f7768e",
  high: "#ff9e64",
  scheduled: "#e0af68",
  assignee: "#9ece6a",
  tag: "#7dcfff",
  time: "#bb9af7",
} as const;

const PRIORITY_GLYPH: Record<string, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
  none: "",
};

// ─── Components ─────────────────────────────────────────────────────────────

function TaskCard(props: { task: Task }) {
  const { task } = props;
  return (
    <box
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
        backgroundColor: task.done ? T.cardBgDone : T.cardBg,
        border: false,
      }}
    >
      <text>
        <span fg={task.done ? T.textDone : T.text}>
          {task.done ? "✓ " : "  "}
        </span>
        <Show when={task.priority !== "none"}>
          <span fg={task.priority === "highest" ? T.highest : T.high}>
            {PRIORITY_GLYPH[task.priority]}{" "}
          </span>
        </Show>
        <span fg={task.done ? T.textDone : T.text}>
          {task.displayTitle || "(empty)"}
        </span>
      </text>
      <Show when={hasMetaLine(task)}>
        <text>
          <Show when={task.timeBlock}>
            <span fg={T.time}>
              {" ⌚ "}
              {fmtMin(task.timeBlock!.startMin)}-
              {fmtMin(task.timeBlock!.endMin)}
            </span>
          </Show>
          <Show when={task.scheduled}>
            <span fg={T.scheduled}>{" ⏳ "}{task.scheduled}</span>
          </Show>
          <Show when={task.assignee}>
            <span fg={T.assignee}>{" @"}{task.assignee}</span>
          </Show>
          <For each={task.tags}>
            {(tag) => <span fg={T.tag}>{" #"}{tag}</span>}
          </For>
        </text>
      </Show>
    </box>
  );
}

function ColumnView(props: { column: import("~/types").Column; boardName: string }) {
  const tasks = createMemo(() => props.column.children.filter(isTask));
  const open = createMemo(() => tasks().filter((t) => !t.done));
  const done = createMemo(() => tasks().filter((t) => t.done));

  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 28,
        marginRight: 1,
        backgroundColor: T.panelBg,
        border: true,
        borderColor: T.border,
        padding: 1,
      }}
    >
      <text>
        <span fg={T.accent} attributes={1 /* bold */}>
          {props.column.name}
        </span>
        <span fg={T.textDim}>
          {"  "}
          {open().length} open
          <Show when={done().length > 0}>{` · ${done().length} done`}</Show>
        </span>
      </text>
      <box style={{ height: 1 }} />
      <scrollbox
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: { backgroundColor: T.panelBg },
          contentOptions: { backgroundColor: T.panelBg },
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: T.accent,
              backgroundColor: T.border,
            },
          },
        }}
      >
        <For each={tasks()}>{(task) => <TaskCard task={task} />}</For>
      </scrollbox>
    </box>
  );
}

function BoardView(props: { board: Board }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, marginBottom: 1 }}>
      <text>
        <span fg={T.text} attributes={1}>{" ▎"}{props.board.name}</span>
        <span fg={T.textDim}>{"  "}{summarize(props.board)}</span>
      </text>
      <box
        style={{
          flexDirection: "row",
          flexGrow: 1,
          marginTop: 1,
        }}
      >
        <For each={props.board.columns}>
          {(col) => <ColumnView column={col} boardName={props.board.name} />}
        </For>
      </box>
    </box>
  );
}

function App() {
  const [boardIdx, setBoardIdx] = createSignal(0);

  useKeyboard((key) => {
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      process.exit(0);
    }
    if (key.name === "tab" || key.name === "right") {
      setBoardIdx((i) => (i + 1) % boards.length);
    }
    if (key.name === "left") {
      setBoardIdx((i) => (i - 1 + boards.length) % boards.length);
    }
  });

  const current = createMemo(() => boards[boardIdx()]!);

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        padding: 1,
      }}
    >
      <text>
        <span fg={T.accent} attributes={1}>tuiboard</span>
        <span fg={T.textDim}>
          {"  "}Day 1 · {boards.length} board{boards.length === 1 ? "" : "s"} ·
          [{boardIdx() + 1}/{boards.length}]
        </span>
        <span fg={T.textDim}>{"  Tab: next board · q: quit"}</span>
      </text>
      <box style={{ height: 1 }} />
      <BoardView board={current()} />
    </box>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasMetaLine(t: Task): boolean {
  return Boolean(t.timeBlock || t.scheduled || t.assignee || t.tags.length > 0);
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

function summarize(b: Board): string {
  let total = 0;
  let done = 0;
  for (const c of b.columns) {
    for (const child of c.children) {
      if (isTask(child)) {
        total++;
        if (child.done) done++;
      }
    }
  }
  return `${total - done} open · ${done} done · ${b.columns.length} columns`;
}

// ─── Mount ──────────────────────────────────────────────────────────────────

await render(() => <App />);
