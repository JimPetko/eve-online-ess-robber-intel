import { expect, test } from "vitest";
import { DEFAULT_BOUNTY_ASSUMPTIONS, type BountyAssumptions } from "./bounty-assumptions.ts";
import type { HourlyKills } from "./history.ts";
import { isk, regionId } from "./ids.ts";
import {
  constellationCeiling,
  mainBankCeiling,
  robberTake,
  surge,
  type MainBankCeiling,
} from "./main-bank.ts";

const CALIBRATED = regionId(10000003);
const UNCALIBRATED = regionId(10000023);
// CALIBRATED: 500k ISK per kill x 0.40 Main Bank share = 200k ISK per kill.
const ASSUMPTIONS: BountyAssumptions = {
  ...DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill: { byRegion: new Map([[CALIBRATED, isk(500_000)]]), fallback: isk(300_000) },
};
const ceiling = (h: HourlyKills[], assumptions = ASSUMPTIONS) => mainBankCeiling(h, CALIBRATED, assumptions);
const LATEST = Date.UTC(2026, 10, 18, 12);
const HOUR = 3_600_000;

/** kills[0] is the latest hour; `undefined` leaves a gap. */
function history(...kills: (number | undefined)[]): HourlyKills[] {
  return kills.flatMap((npcKills, hoursBack) =>
    npcKills === undefined ? [] : [{ hourEnding: new Date(LATEST - hoursBack * HOUR), npcKills }],
  );
}

test("counts two full hours and 0.75 of the third", () => {
  expect(ceiling(history(10, 10, 4))).toEqual({
    status: "ready",
    ceiling: (10 + 10 + 0.75 * 4) * 200_000,
  });
});

test("ignores hours older than the Payout Cycle", () => {
  expect(ceiling(history(10, 10, 4, 999, 999))).toEqual(
    ceiling(history(10, 10, 4)),
  );
});

test("does not depend on history order", () => {
  expect(ceiling(history(10, 10, 4).reverse())).toEqual(
    ceiling(history(10, 10, 4)),
  );
});

test("lands pulls a few minutes off the hour in the same slot", () => {
  const drifted = history(10, 10, 4).map((h, i) => ({
    ...h,
    hourEnding: new Date(h.hourEnding.getTime() + (i + 1) * 4 * 60_000),
  }));
  expect(ceiling(drifted)).toEqual(ceiling(history(10, 10, 4)));
});

test("0-kill hours count as data", () => {
  expect(ceiling(history(0, 0, 0))).toEqual({ status: "ready", ceiling: 0 });
});

test("a gap in the window means Warming Up with the partial ceiling", () => {
  expect(ceiling(history(10, undefined, 4, 7))).toEqual({
    status: "warmingUp",
    ceiling: (10 + 0.75 * 4) * 200_000,
    hoursCovered: 2,
    hoursNeeded: 3,
  });
});

test("less than a cycle of history means Warming Up", () => {
  expect(ceiling(history(10, 10))).toEqual({
    status: "warmingUp",
    ceiling: 20 * 200_000,
    hoursCovered: 2,
    hoursNeeded: 3,
  });
});

test("empty history is Warming Up at zero", () => {
  expect(ceiling([])).toEqual({
    status: "warmingUp",
    ceiling: 0,
    hoursCovered: 0,
    hoursNeeded: 3,
  });
});

test("the window follows payoutCycleMinutes", () => {
  const threeHours = { ...ASSUMPTIONS, payoutCycleMinutes: 180 };
  expect(ceiling(history(1, 1, 1, 1), threeHours)).toEqual({
    status: "ready",
    ceiling: 3 * 200_000,
  });
});

test("a Region outside the calibration is priced at the fallback", () => {
  expect(mainBankCeiling(history(10, 10, 4), UNCALIBRATED, ASSUMPTIONS)).toEqual({
    status: "ready",
    ceiling: 2_760_000, // 23 weighted kills x 300k ISK x 0.40
  });
});

test("Robber Take is 80% of the ceiling", () => {
  expect(robberTake(isk(10_000_000))).toBe(8_000_000);
});

const ready = (ceiling: number): MainBankCeiling => ({ status: "ready", ceiling: isk(ceiling) });
const THRESHOLD = isk(20_000_000);

test("a rise exactly at the threshold is a Surge carrying the delta", () => {
  expect(surge(ready(5_000_000), ready(25_000_000), THRESHOLD)).toEqual({
    kind: "surge",
    delta: 20_000_000,
  });
});

test("a rise just under the threshold is not a Surge", () => {
  expect(surge(ready(5_000_000), ready(24_999_999), THRESHOLD)).toEqual({ kind: "none" });
});

test("a drop is never a Surge, even with a zero threshold", () => {
  expect(surge(ready(30_000_000), ready(0), isk(0))).toEqual({ kind: "none" });
  expect(surge(ready(30_000_000), ready(30_000_000), isk(0))).toEqual({ kind: "none" });
});

test("no Surge while either pull is Warming Up", () => {
  const warming: MainBankCeiling = {
    status: "warmingUp",
    ceiling: isk(0),
    hoursCovered: 0,
    hoursNeeded: 3,
  };
  expect(surge(warming, ready(100_000_000), THRESHOLD)).toEqual({ kind: "none" });
});

test("constellation sums every member and counts Warming Up ones", () => {
  expect(
    constellationCeiling([
      ready(10_000_000),
      ready(5_000_000),
      { status: "warmingUp", ceiling: isk(2_000_000), hoursCovered: 1, hoursNeeded: 3 },
    ]),
  ).toEqual({ ceiling: 17_000_000, warmingUpSystems: 1 });
});
