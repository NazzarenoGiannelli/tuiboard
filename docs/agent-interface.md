# Driving tuiboard from an AI agent

Boards are plain markdown, so an agent *can* open one and rewrite it. It
shouldn't. The file carries formatting, comments and plugin syntax that a
regex round trip quietly destroys, and tuiboard may be running with the same
board in memory. Two commands are the contract instead:

| | Command | Writes? |
|---|---|---|
| Read the state | `tuiboard summary` | no |
| Change a task | `tuiboard task <done\|undone\|defer\|add>` | yes, one task at a time |
| Manage boards | `tuiboard board <list\|scan\|add>` | `add` writes config |

They use the same parser, serializer and config loader as the TUI, so an agent
and the dashboard can't disagree about what a board says. No server, no MCP,
no daemon: plain processes with JSON on stdout and exit codes that mean
something.

Everything below is stable API. `tuiboard --help` is not — it's for humans.

## Reading: `tuiboard summary`

```bash
tuiboard summary              # one JSON line on stdout
tuiboard summary --pretty     # indented, for a human reading along
tuiboard summary --next 8     # how many upcoming tasks per board (default 5)
```

Shape (trimmed to one board and one entry each):

```jsonc
{
  "generatedAt": "2026-09-20T16:36:00.015Z",
  "totals": { "open": 117, "done": 336, "overdue": 13, "today": 0 },
  "boards": [
    {
      "name": "Personal",
      "path": "/home/you/vault/Tasks - Personal.md",
      "open": 16, "done": 98, "overdue": 5, "today": 0,
      "columns": [{ "name": "Home", "open": 7 }],
      "next": [
        {
          "title": "Call the plumber",
          "board": "Personal",
          "column": "Home",
          "priority": "highest",   // highest | high | medium | low | lowest | none
          "scheduled": "2026-09-17",   // "due" / "assignee" are absent when unset
          "tags": [],
          "daysUntil": -3          // negative = overdue, 0 = today, null = undated
        }
      ],
      "diagnostics": 0             // parser complaints; -1 = the file is missing
    }
  ],
  "planner": {                     // the Today/Tomorrow panel, already aggregated
    "overdue": [],
    "today": [
      {
        "title": "Record the demo",
        "board": "Personal",
        "column": "Home",
        "bucket": "agenda",        // agenda = time-blocked · priority · rest
        "priority": "none",
        "scheduled": "2026-09-18",
        "timeBlock": "09:00-09:30",
        "done": false              // the day's plan keeps finished tasks
      }
    ],
    "tomorrow": []
  }
}
```

Notes an agent should rely on:

- **`planner` is the same aggregation the TUI renders**, built by the same
  function — don't re-derive "what's due today" from `boards`, you'll drift.
- **`name` is what `--board` accepts**; `path` is where the file is, useful for
  telling the user what you changed, not for editing.
- **A board missing on disk is reported, not fatal**: zeroed counters and
  `diagnostics: -1`, so a poll every 30 s doesn't die on a moved file.
- **`daysUntil` is negative when overdue**, which is the cheapest way to sort
  "what's late" without parsing dates yourself.

## Writing: `tuiboard task`

```bash
tuiboard task done   --board Personal --column Home --match "plumber"
tuiboard task undone --board Personal --column Home --match "plumber"
tuiboard task defer  --board Personal --column Home --match "plumber" [--days 2 | --to 2026-10-01]
tuiboard task add    --board Personal --column Home --text "Call the plumber 🔺 ⏳ 2026-09-22"
```

- `--dry-run` on any of them prints what would change and writes nothing.
- `--board` matches a configured board name, else a path suffix — ambiguity is
  refused either way. `--column` matches a column name exactly (case
  insensitive); an unknown one is refused and lists the ones that exist.
- `defer` defaults to one day and moves the date the planner actually reads
  (`scheduled`, else `due`, else it adds a `scheduled`). `--days 0` pulls a
  task back to today.

### Matching is by title, never by index

