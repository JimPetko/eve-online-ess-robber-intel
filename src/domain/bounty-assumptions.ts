import { isk, type Isk } from "./ids.ts";

/**
 * Security Bands over true security, shallowest first. Each band includes its
 * upper (shallower) edge, so -0.2 is in "-0.2 to -0.4". The deepest band also
 * takes anything below -0.8.
 */
export const SECURITY_BANDS = [
  "0.0 to -0.2",
  "-0.2 to -0.4",
  "-0.4 to -0.6",
  "-0.6 to -0.8",
  "-0.8 to -1.0",
] as const;
export type SecurityBand = (typeof SECURITY_BANDS)[number];

const UPPER_EDGE: Readonly<Record<SecurityBand, number>> = {
  "0.0 to -0.2": 0,
  "-0.2 to -0.4": -0.2,
  "-0.4 to -0.6": -0.4,
  "-0.6 to -0.8": -0.6,
  "-0.8 to -1.0": -0.8,
};

/** Throws RangeError for security above 0.0 (not nullsec) or NaN. */
export function securityBand(securityStatus: number): SecurityBand {
  const band = SECURITY_BANDS.findLast((b) => securityStatus <= UPPER_EDGE[b]);
  if (band === undefined) {
    throw new RangeError(`security status ${String(securityStatus)} is not nullsec`);
  }
  return band;
}

export type BountyAssumptions = {
  readonly payoutCycleMinutes: number;
  readonly mainBankShare: number;
  readonly robberTakeShare: number;
  readonly reserveFillShare: { readonly low: number; readonly high: number };
  readonly iskPerNpcKill: Readonly<Record<SecurityBand, Isk>>;
};

/** Every figure here is an assumption, not a measurement. */
export const DEFAULT_BOUNTY_ASSUMPTIONS: BountyAssumptions = {
  // 2h45m per GLOSSARY.md and DESIGN.md. Confidence medium: player sources
  // also cite 2h and 3h at different times (docs/research/reserve-bank.md §4).
  payoutCycleMinutes: 165,
  // Share of each bounty that lands in the Main Bank. Unverified player
  // estimate (ADR 0001); confidence low.
  mainBankShare: 0.4,
  // Share of the Main Bank a Robber walks away with. Player figure; confidence medium.
  robberTakeShare: 0.8,
  // Share of each bounty that lands in the Reserve Bank. CCP never published
  // it; player estimates span 5-20% (docs/research/reserve-bank.md §1). Confidence low.
  reserveFillShare: { low: 0.05, high: 0.2 },
  // ISK per NPC kill. Pure guesses, rising with depth, pending calibration
  // from the Monthly Economic Report (DESIGN.md, Deferred). Confidence very low.
  iskPerNpcKill: {
    "0.0 to -0.2": isk(500_000),
    "-0.2 to -0.4": isk(650_000),
    "-0.4 to -0.6": isk(800_000),
    "-0.6 to -0.8": isk(1_000_000),
    "-0.8 to -1.0": isk(1_200_000),
  },
};

export function iskPerNpcKill(securityStatus: number, assumptions: BountyAssumptions): Isk {
  return assumptions.iskPerNpcKill[securityBand(securityStatus)];
}
