/**
 * NPC kills one successful hourly pull reported for a System. An hour with no
 * entry is a gap (the pull failed or never ran), which differs from 0 kills.
 */
export type HourlyKills = { readonly hourEnding: Date; readonly npcKills: number };

const HOUR_MS = 3_600_000;

/**
 * Kills keyed by hour slot (hours since the epoch, rounded to the nearest
 * hour, so ESI Last-Modified drift of a few minutes still lands in one slot).
 * Later entries for the same slot replace earlier ones.
 */
export function killsByHourSlot(history: readonly HourlyKills[]): Map<number, number> {
  return new Map(history.map((h) => [Math.round(h.hourEnding.getTime() / HOUR_MS), h.npcKills]));
}
