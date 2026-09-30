# The launch film

A 50 second, 1920x1080, 30 fps film of the real app, cut to a track. Everything on screen is the
invented demo environment (`../seed.ts`): the boards, and the agent sessions (`../shots/agents.ts`).

```bash
bun run demo:film                                   # capture, then build
python demo/promo/build.py --preview 8 16 30 46     # stills at those seconds, to look at
```

Output: `demo/promo/out/tuiboard-launch.mp4` (git-ignored; review before it goes anywhere).
The track is `demo/promo/out/future-launch.mp3` (made on Suno, not in the repo); without it the
build falls back to the synthesised `music.wav` and its cues need re-timing.

## How it is made

- **Frames are the real app.** The `promo` scene in `../shots/capture.tsx` drives one session of
  tuiboard headless: the four-zone dashboard, `Shift-Tab` around the zones, `z` to zoom, then the
  terminal is resized from 182 to 64 columns in 20 steps (each step is the app's own layout at that
  width, zones dropping out as it narrows), and the single-pane zones, a drag, the tray, the Today
  triage keys and the agent filter are driven with real keys and the mock mouse. Frames come out in
  named **segments** (`tour_planner`, `drag`, `filter`...).
- **`build.py` holds the cue sheet** (`CUES`, in seconds): when each segment's frames appear. It also
  composes the gradient backdrop, the acrylic window (it follows the terminal's size), the type and
  the end card, whose wordmark is the one the boot splash prints (`src/ui/splash.ts`).

## Pacing

The film is paced by what it is saying, not by a grid:

- a UI change of state is quick (a cursor step, a zone switch, a drag step), because a person is doing it;
- when there is something to take in (a zone, a finished block, a filtered list) it stays long enough to read;
- the brisk part is where it means something: the ring of single-pane zones, the quick scroll in triage;
- a few moments are placed on the music: the drop (15.4 s) takes the window from wide to a single pane
  in under a second, the last kick (45.9 s) brings the URL in;
- nothing pulses and nothing flashes.

Timeline: 0-6 typed headline, 6.6 the window arrives, 7.7-13.4 the zone tour, 13.8-15.2 `z` zoom, 15.4 the
drop and the shrink, 17-18.7 the ring, 19.3-24.6 drag, 25.3-29.4 tray, 30.2-34.9 triage, 35.9-40.8 agents,
41.3 the window leaves, 42.5-47 the end card, fade at 47.9.

## Another track

`music-brief.md` has a Suno prompt. Measure a track with

```bash
python demo/promo/beatgrid.py track.mp3
```

which prints the tempo, where the beats fall, the first drop and the last hit, and an energy table per
bar. Then move `DROP`, `SHRINK` and the times in `CUES` in `build.py` to match, and set `DURATION`.

`music.py` synthesises a 120 BPM placeholder from nothing but numpy (a stand-in and a timing reference).

## Loudness

The mix is normalised to -14 LUFS (streaming level) with a -1.5 dBTP ceiling, and fades out over the
last 1.6 s.
