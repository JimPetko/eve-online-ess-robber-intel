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

test("sums all history at the low and high fill share", () => {
  // 100 kills at 500k ISK = 50M ISK of bounties at 5% and 10%; gaps do not matter.
  expect(reserveBankEstimate([hour(0, 40), hour(5, 0), hour(9, 60)], REGION, ASSUMPTIONS)).toEqual({
    low: 2_500_000,
    high: 5_000_000,
    hoursCovered: 3,
  });
});

test("empty history covers no hours", () => {
  expect(reserveBankEstimate([], REGION, ASSUMPTIONS)).toEqual({ low: 0, high: 0, hoursCovered: 0 });
});
