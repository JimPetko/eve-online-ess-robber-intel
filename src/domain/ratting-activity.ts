import { killsByHourSlot, type HourlyKills } from "./history.ts";

/**
 * A System's place in its Region by NPC kills over all the history we hold
 * (up to 30 days): where Ratters habitually work, so where a Main Bank keeps
 * refilling, even when the System is quiet right now.
 */
export type RattingActivity = {
  readonly npcKills: number;
  /** 1 is the busiest; Systems with equal kills share a rank (1, 2, 2, 4). */
  readonly rank: number;
  /** In-scope Systems in the Region. */
  readonly of: number;
  readonly hoursCovered: number;
};

/** One RattingActivity per history, in the same order. */
export function rattingActivity(histories: readonly (readonly HourlyKills[])[]): RattingActivity[] {
  const totals = histories.map((history) => {
    const kills = killsByHourSlot(history);
    let npcKills = 0;
    for (const k of kills.values()) npcKills += k;
    return { npcKills, hoursCovered: kills.size };
  });
  const descending = totals.map((t) => t.npcKills).sort((a, b) => b - a);
  return totals.map((t) => ({
    ...t,
    rank: descending.indexOf(t.npcKills) + 1,
    of: totals.length,
  }));
}
