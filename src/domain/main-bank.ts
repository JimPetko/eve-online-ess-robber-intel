import {
  DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill,
  type BountyAssumptions,
} from "./bounty-assumptions.ts";
import { killsByHourSlot, type HourlyKills } from "./history.ts";
import { isk, type Isk, type RegionId } from "./ids.ts";

/**
 * A System's Main Bank Ceiling. When Warming Up, `ceiling` covers only the
 * hours of the Payout Cycle the history holds, so it understates the real
 * ceiling.
 */
export type MainBankCeiling =
  | { readonly status: "ready"; readonly ceiling: Isk }
  | {
      readonly status: "warmingUp";
      readonly ceiling: Isk;
      readonly hoursCovered: number;
      readonly hoursNeeded: number;
    };

/**
 * Weight of each hour in the Payout Cycle window, latest hour first. 165
 * minutes gives [1, 1, 0.75]: two full hours plus three quarters of the third.
 */
function cycleHourWeights(payoutCycleMinutes: number): number[] {
  const weights = Array<number>(Math.floor(payoutCycleMinutes / 60)).fill(1);
  const partial = (payoutCycleMinutes % 60) / 60;
  return partial > 0 ? [...weights, partial] : weights;
}

/**
 * The window ends at the latest pull in `history`. The System is Warming Up
 * unless every hour of the window has an entry.
 */
export function mainBankCeiling(
  history: readonly HourlyKills[],
  region: RegionId,
  assumptions: BountyAssumptions = DEFAULT_BOUNTY_ASSUMPTIONS,
): MainBankCeiling {
  const weights = cycleHourWeights(assumptions.payoutCycleMinutes);
  const kills = killsByHourSlot(history);
  const latest = Math.max(...kills.keys());
  let weightedKills = 0;
  let hoursCovered = 0;
  weights.forEach((weight, hoursBack) => {
    const k = kills.get(latest - hoursBack);
    if (k === undefined) return;
    weightedKills += weight * k;
    hoursCovered++;
  });
  const ceiling = isk(
    weightedKills * iskPerNpcKill(region, assumptions) * assumptions.mainBankShare,
  );
  return hoursCovered === weights.length
    ? { status: "ready", ceiling }
    : { status: "warmingUp", ceiling, hoursCovered, hoursNeeded: weights.length };
}

export function robberTake(
  ceiling: Isk,
  assumptions: BountyAssumptions = DEFAULT_BOUNTY_ASSUMPTIONS,
): Isk {
  return isk(ceiling * assumptions.robberTakeShare);
}

export type Surge = { readonly kind: "surge"; readonly delta: Isk } | { readonly kind: "none" };

/**
 * A rise of at least `threshold` between two pulls. Never a Surge while either
 * pull was Warming Up, because there the ceiling grows as history fills in,
 * not because Ratters earned more.
 */
export function surge(previous: MainBankCeiling, current: MainBankCeiling, threshold: Isk): Surge {
  if (previous.status === "warmingUp" || current.status === "warmingUp") return { kind: "none" };
  const delta = isk(current.ceiling - previous.ceiling);
  return delta > 0 && delta >= threshold ? { kind: "surge", delta } : { kind: "none" };
}

export type ConstellationCeiling = { readonly ceiling: Isk; readonly warmingUpSystems: number };

/**
 * Sum of member Systems' ceilings. Warming Up members add their partial
 * ceiling, so the sum stays a lower bound on the full one, and are counted so
 * the UI can flag an incomplete total.
 */
export function constellationCeiling(members: readonly MainBankCeiling[]): ConstellationCeiling {
  return {
    ceiling: isk(members.reduce((sum, m) => sum + m.ceiling, 0)),
    warmingUpSystems: members.filter((m) => m.status === "warmingUp").length,
  };
}
