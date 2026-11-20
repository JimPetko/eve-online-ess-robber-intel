import { expect, test } from "vitest";
import type { HourlyKills } from "./history.ts";
import { rattingActivity } from "./ratting-activity.ts";

const T0 = Date.parse("2026-11-18T12:00:00Z");
const hour = (h: number, npcKills: number): HourlyKills => ({ hourEnding: new Date(T0 + h * 3_600_000), npcKills });

test("ranks Systems busiest first by kills over the whole history", () => {
  const quietNow = [hour(0, 300), hour(1, 250), hour(2, 0)];
  const busyNow = [hour(0, 0), hour(1, 0), hour(2, 120)];
  const idle = [hour(0, 0), hour(1, 0), hour(2, 0)];

  expect(rattingActivity([busyNow, quietNow, idle])).toEqual([
    { npcKills: 120, rank: 2, of: 3, hoursCovered: 3 },
    { npcKills: 550, rank: 1, of: 3, hoursCovered: 3 },
    { npcKills: 0, rank: 3, of: 3, hoursCovered: 3 },
  ]);
});

test("equal kills share a rank and the next rank skips", () => {
  const ranks = rattingActivity([[hour(0, 50)], [hour(0, 90)], [hour(0, 50)], [hour(0, 10)]]).map((a) => a.rank);
  expect(ranks).toEqual([2, 1, 2, 4]);
});

test("a repeated pull of the same hour counts once", () => {
  const [activity] = rattingActivity([[hour(0, 40), { hourEnding: new Date(T0 + 120_000), npcKills: 45 }, hour(1, 5)]]);
  expect(activity).toEqual({ npcKills: 50, rank: 1, of: 1, hoursCovered: 2 });
});

test("no history means no kills and no hours", () => {
  expect(rattingActivity([[]])).toEqual([{ npcKills: 0, rank: 1, of: 1, hoursCovered: 0 }]);
});
