# Contributing to tuiboard

Thanks for taking a look. tuiboard is a small, focused project and contributions
of any size are welcome — bug reports, docs, a fix, a feature, or just trying it
on a platform I haven't tested.

If you're not sure where to start, the [good first issues][gfi] are a good entry
point, and you can always open an issue to ask first.

[gfi]: https://github.com/NazzarenoGiannelli/tuiboard/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22

## What tuiboard is (and the rules it plays by)

A terminal kanban over **plain CommonMark** files. A few principles keep the
project coherent — please keep them in mind when proposing changes:

- **No lock-in.** Boards are plain markdown with the Obsidian Tasks-plugin emoji
  vocabulary. The on-disk format must stay readable and editable in any editor;
  parsing round-trips bit-for-bit except for the fields we own.
- **Modular.** The board is always on; the planner, agenda, and agents panels are
  each opt-in via config and must degrade gracefully when disabled.
- **Keyboard-first, mouse-friendly.** Every action has a key; mouse is a bonus,
  not a requirement.
- **Local and private.** No telemetry, no servers. Calendar credentials are
  bring-your-own and stay on the user's machine.

## Prerequisites

- [**Bun**](https://bun.sh) ≥ 1.2 — tuiboard runs on the Bun runtime (it is *not*
  a Node CLI). OpenTUI ships its own native renderer binaries; Bun picks the
  right one per platform.
- A terminal that handles 256/true-color and Unicode. Developed on WezTerm.

## Quick start

```bash
git clone https://github.com/NazzarenoGiannelli/tuiboard.git
cd tuiboard
bun install

# Run it against the bundled demo vault (fictional data, no setup needed):
cd examples && bun --preload @opentui/solid/preload ../src/app.tsx
# …or, from the repo root, the dev script (uses your own config resolution):
bun run dev
```

The `examples/` folder is a self-contained demo vault (`Work` / `Personal` /
`Home` boards) — handy for development and screenshots without touching real data.

## Checks (run these before opening a PR)

```bash
bun run typecheck     # tsc --noEmit, strict
bun test              # the test suite (parser, timeline, store, …)
bun run parse:check       # parse sample boards, report diagnostics
bun run roundtrip:check   # parse → serialize → re-parse, assert no drift
```

`prepublishOnly` runs `typecheck && test`, so a green PR is a publishable PR.

## How it fits together

```
bin/tuiboard.ts        launcher: re-execs Bun with the OpenTUI preload + splash
src/app.tsx            bootstrap: load config → build store → pick view → mount
src/config/loader.ts   config resolution ($TUIBOARD_CONFIG → .tuiboard → global → cwd)
src/parser/            markdown.ts (CommonMark → Task model) + serialize.ts (round-trip)
src/store/             reactive SolidJS store (index.ts) + calendar / timeline /
                       parsers (quick-add, date & time shortcuts) / agents / planner
src/io/                atomic board writes + external-edit watcher
src/input/handleKey.ts the single keyboard dispatcher (one key sink for the whole app)
src/ui/                components (BoardView, TimelineView, Modal, Chrome, glyphs, splash)
src/views/             root layouts (Dashboard + standalone --view= modes)
```

A few things worth knowing before a deeper change:

- **One key sink.** All keys flow through `handleKey`, which bails when a modal
  is open (except a small whitelist). If you add a modal that needs to drive keys
  without a focused `<input>`, follow the existing `event` / `confirm-delete`
  precedent rather than adding a second key handler.
- **Reduced-motion is the primary path** in any animated UI (e.g. the splash):
  render the final state first, treat motion as enhancement.
- **The parser is the contract.** If you touch `parser/`, run `roundtrip:check`
  and add a case to the parser tests — silent format drift is the one thing we
  guard hardest.

## Submitting a change

1. Open an issue first for anything non-trivial, so we can agree on the shape.
2. Branch off `main`.
3. Keep PRs focused. Add or update tests for parser / store / timeline changes.
4. Make sure `bun run typecheck` and `bun test` pass.
5. Add a short entry under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog
   style) describing the user-facing change.
6. Commits: conventional-commit style is appreciated (`feat:`, `fix:`, `docs:`…),
   but clear English wins over strict format.

I review PRs as I can; small, well-scoped changes merge fastest. Don't worry
about being new to OSS contribution — clear intent and passing checks are what
matter, and I'm happy to help shape a change in review.

## Reporting bugs & ideas

Open an [issue](https://github.com/NazzarenoGiannelli/tuiboard/issues). For bugs,
include your OS, terminal, Bun version, and the steps to reproduce. For features,
a sentence on the problem it solves is more useful than the solution.

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