There is no task id in the JSON on purpose. A position is only valid inside
one render pass; an agent holding a summary from two minutes ago would act on
whatever slid into that slot. `--match` is a case-insensitive substring of the
rendered title, and **an ambiguous match is refused** rather than guessed:

```
$ tuiboard task done --board Personal --column Home --match "call"
tuiboard task: "call" matches 3 tasks in "Home"; be more specific
```

The same rule now applies to `--board`: two boards whose paths end the same
way are a refusal, not a coin flip.

### Vocabulary for `--text`

`--text` is written to the board **verbatim**, as the body of a new
`- [ ] …` line. tuiboard doesn't interpret it at write time; the syntax below
is what it reads back out of the file afterwards — the same Obsidian Tasks
vocabulary a board already contains:

| Emoji | Meaning |
|---|---|
| `⏳ YYYY-MM-DD` | scheduled — the date the planner reads |
| `📅 YYYY-MM-DD` | due |
| `✅ YYYY-MM-DD` | completed |
| `🔺` `⏫` `🔼` `🔽` `⏬` | priority: highest → lowest |
| `#tag` | tag |
| `@name` | assignee |

Because the text is stored as written, anything tuiboard doesn't recognise
survives untouched — and a typo'd date is a task with no date, not an error at
write time. Read the board back (`summary`) if you need to confirm how a new
task parsed.

## Exit codes

| Code | Meaning | What an agent should do |
|---|---|---|
| `0` | Done (or, with `--dry-run`, would be done) | continue |
| `1` | Refused: nothing matched, or the match was ambiguous | re-read `summary`, use a longer `--match`; don't retry the same command |
| `2` | Usage error: bad or missing flags | fix the command, not the board |
| `3` | The board changed on disk between read and write | re-read `summary` and redo the decision — someone else edited it |

Exit `3` is the concurrency guard: every write checks the file's mtime against
the one it read. It means "your snapshot is stale", not "the write failed
halfway" — nothing was written.

## Rules that keep an agent out of trouble

1. **Never edit board files directly.** Use `task`. tuiboard may be open on
   the same file, and the writer is what keeps formatting and unknown syntax
   intact.
2. **Re-read before acting.** `summary` is cheap; a decision made on a
   five-minute-old snapshot is how the wrong task gets ticked.
3. **`--dry-run` first** when a step is generated rather than asked for
   literally ("clean up my overdue tasks"), and show the user the summary line
   before doing it for real.
4. **One task per call.** There is no batch mode by design: a loop that fails
   on the third task leaves a state you can describe, not a half-written file.
5. **Don't invent boards or columns.** They come from `summary`; a name that
   isn't there is a refusal (exit `1`), not a new board.

## Worked example: a morning routine

A skill or prompt that opens the day, using nothing but the two commands:

```
1. Run: tuiboard summary --pretty --next 10
2. Tell me, in three lines:
   - what's overdue (planner.overdue), oldest first by daysUntil
   - what today already holds (planner.today), and where the time blocks are
   - what's unscheduled but marked priority in boards[].next
3. Propose at most three things for today, and wait for me to agree.
4. For each one I accept, schedule it:
     tuiboard task defer --board <board> --column <column> --match "<title>" --days 0 --dry-run
   Show me the dry-run lines, then run them again without --dry-run.
5. Anything I say to push to tomorrow: same command with --days 1.
```

Two things make this safe rather than clever: the agent never writes markdown,
and every step it proposes is a command the user can read and run themselves.

## What tuiboard will not do for you

- **It won't write your status file.** If you point `status_file:` at a
  markdown file, tuiboard only reads it (`i` opens it in a dialog). An agent
  that wants to leave you a morning digest writes that file itself, with
  whatever tool it already has.
- **It has no API for arbitrary edits** — moving a task between columns,
  renaming, deleting. Those live in the TUI on purpose: they're decisions, not
  bookkeeping. If a script needs them, say so in an issue with the use case.
- **It won't tell you *why* a task is late.** That's the part a human (or an
  agent with more context than a board) is for.
