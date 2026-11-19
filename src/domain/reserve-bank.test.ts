import { expect, test } from "vitest";
import { DEFAULT_BOUNTY_ASSUMPTIONS, type BountyAssumptions } from "./bounty-assumptions.ts";
import { isk, regionId } from "./ids.ts";
import { reserveBankEstimate } from "./reserve-bank.ts";

const REGION = regionId(10000003);
const ASSUMPTIONS: BountyAssumptions = {
  ...DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill: { byRegion: new Map([[REGION, isk(500_000)]]), fallback: isk(300_000) },
};

const hour = (h: number, npcKills: number) => ({
  hourEnding: new Date(Date.UTC(2026, 10, 1, h)),
  npcKills,
});

test("grosses up net bounties by the low and high fill share", () => {
  // 100 kills at 500k ISK = 50M ISK net of the Reserve share; gaps do not matter.
  // Gross = net / (1 - r), so the Reserve gains 50M x 0.05/0.95 and 50M x 0.10/0.90.
  // At r = 0.10 that is 11.11% of the net figure, not 10%.
  expect(reserveBankEstimate([hour(0, 40), hour(5, 0), hour(9, 60)], REGION, ASSUMPTIONS)).toEqual({
    low: 2_631_579,
    high: 5_555_556,
    hoursCovered: 3,
  });
});

test("empty history covers no hours", () => {
  expect(reserveBankEstimate([], REGION, ASSUMPTIONS)).toEqual({ low: 0, high: 0, hoursCovered: 0 });
});
