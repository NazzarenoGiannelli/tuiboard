# The demo environment

Invented boards for a made-up team shipping a made-up product. Nothing here comes from a real
setup, so it can be shown, screenshotted or committed. Every date is relative to *today*, so the
boards are always current.

```bash
bun run demo            # write the boards for today and open tuiboard on them
bun run demo:seed       # only write demo/data/ (it is git-ignored)
TUIBOARD_CONFIG=demo/config.yaml tuiboard   # open it with the installed tuiboard
```

It has overdue tasks, today's tasks with and without an hour, a block inside another, blocks that
overlap in part and blocks that touch, tasks postponed to tomorrow, coming days and weeks, due
dates, done tasks and an undated backlog: `demo/seed.ts` lists them. Re-seed to start over after
playing with it. The calendar and the agents zone are off on purpose.

`demo/out/` (git-ignored) is where generated images and videos go.
