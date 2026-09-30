/**
 * The demo boards: a made-up small team shipping a made-up product, written as
 * tuiboard markdown, with every date taken relative to a given day so the boards
 * are always "today" when they are generated.
 *
 * Nothing in here is real: the names, the product and the tasks are invented, so
 * the boards can be shown, screenshotted or committed safely. They cover the
 * cases the Agenda and the planner have to get right:
 *
 *   - overdue (a few days back, one with a due date that has passed)
 *   - today without an hour (they sit in the "To place" tray)
 *   - today with a time block, including a block inside another and two that
 *     overlap in part, and blocks that touch
 *   - postponed to tomorrow, with and without a time block
 *   - coming days, weeks away, and dated only by a due date
 *   - done today and done yesterday, backlog without a date
 *
 * Run `bun demo/seed.ts` to (re)write `demo/data/`, or `bun run demo` to seed and
 * open tuiboard on it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DemoBoard {
  /** File name under `demo/data/`. */
  file: string;
  content: string;
}

/** `YYYY-MM-DD` for local `today` plus `n` days. */
export function addDays(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function todayLocal(now: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const HEADER = "---\n\nkanban-plugin: board\n\n---\n\n";

/** The boards for `today` (a `YYYY-MM-DD`). Pure: same day in, same text out. */
export function buildDemoBoards(today: string): DemoBoard[] {
  const at = (n: number) => addDays(today, n);

  const launch =
    HEADER +
    `## Todo
- [ ] Renew the nimbus.app domain 🔺 @Sam #ops ⏳ ${at(-5)} 📅 ${at(-3)}
- [ ] Reply to Priya about the pricing page ⏫ @Mia #growth ⏳ ${at(-3)}
- [ ] Fix the typo in the onboarding email #content ⏳ ${at(-2)}
- [ ] Write the release notes ⏫ #content ⏳ ${at(0)}
- [ ] Review the usage-limits PR @Sam #eng ⏳ ${at(0)}
- [ ] Standup #team ⌚ 09:00-09:15 ⏳ ${at(0)}
- [ ] Design review: onboarding @Mia #design ⌚ 10:00-11:00 ⏳ ${at(0)}
- [ ] Quick call with legal #ops ⌚ 10:30-11:00 ⏳ ${at(0)}
- [ ] Deep work: usage dashboard 🔺 @Sam #eng ⌚ 11:15-12:45 ⏳ ${at(0)}
- [ ] Call with Priya @Mia ⌚ 14:45-15:15 ⏳ ${at(0)}
- [ ] Workshop prep #growth ⌚ 15:00-16:00 ⏳ ${at(0)}
- [ ] Follow up with the newsletter editor #growth ⏳ ${at(1)}
- [ ] Plan the Friday demo @Mia #team ⌚ 09:30-10:30 ⏳ ${at(1)}
- [ ] Draft the quarterly tax estimate #ops ⏳ ${at(2)}
- [ ] Ship the 0.9 release candidate 🔺 #eng ⏳ ${at(3)} 📅 ${at(4)}

## Doing
- [ ] Migrate billing to the new provider ⏫ @Sam #eng ⏳ ${at(0)}
- [ ] Record the launch video #content ⏳ ${at(1)}

## Done
- [x] Publish the changelog #content ⏳ ${at(-1)} ✅ ${at(0)}
- [x] Merge the dark-mode fix #eng ⏳ ${at(0)} ✅ ${at(0)}
- [x] Send the March invoice #ops ⏳ ${at(-2)} ✅ ${at(-1)}

## Backlog
- [ ] Ask five users about the new dashboard #research
- [ ] Translate the docs into Italian #content
`;

  const home =
    HEADER +
    `## Todo
- [ ] Book the dentist #health ⏳ ${at(-1)}
- [ ] Water the plants #home ⏳ ${at(0)}
- [ ] Lunch walk #health ⌚ 13:00-13:30 ⏳ ${at(0)}
- [ ] Gym #health ⌚ 18:30-19:30 ⏳ ${at(0)}
- [ ] Groceries #home ⏳ ${at(1)}
- [ ] Dinner with Alex ⌚ 20:00-22:00 ⏳ ${at(4)}
- [ ] Book the flights to Lisbon ⏳ ${at(7)} 📅 ${at(10)}
- [ ] Renew the passport 🔼 📅 ${at(21)}

## Done
- [x] Call mum ⏳ ${at(0)} ✅ ${at(0)}

## Someday
- [ ] Learn to bake sourdough
`;

  const side =
    HEADER +
    `## Ideas
- [ ] Sketch the landing page #design ⏳ ${at(2)}
- [ ] Try the new charting library #eng

## Doing
- [ ] Port the prototype to Bun #eng ⏳ ${at(0)}
- [ ] Write the README #content ⏳ ${at(-2)}

## Done
- [x] Pick a name ⏳ ${at(-6)} ✅ ${at(-6)}
`;

  return [
    { file: "Launch.md", content: launch },
    { file: "Home.md", content: home },
    { file: "Side project.md", content: side },
  ];
}

/** Write the boards into `dir` (default `demo/data/`), for `today` (default: now). */
export function seedDemo(dir: string = join(here(), "data"), today: string = todayLocal()): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const b of buildDemoBoards(today)) {
    const path = join(dir, b.file);
    writeFileSync(path, b.content);
    written.push(path);
  }
  return written;
}

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

if (import.meta.main) {
  const dir = process.argv[2];
  const written = seedDemo(dir);
  console.log(`Demo boards for ${todayLocal()}:`);
  for (const w of written) console.log("  " + w);
}
