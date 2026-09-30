# Release content: pictures, video and posts

```bash
bun run demo:shots            # every scene
bun run demo:shots hero drag  # just these
```

Out come `demo/out/images/<scene>.png` (the last frame), and for scenes with several frames
`demo/out/video/<scene>.mp4` and `.gif`. Everything is the **real app**, run headless on the
invented boards in `demo/` with the clock frozen at 09:41 (`freeze.ts`), then drawn as a Windows Terminal
acrylic window over a three-tone gradient (pale yellow, cyan, deep ink blue, as on the landing page). No real board, path or desktop ever appears. Landscape 1920x1080 for wide
terminals, portrait 1080x1350 for narrow ones. `python demo/shots/peek.py <scene>` prints the
captured frames as text, to check a scene without rendering it.

Stills (the last frame, PNG):

| Scene    | Size   | Shows                                                             |
| -------- | ------ | ----------------------------------------------------------------- |
| `hero`   | 182x42 | the whole dashboard: planner, board, Agents strip, Agenda         |
| `agenda` | 64x46  | single-pane Agenda: the tray, boxed blocks, overlaps, now line    |
| `board`  | 64x32  | single-pane board column                                          |
| `today`  | 64x36  | single-pane Today / Tomorrow                                      |
| `agents` | 64x32  | single-pane Agents: four harnesses, status glyphs, model, branch  |

Clips (MP4 + GIF, each also leaves its last frame as a PNG):

| Scene     | Size   | Shows                                                            |
| --------- | ------ | ---------------------------------------------------------------- |
| `zones`   | 182x42 | Shift-Tab across the four zones, captioned                       |
| `drag`    | 64x46  | arm with a double click, drag to move, drag the edge to resize   |
| `tray`    | 64x46  | arm a task from the tray, click a slot, nudge it, Enter          |
| `days`    | 64x46  | `]` tomorrow, `]` the day after, `\` back to today               |
| `planner` | 64x36  | `t` pull a late task in, Enter tick, `m` send to tomorrow        |
| `multi`   | 64x36  | Space marks three tasks, `t` acts on all of them                 |
| `grab`    | 64x36  | `g` grab a card, `l` carry it to the next column, `g` drop       |
| `filter`  | 64x36  | `f` filters the Agents list by harness: cc, cx, oc, pi           |

The Agents pane is fed **invented** sessions (`agents.ts`), never the ones on the machine: real
session titles carry client names and unreleased work.

## For a major release

1. Read the release's `CHANGELOG.md` section and pick the 2-3 changes that can be *seen*.
2. Add or adapt a scene in `capture.tsx` for each (drive it with real keys and the mock mouse,
   give every `frame()` a caption), and register it in `SCENES`.
3. `bun run demo:shots`, open the results and judge them. Nothing goes out unreviewed.
4. Write `demo/posts/<version>.md` from the template of the last one: the thread, which
   picture or video goes with which post, the alt text.
5. Posting is always by hand.
