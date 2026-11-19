import {
  constellationId,
  isk,
  regionId,
  robberTake,
  systemId,
  type ConstellationId,
  type MainBankCeiling,
  type RegionList,
  type RegionView,
  type SovKind,
  type SyncStatus,
  type SystemView,
} from "../../domain/index.ts";

/** Figures are invented; names and the hierarchy shape are Delve-like so dotlan links resolve. */

export const FIXTURE_SYNCS = ["recent", "stale", "failed", "never"] as const;
export type FixtureSync = (typeof FIXTURE_SYNCS)[number];

const M = 1_000_000;
const HOUR = 3_600_000;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

export function fixtureSync(kind: FixtureSync, now: Date): SyncStatus {
  switch (kind) {
    case "recent":
      return {
        lastSuccessAt: ago(now, 12 * 60_000),
        lastAttempt: { at: ago(now, 12 * 60_000), ok: true },
        dataAsOf: ago(now, 14 * 60_000),
        nextPullAt: ago(now, -48 * 60_000),
      };
    case "stale":
      return {
        lastSuccessAt: ago(now, 2 * HOUR),
        lastAttempt: { at: ago(now, 2 * HOUR), ok: true },
        dataAsOf: ago(now, 2 * HOUR + 3 * 60_000),
        nextPullAt: null,
      };
    case "failed":
      return {
        lastSuccessAt: ago(now, 70 * 60_000),
        lastAttempt: { at: ago(now, 10 * 60_000), ok: false, error: "ESI 503 Service Unavailable" },
        dataAsOf: ago(now, 73 * 60_000),
        nextPullAt: ago(now, -50 * 60_000),
      };
    case "never":
      return {
        lastSuccessAt: null,
        lastAttempt: { at: ago(now, 5 * 60_000), ok: false, error: "fetch failed: ECONNREFUSED" },
        dataAsOf: null,
        nextPullAt: ago(now, -55 * 60_000),
      };
  }
}

const ready = (millions: number): MainBankCeiling => ({ status: "ready", ceiling: isk(millions * M) });

const DELVE = regionId(10000060);
const O_EIMK = constellationId(20000696);
const ONE_P_VL2 = constellationId(20000694);
const QKQ = constellationId(20000700);

function system(
  id: number,
  name: string,
  constellation: ConstellationId,
  securityStatus: number,
  sovKind: SovKind | null,
  mainBank: MainBankCeiling,
  previousMainBank: MainBankCeiling | null,
): SystemView {
  return {
    id: systemId(id),
    name,
    constellationId: constellation,
    securityStatus,
    sovKind,
    mainBank,
    previousMainBank,
    robberTake: robberTake(mainBank.ceiling),
    // Roughly a week of history at the fixture's kill rate.
    reserve: {
      low: isk(mainBank.ceiling * 6),
      high: isk(mainBank.ceiling * 24),
      hoursCovered: mainBank.status === "ready" ? 168 : mainBank.hoursCovered,
    },
  };
}

/**
 * Delve with every signal the UI shows: Surges at the default 20M threshold
 * (8QT-H4 +40M, 1DQ1-A +32M, PUIG-F +28M), a smaller rise that is a Surge
 * only at lower thresholds (J5A-IX +13M), a drop (T5ZI-S), a Warming Up
 * System (5BTK-M) and an NPC-null System (J5A-IX).
 */
export function fixtureRegionView(now: Date, sync: FixtureSync = "recent"): RegionView {
  return {
    region: { id: DELVE, name: "Delve" },
    sync: fixtureSync(sync, now),
    constellations: [
      { id: O_EIMK, name: "O-EIMK" },
      { id: ONE_P_VL2, name: "1P-VL2" },
      { id: QKQ, name: "QKQ-BT" },
    ],
    systems: [
      system(30004759, "1DQ1-A", O_EIMK, -0.39, "sov", ready(412), ready(380)),
      system(30004760, "T5ZI-S", O_EIMK, -0.38, "sov", ready(156), ready(190)),
      system(30004761, "PUIG-F", O_EIMK, -0.42, "sov", ready(98), ready(70)),
      system(30004762, "NOL-M9", O_EIMK, -0.33, "sov", ready(0), ready(0)),
      system(30004740, "8QT-H4", ONE_P_VL2, -0.47, "sov", ready(1230), ready(1190)),
      system(
        30004741,
        "5BTK-M",
        ONE_P_VL2,
        -0.51,
        "sov",
        { status: "warmingUp", ceiling: isk(45 * M), hoursCovered: 1, hoursNeeded: 3 },
        null,
      ),
      system(30004742, "Y-OMTZ", ONE_P_VL2, -0.55, "sov", ready(640), ready(640)),
      system(30004780, "J5A-IX", QKQ, -0.72, "npc", ready(233), ready(220)),
      system(30004781, "MO-GZ5", QKQ, -0.61, "unclaimed", ready(187.5), ready(180)),
      system(30004782, "QY6-RK", QKQ, -0.29, null, ready(61.2), null),
    ],
  };
}

export const FIXTURE_REGIONS: RegionList = {
  regions: [
    { id: DELVE, name: "Delve", nullsecSystemCount: 10 },
    { id: regionId(10000063), name: "Period Basis", nullsecSystemCount: 27 },
  ],
};
