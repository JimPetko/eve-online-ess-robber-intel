export type Freshness = "Recent" | "Stale";

const HOUR_MS = 3_600_000;

/** Recent while the last successful pull is under an hour old; Stale from exactly one hour. */
export function freshness(lastSuccessfulPull: Date, now: Date): Freshness {
  return now.getTime() - lastSuccessfulPull.getTime() < HOUR_MS ? "Recent" : "Stale";
}
