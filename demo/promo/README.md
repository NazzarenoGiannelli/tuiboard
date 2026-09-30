# The launch film

A 41 second, 1920x1080, 30 fps film of the real app, cut to music. Everything on screen is the
invented demo environment (`../seed.ts`): the boards, and the agent sessions (`../shots/agents.ts`).

```bash
bun run demo:film                                   # capture, placeholder track, build
bun run demo:film -- --audio track.mp3              # with your own music (see below)
python demo/promo/build.py --preview 9 36 50 66     # stills at those beats, to look at
```

Output: `demo/promo/out/tuiboard-launch.mp4` (git-ignored; review before it goes anywhere).

## How it is made

- **Frames are the real app.** The `promo` scene in `../shots/capture.tsx` drives one session of
  tuiboard headless: the four-zone dashboard, `Shift-Tab` around the zones, `z` to zoom, then the
  terminal is resized from 182 to 64 columns in 25 steps (each step is the app's own layout at that
  width, including zones dropping out) and the single-pane zones, a drag, the tray and the agent
  filter are driven with real keys and the mock mouse. Each frame carries `at`, a position in
  **beats**.
- **`build.py` composes** the gradient backdrop, the acrylic window (it follows the terminal's size
  and camera), the type and the end card, and turns beats into seconds with `t = t0 + beat * 60 / bpm`.
- **`music.py`** synthesises the placeholder track (120 BPM, 20 bars) from nothing but numpy.
  It is a stand-in and a timing reference.

The plan, in beats (a bar is 4): 0-8 intro, 8 the drop and the window, 8-28 the zone tour, 24-31 zoom,
28-32 the break, 32 second drop and the window shrinking to a single pane, 40-48 the single-pane
ring, 48 drag, 56 tray, 62 agents, 72 final hit and the end card, 83 the end.

## With a real track (Suno and the like)

`music-brief.md` has a prompt. Then:

```bash
python demo/promo/beatgrid.py track.mp3      # tempo, beat phase, and where the sections start
```

It prints the BPM, the time of the beat grid, the drops, the break and the final hit, plus an energy
table per bar so the landmarks can be checked by eye. The film then takes the track's own tempo and
phase (`--bpm`, `--t0`), and where the track's structure differs from the plan it is stretched between
landmarks so the drops and the end card land on the music's.

## Loudness

The mix is normalised to -14 LUFS (streaming level) with a -1.5 dBTP ceiling, and fades out over the
last 1.6 s.
