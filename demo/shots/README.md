# Release content: pictures, video and posts

```bash
bun run demo:shots            # every scene
bun run demo:shots hero drag  # just these
```

Out come `demo/out/images/<scene>.png` (the last frame), and for scenes with several frames
`demo/out/video/<scene>.mp4` and `.gif`. Everything is the **real app**, run headless on the
invented boards in `demo/` with the clock frozen at 09:41, then drawn as a Windows Terminal
acrylic window. No real board, path or desktop ever appears. Landscape 1920x1080 for wide
terminals, portrait 1080x1350 for narrow ones.

| Scene    | Size    | Shows                                                             |
| -------- | ------- | ----------------------------------------------------------------- |
| `hero`   | 182x42  | the whole dashboard: planner, board, Agenda with nested blocks    |
| `single` | 64x36   | the single-pane Agenda with the tray and boxed blocks             |
| `drag`   | 64x36   | arm with a double click, drag to move, drag the edge to resize    |
| `tray`   | 64x36   | arm a task from the tray, click a slot, nudge it, Enter           |

## For a major release

1. Read the release's `CHANGELOG.md` section and pick the 2-3 changes that can be *seen*.
2. Add or adapt a scene in `capture.tsx` for each (drive it with real keys and the mock mouse,
   give every `frame()` a caption), and register it in `SCENES`.
3. `bun run demo:shots`, open the results and judge them. Nothing goes out unreviewed.
4. Write `demo/posts/<version>.md` from the template of the last one: the thread, which
   picture or video goes with which post, the alt text.
5. Posting is always by hand.
