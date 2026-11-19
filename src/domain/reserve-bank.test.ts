import { expect, test } from "vitest";
import { reserveBankEstimate } from "./reserve-bank.ts";

const hour = (h: number, npcKills: number) => ({
  hourEnding: new Date(Date.UTC(2026, 10, 1, h)),
  npcKills,
});

test("sums all history at the low and high fill share", () => {
  // 100 kills at 500k ISK = 50M ISK of bounties; gaps do not matter.
  expect(reserveBankEstimate([hour(0, 40), hour(5, 0), hour(9, 60)], -0.1)).toEqual({
    low: 2_500_000,
    high: 10_000_000,
    hoursCovered: 3,
  });
});

test("empty history covers no hours", () => {
  expect(reserveBankEstimate([], -0.1)).toEqual({ low: 0, high: 0, hoursCovered: 0 });
});
