import { expect, test, vi } from "vitest";
import { createEsi } from "../esi/client.ts";
import { openDb } from "../store/db.ts";
import { finishSyncRun, latestSyncRun, startSyncRun } from "../store/store.ts";
import { MAX_JITTER_MS, RETRY_DELAY_MS, startScheduler, type Timers, UNIVERSE_INTERVAL_MS } from "./scheduler.ts";
import { syncUniverse } from "./universe.ts";

const HOUR = 3_600_000;
const START = new Date("2026-11-18T12:00:00Z");
/** ESI's current kills hour: generated 20 minutes ago, so it expires in 40. */
const LAST_MODIFIED = new Date(START.getTime() - 20 * 60_000);

const UNIVERSE: Record<string, unknown> = {
  "/universe/regions": [10000001],
  "/universe/regions/10000001": { region_id: 10000001, name: "Derelik", constellations: [20000001] },
  "/universe/constellations/20000001": {
    constellation_id: 20000001,
    name: "Kalevala",
    region_id: 10000001,
    systems: [30000002],
  },
  "/universe/systems/30000002": { system_id: 30000002, name: "Quiet", constellation_id: 20000001, security_status: -0.2 },
  "/sovereignty/map": [],
};

function harness() {
  let clock = START;
  const scheduled = new Map<number, { ms: number; fire: () => void }>();
  let nextHandle = 0;
  const timers: Timers = {
    setTimeout: (fire, ms) => {
      scheduled.set(++nextHandle, { ms, fire });
      return nextHandle;
    },
    clearTimeout: (handle) => scheduled.delete(handle as number),
  };

  const requested: string[] = [];
  let killsStatus = 200;
  const esi = createEsi({
    userAgent: "test",
    maxRetries: 0,
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      requested.push(path);
      if (path === "/universe/system_kills") {
        return Promise.resolve(
          new Response("[]", {
            status: killsStatus,
            headers: {
              "last-modified": LAST_MODIFIED.toUTCString(),
              expires: new Date(LAST_MODIFIED.getTime() + HOUR).toUTCString(),
            },
          }),
        );
      }
      const body = UNIVERSE[path];
      return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200 }));
    },
  });

  const db = openDb(":memory:");
  return {
    db,
    esi,
    requested,
    timers,
    now: () => clock,
    random: () => 0.5,
    failKills: (status: number) => (killsStatus = status),
    /** Pending timer delays, sorted. */
    delays: () => [...scheduled.values()].map((t) => t.ms).sort((a, b) => a - b),
    /** Advances the clock by the shortest pending delay and fires that timer. */
    fireNext: () => {
      const [handle, next] = [...scheduled.entries()].sort(([, a], [, b]) => a.ms - b.ms)[0] ?? [];
      if (handle === undefined || next === undefined) throw new Error("nothing scheduled");
      scheduled.delete(handle);
      clock = new Date(clock.getTime() + next.ms);
      next.fire();
    },
  };
}

const killsDelay = 40 * 60_000 + 0.5 * MAX_JITTER_MS;

test("on an empty database, syncs the universe, polls kills, then schedules both", async () => {
  const h = harness();
  startScheduler(h);

  await vi.waitFor(() => {
    expect(h.delays()).toEqual([killsDelay, UNIVERSE_INTERVAL_MS]);
  });
  expect(h.requested[0]).toBe("/universe/regions");
  expect(h.requested.at(-1)).toBe("/universe/system_kills");
  expect(latestSyncRun(h.db, "kills")).toMatchObject({ ok: true, esiLastModified: LAST_MODIFIED });
});

test("skips the universe sync when the last one succeeded within a day", async () => {
  const h = harness();
  await syncUniverse({ esi: h.esi, db: h.db, now: () => new Date(START.getTime() - 6 * HOUR) });
  h.requested.length = 0;

  startScheduler(h);

  await vi.waitFor(() => {
    expect(h.delays()).toEqual([killsDelay, 18 * HOUR]);
  });
  expect(h.requested).toEqual(["/universe/system_kills"]);
});

test("reruns the universe sync on start when the last success is over a day old", async () => {
  const h = harness();
  await syncUniverse({ esi: h.esi, db: h.db, now: () => new Date(START.getTime() - 25 * HOUR) });
  const failed = startSyncRun(h.db, "universe", new Date(START.getTime() - HOUR));
  finishSyncRun(h.db, failed, START, { ok: false, error: "ESI 503", esiLastModified: null });
  h.requested.length = 0;

  startScheduler(h);

  await vi.waitFor(() => {
    expect(h.delays()).toEqual([killsDelay, UNIVERSE_INTERVAL_MS]);
  });
  expect(h.requested).toEqual(["/universe/regions", "/sovereignty/map", "/universe/system_kills"]);
});

test("retries a failed kills poll after the fixed delay, then follows Expires again", async () => {
  const h = harness();
  h.failKills(503);
  startScheduler(h);
  await vi.waitFor(() => {
    expect(h.delays()).toEqual([RETRY_DELAY_MS, UNIVERSE_INTERVAL_MS]);
  });
  expect(latestSyncRun(h.db, "kills")).toMatchObject({ ok: false });

  h.failKills(200);
  h.fireNext();

  await vi.waitFor(() => {
    expect(latestSyncRun(h.db, "kills")).toMatchObject({ ok: true });
  });
  // The retry ran 5 minutes later, so Expires is now 35 minutes away.
  expect(h.delays()).toEqual([35 * 60_000 + 0.5 * MAX_JITTER_MS, UNIVERSE_INTERVAL_MS]);
});

test("keeps both syncs scheduled when recording a sync run throws", async () => {
  const h = harness();
  const prepare = h.db.prepare.bind(h.db);
  h.db.prepare = (sql: string) => {
    if (sql.startsWith("INSERT INTO sync_runs")) throw new Error("disk I/O error");
    return prepare(sql);
  };

  startScheduler(h);

  await vi.waitFor(() => {
    expect(h.delays()).toEqual([RETRY_DELAY_MS, RETRY_DELAY_MS]);
  });
});

test("reports when the next kills poll is due", async () => {
  const h = harness();
  const scheduler = startScheduler(h);
  expect(scheduler.nextKillsPollAt()).toBeNull();

  await vi.waitFor(() => {
    expect(scheduler.nextKillsPollAt()).toEqual(new Date(START.getTime() + killsDelay));
  });
});

test("stop cancels pending syncs", async () => {
  const h = harness();
  const scheduler = startScheduler(h);
  await vi.waitFor(() => {
    expect(h.delays()).toHaveLength(2);
  });

  await scheduler.stop();

  expect(h.delays()).toEqual([]);
  expect(scheduler.nextKillsPollAt()).toBeNull();
});
