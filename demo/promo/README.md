# The launch film

A 36 second, 1920x1080, 30 fps film of the real app, cut to a track. Everything on screen is the
invented demo environment (`../seed.ts`): the boards, and the agent sessions (`../shots/agents.ts`).

```bash
bun run demo:film                                   # capture, fit the audio, build
python demo/promo/build.py --preview 3 9 18 33      # stills at those seconds, to look at
```

Output: `demo/promo/out/tuiboard-launch.mp4` (git-ignored; review before it goes anywhere).
The track is `demo/promo/out/future-launch.mp3` (made on Suno, not in the repo); `edit_audio.py`
turns it into `film-audio.wav`. Without the mp3 the film falls back to the synthesised `music.wav`.

## How it is made

- **The pictures are the real app.** The `promo` scene in `../shots/capture.tsx` drives one session of
  tuiboard headless: the four-zone dashboard, `Shift-Tab` around the zones, `z` to zoom, the terminal
  resized from 182 to 64 columns in 20 steps (each step is the app's own layout at that width), and the
  single-pane zones, a drag, the tray, the Today triage keys and the agent filter driven with real keys
  and the mock mouse. Frames come out in named **segments** (`tour_planner`, `drag`, `filter`...), each
  tagged with the key or mouse gesture that caused it.
- **One virtual camera** (`build.py`, `render_view`) looks at the terminal; world units are cells. Only
  the cells in view are drawn, at whatever scale the camera has, so extreme close-ups stay sharp. It opens
  on three close-ups with a shallow depth of field and a slow roll, pulls back to reveal the window (the
  backdrop lights from deep blue to the brand gradient as it does), holds for a tour, follows the window as
  it narrows, then drifts gently towards what each feature is about. From the pull-back on, each state of
  the terminal is drawn once, as a sprite, and every frame is a continuous sub-pixel warp of it (redrawing
  the text at a new size every frame made it re-settle and look jerky).
- **`build.py` holds the cue sheet** (`CUES`, in seconds), the captions and the kickers. Type is
  bold throughout: JetBrains Mono for titles and tooltips (tight leading and tracking on two-line titles) and
  a bold sans for the small subtitles; the end card uses the wordmark
  the boot splash prints (`src/ui/splash.ts`).

## Pacing

The film is paced by what it is saying, not by a grid:

- a UI change of state is quick (a cursor step, a zone switch, a drag step), because a person is doing it;
- when there is something to take in (a zone, a finished block, a filtered list) it stays long enough to read;
- the brisk part is where it means something: the ring of single-pane zones, the quick scroll in triage;
- two moments are placed on the music: the drop (13.0 s) takes the window from wide to a single pane in under
  a second, the last kick (33.95 s) brings the URL in;
- nothing pulses and nothing flashes.

Timeline: 0-5 close-ups and the headline, 5-6.6 the pull-back, 6.7-12.9 the zone tour and `z`, 13 the drop and
the shrink, 14.3-15.5 the ring, 16-19.9 drag, 20.2-22.8 tray, 23.1-26.3 triage, 27-30 agents, 30.6 the window
leaves, 31-35.4 the end card, fade at 35.4.

## The music

`music-brief.md` has a Suno prompt. `Future Launch.mp3` is 50 s with a 15 s build, too long for the film, so
`edit_audio.py` starts 2.44 s in and cuts 5 bars out of the groove (seam on a bar line, where the kick lands).
Film time against track time: before the seam `film = track - 2.44`, after it `film = track - 11.96`.

For another track, measure it with

```bash
python demo/promo/beatgrid.py track.mp3
```

which prints the tempo, where the beats fall, the first drop and the last hit, and an energy table per bar.
Then set `START`, `SEAM_BAR`, `CUT_BARS` in `edit_audio.py` and move `DROP`, `SHRINK` and the times in `CUES`.

`music.py` synthesises a 120 BPM placeholder from nothing but numpy (a stand-in and a timing reference).

## Loudness

The mix is normalised to -14 LUFS (streaming level) with a -1.5 dBTP ceiling, and fades out over the
last 1.4 s.
