import { freshness, type SyncStatus } from "../domain/index.ts";
import { formatAge, formatEveTime } from "./format.ts";

/** Why the figures can't be trusted as current, or null when the sync is healthy. */
export function syncProblem(sync: SyncStatus, now: Date): string | null {
  const failure = sync.lastAttempt?.ok === false ? sync.lastAttempt : null;
  if (sync.lastSuccessAt === null) {
    return failure
      ? `No sync has succeeded yet. Last attempt failed: ${failure.error}`
      : "No sync has succeeded yet, so there are no figures.";
  }
  const age = formatAge(now.getTime() - Date.parse(sync.lastSuccessAt));
  if (failure) {
    return `The last sync failed at ${formatEveTime(failure.at)} EVE: ${failure.error}. Figures are from the last successful pull, ${age} ago.`;
  }
  if (freshness(new Date(sync.lastSuccessAt), now) === "Stale") {
    return `No successful pull for ${age}: the sync may have stopped. Figures are Stale.`;
  }
  return null;
}

export function SyncBanner({ sync, now }: { sync: SyncStatus; now: Date }) {
  const problem = syncProblem(sync, now);
  return problem ? (
    <div className="banner" role="alert">
      {problem}
    </div>
  ) : null;
}

export function FreshnessLine({ sync, now }: { sync: SyncStatus; now: Date }) {
  if (sync.lastSuccessAt === null) return null;
  const state = freshness(new Date(sync.lastSuccessAt), now);
  return (
    <p className="freshness">
      {sync.dataAsOf && <span>Data as of {formatEveTime(sync.dataAsOf)} EVE</span>}
      <span>Last successful pull {formatAge(now.getTime() - Date.parse(sync.lastSuccessAt))} ago</span>
      <span className={`badge ${state === "Stale" ? "stale" : "recent"}`}>{state}</span>
      {sync.nextPullAt && Date.parse(sync.nextPullAt) > now.getTime() && (
        <span className="muted">Next pull in {formatAge(Date.parse(sync.nextPullAt) - now.getTime())}</span>
      )}
    </p>
  );
}
