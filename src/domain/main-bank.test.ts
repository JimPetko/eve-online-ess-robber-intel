import { expect, test } from "vitest";
import { DEFAULT_BOUNTY_ASSUMPTIONS } from "./bounty-assumptions.ts";
import type { HourlyKills } from "./history.ts";
import { isk } from "./ids.ts";
import {
  constellationCeiling,
  mainBankCeiling,
  robberTake,
  surge,
  type MainBankCeiling,
} from "./main-bank.ts";

// Security -0.1: 500k ISK per kill x 0.40 Main Bank share = 200k ISK per kill.
const SEC = -0.1;
const LATEST = Date.UTC(2026, 10, 18, 12);
const HOUR = 3_600_000;

/** kills[0] is the latest hour; `undefined` leaves a gap. */
function history(...kills: (number | undefined)[]): HourlyKills[] {
  return kills.flatMap((npcKills, hoursBack) =>
    npcKills === undefined ? [] : [{ hourEnding: new Date(LATEST - hoursBack * HOUR), npcKills }],
  );
}

test("counts two full hours and 0.75 of the third", () => {
  expect(mainBankCeiling(history(10, 10, 4), SEC)).toEqual({
    status: "ready",
    ceiling: (10 + 10 + 0.75 * 4) * 200_000,
  });
});

test("ignores hours older than the Payout Cycle", () => {
  expect(mainBankCeiling(history(10, 10, 4, 999, 999), SEC)).toEqual(
    mainBankCeiling(history(10, 10, 4), SEC),
  );
});

test("does not depend on history order", () => {
  expect(mainBankCeiling(history(10, 10, 4).reverse(), SEC)).toEqual(
    mainBankCeiling(history(10, 10, 4), SEC),
  );
});

test("lands pulls a few minutes off the hour in the same slot", () => {
  const drifted = history(10, 10, 4).map((h, i) => ({
    ...h,
    hourEnding: new Date(h.hourEnding.getTime() + (i + 1) * 4 * 60_000),
  }));
  expect(mainBankCeiling(drifted, SEC)).toEqual(mainBankCeiling(history(10, 10, 4), SEC));
});

test("0-kill hours count as data", () => {
  expect(mainBankCeiling(history(0, 0, 0), SEC)).toEqual({ status: "ready", ceiling: 0 });
});

test("a gap in the window means Warming Up with the partial ceiling", () => {
  expect(mainBankCeiling(history(10, undefined, 4, 7), SEC)).toEqual({
    status: "warmingUp",
    ceiling: (10 + 0.75 * 4) * 200_000,
    hoursCovered: 2,
    hoursNeeded: 3,
  });
});

test("less than a cycle of history means Warming Up", () => {
  expect(mainBankCeiling(history(10, 10), SEC)).toEqual({
    status: "warmingUp",
    ceiling: 20 * 200_000,
    hoursCovered: 2,
    hoursNeeded: 3,
  });
});

test("empty history is Warming Up at zero", () => {
  expect(mainBankCeiling([], SEC)).toEqual({
    status: "warmingUp",
    ceiling: 0,
    hoursCovered: 0,
    hoursNeeded: 3,
  });
});

test("the window follows payoutCycleMinutes", () => {
  const threeHours = { ...DEFAULT_BOUNTY_ASSUMPTIONS, payoutCycleMinutes: 180 };
  expect(mainBankCeiling(history(1, 1, 1, 1), SEC, threeHours)).toEqual({
    status: "ready",
    ceiling: 3 * 200_000,
  });
});

test("deeper security pays more per kill", () => {
  expect(mainBankCeiling(history(10, 10, 4), -0.9)).toEqual({
    status: "ready",
    ceiling: 11_040_000, // 23 weighted kills x 1.2M ISK x 0.40
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
