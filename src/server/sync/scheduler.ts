import type { DatabaseSync } from "node:sqlite";
import type { Esi } from "../esi/client.ts";
import { latestSuccessfulSyncRun, listNullsecSystems } from "../store/store.ts";
import { type KillsPollResult, pollKills } from "./kills.ts";
import { syncUniverse } from "./universe.ts";

export const UNIVERSE_INTERVAL_MS = 24 * 3_600_000;
/** Wait after a failed sync, or a kills poll ESI sent no usable Expires for. */
export const RETRY_DELAY_MS = 5 * 60_000;
/** Floor on the wait for the next kills hour, so an Expires already past (clock skew) cannot spin. */
export const MIN_KILLS_DELAY_MS = 10_000;
/** Spread on top of Expires so we ask just after ESI has the new hour, not on the instant. */
export const MAX_JITTER_MS = 30_000;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SchedulerDeps {
  readonly esi: Esi;
  readonly db: DatabaseSync;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
  readonly timers?: Timers;
  /** In [0, 1); scales the jitter. */
  readonly random?: () => number;
}

export interface Scheduler {
  /** Cancels pending syncs and resolves once the one in progress, if any, has finished. */
  stop(): Promise<void>;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export function nextKillsPollDelay(result: KillsPollResult, now: Date, random: () => number): number {
  if (!result.ok || result.expires === null) return RETRY_DELAY_MS;
  return Math.max(result.expires.getTime() - now.getTime(), MIN_KILLS_DELAY_MS) + Math.floor(random() * MAX_JITTER_MS);
}

/**
 * Starts the only ESI caller. Syncs run one at a time: on start, the universe sync if no Systems
 * are stored or the last successful one is a day old, then the kills poll. Each kills poll is
 * scheduled for when ESI's cache of the previous one expires; the universe sync repeats daily.
 */
export function startScheduler({
  esi,
  db,
  log = () => undefined,
  now = () => new Date(),
  timers = realTimers,
  random = Math.random,
}: SchedulerDeps): Scheduler {
  let stopped = false;
  const pending = new Set<unknown>();
  let running: Promise<void> = Promise.resolve();

  function run(job: () => Promise<void>): void {
    running = running
      .then(() => (stopped ? undefined : job()))
      .catch((error: unknown) => {
        log(`scheduler: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  function later(ms: number, job: () => Promise<void>): void {
    if (stopped) return;
    const handle = timers.setTimeout(() => {
      pending.delete(handle);
      run(job);
    }, ms);
    pending.add(handle);
  }

  // A sync that throws (e.g. a failed SQLite write) still reschedules, so one bad hour can't end polling.
  async function universe(): Promise<void> {
    let delay = RETRY_DELAY_MS;
    try {
      if ((await syncUniverse({ esi, db, log, now })).ok) delay = UNIVERSE_INTERVAL_MS;
    } finally {
      later(delay, universe);
    }
  }

  async function kills(): Promise<void> {
    let delay = RETRY_DELAY_MS;
    try {
      delay = nextKillsPollDelay(await pollKills({ esi, db, log, now }), now(), random);
    } finally {
      log(`kills: next poll in ${String(Math.round(delay / 1000))}s`);
      later(delay, kills);
    }
  }

  const lastUniverse = latestSuccessfulSyncRun(db, "universe");
  const universeDueIn =
    listNullsecSystems(db).length === 0 || lastUniverse === null
      ? 0
      : lastUniverse.startedAt.getTime() + UNIVERSE_INTERVAL_MS - now().getTime();
  if (universeDueIn <= 0) run(universe);
  else later(universeDueIn, universe);
  run(kills);

  return {
    stop() {
      stopped = true;
      for (const handle of pending) timers.clearTimeout(handle);
      pending.clear();
      return running;
    },
  };
}
