import { isk, regionId, type Isk, type RegionId } from "./ids.ts";
import { ISK_PER_NPC_KILL_CALIBRATION } from "./isk-per-npc-kill.generated.ts";

export type BountyAssumptions = {
  readonly payoutCycleMinutes: number;
  readonly mainBankShare: number;
  readonly robberTakeShare: number;
  readonly reserveFillShare: { readonly low: number; readonly high: number };
  /**
   * ISK of bounty per ESI NPC kill, after the Dynamic Bounty System and
   * including the ESS share, so neither is applied again. Regions missing
   * from `byRegion` use `fallback`.
   */
  readonly iskPerNpcKill: { readonly byRegion: ReadonlyMap<RegionId, Isk>; readonly fallback: Isk };
};

export const DEFAULT_BOUNTY_ASSUMPTIONS: BountyAssumptions = {
  // Patch 19.03 (2021-04-13) set the Main Bank autopay to 2h45m. Confidence high.
  payoutCycleMinutes: 165,
  // Share of each bounty that lands in the Main Bank. The October 2026 MER has
  // ESS Main Bank autopay at about 0.40 of sov-null bounties, which rules out
  // the 0.35 player figure. Confidence medium-high
  // (docs/research/bounty-calibration.md).
  mainBankShare: 0.4,
  // Share of the Main Bank a Robber walks away with. EVE University wiki; it
  // was 0.70 at launch in 2020. Confidence medium.
  robberTakeShare: 0.8,
  // Share of each bounty that lands in the Reserve Bank. CCP never published
  // it. The only player figure is 0.05 (a 35/5 split); 0.20 assumed an equal
  // split of a 40% ESS cut, which the MER rules out because the Main Bank alone
  // takes about 0.40. Confidence low (docs/research/bounty-calibration.md).
  reserveFillShare: { low: 0.05, high: 0.1 },
  // Calibrated per Region from CCP's Monthly Economic Report; rerun
  // scripts/calibrate-bounties.mjs each month. Confidence medium-high per
  // Region, low for any one System-hour.
  iskPerNpcKill: {
    byRegion: new Map(
      ISK_PER_NPC_KILL_CALIBRATION.regions.map((r) => [regionId(r.regionId), isk(r.iskPerNpcKill)]),
    ),
    fallback: isk(ISK_PER_NPC_KILL_CALIBRATION.fallback),
  },
};

export function iskPerNpcKill(region: RegionId, assumptions: BountyAssumptions): Isk {
  return assumptions.iskPerNpcKill.byRegion.get(region) ?? assumptions.iskPerNpcKill.fallback;
}
