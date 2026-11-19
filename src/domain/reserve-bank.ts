import {
  DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill,
  type BountyAssumptions,
} from "./bounty-assumptions.ts";
import { killsByHourSlot, type HourlyKills } from "./history.ts";
import { isk, type Isk, type RegionId } from "./ids.ts";

/**
 * A floor on what a Reserve Bank gained during `hoursCovered` hours of
 * history, at the low and high reserve fill share. Never the balance: the
 * bank may hold years of older bounties, and key unlocks drain it unseen.
 */
export type ReserveBankEstimate = {
  readonly low: Isk;
  readonly high: Isk;
  readonly hoursCovered: number;
};

/** Accrual over the whole of `history`; the store decides how much it retains. */
export function reserveBankEstimate(
  history: readonly HourlyKills[],
  region: RegionId,
  assumptions: BountyAssumptions = DEFAULT_BOUNTY_ASSUMPTIONS,
): ReserveBankEstimate {
  const kills = killsByHourSlot(history);
  let totalKills = 0;
  for (const k of kills.values()) totalKills += k;
  // ISK per kill is net of the Reserve share r, so it covers (1 - r) of the
  // gross bounty, and the Reserve gained r / (1 - r) of it.
  const net = totalKills * iskPerNpcKill(region, assumptions);
  const { low, high } = assumptions.reserveFillShare;
  return {
    low: isk((net * low) / (1 - low)),
    high: isk((net * high) / (1 - high)),
    hoursCovered: kills.size,
  };
}
