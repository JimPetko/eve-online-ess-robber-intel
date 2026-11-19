import {
  DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill,
  type BountyAssumptions,
} from "./bounty-assumptions.ts";
import { killsByHourSlot, type HourlyKills } from "./history.ts";
import { isk, type Isk } from "./ids.ts";

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
  securityStatus: number,
  assumptions: BountyAssumptions = DEFAULT_BOUNTY_ASSUMPTIONS,
): ReserveBankEstimate {
  const kills = killsByHourSlot(history);
  let totalKills = 0;
  for (const k of kills.values()) totalKills += k;
  const bounties = totalKills * iskPerNpcKill(securityStatus, assumptions);
  return {
    low: isk(bounties * assumptions.reserveFillShare.low),
    high: isk(bounties * assumptions.reserveFillShare.high),
    hoursCovered: kills.size,
  };
}
