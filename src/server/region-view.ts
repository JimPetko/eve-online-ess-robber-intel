import {
  DEFAULT_BOUNTY_ASSUMPTIONS,
  mainBankCeiling,
  reserveBankEstimate,
  robberTake,
  type BountyAssumptions,
  type RegionView,
  type SyncAttempt,
  type SyncStatus,
  type SystemView,
} from "../domain/index.ts";
import type { RegionKills, SyncRun, SystemKillHistory } from "./store/store.ts";

function syncAttempt(run: SyncRun | null): SyncAttempt | null {
  if (run === null) return null;
  const at = (run.finishedAt ?? run.startedAt).toISOString();
  return run.ok === true ? { at, ok: true } : { at, ok: false, error: run.error ?? "unknown error" };
}

function syncStatus({ latestRun, latestSuccess }: RegionKills, nextPullAt: Date | null): SyncStatus {
  return {
    lastSuccessAt: latestSuccess && (latestSuccess.finishedAt ?? latestSuccess.startedAt).toISOString(),
    lastAttempt: syncAttempt(latestRun),
    dataAsOf: latestSuccess?.esiLastModified?.toISOString() ?? null,
    nextPullAt: nextPullAt?.toISOString() ?? null,
  };
}

function systemView(system: SystemKillHistory, assumptions: BountyAssumptions): SystemView {
  const { history, regionId } = system;
  const mainBank = mainBankCeiling(history, regionId, assumptions);
  // History is oldest first and every pull stores a row for every System, so the last entry is the latest pull.
  const before = history.slice(0, -1);
  return {
    id: system.id,
    name: system.name,
    constellationId: system.constellationId,
    securityStatus: system.securityStatus,
    mainBank,
    previousMainBank: before.length === 0 ? null : mainBankCeiling(before, regionId, assumptions),
    robberTake: robberTake(mainBank.ceiling, assumptions),
    reserve: reserveBankEstimate(history, regionId, assumptions),
  };
}

/** null for a Region with no in-scope Systems, which the API treats as unknown. */
export function regionView(
  kills: RegionKills,
  nextPullAt: Date | null,
  assumptions: BountyAssumptions = DEFAULT_BOUNTY_ASSUMPTIONS,
): RegionView | null {
  const first = kills.systems[0];
  if (first === undefined) return null;
  const constellations = new Map(kills.systems.map((s) => [s.constellationId, s.constellationName]));
  return {
    region: { id: first.regionId, name: first.regionName },
    sync: syncStatus(kills, nextPullAt),
    constellations: [...constellations]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    systems: kills.systems.map((s) => systemView(s, assumptions)),
  };
}
