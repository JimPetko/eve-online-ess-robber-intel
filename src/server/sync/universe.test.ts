import { expect, test } from "vitest";
import { createEsi } from "../esi/client.ts";
import { openDb } from "../store/db.ts";
import { latestSyncRun, listNullsecSystems } from "../store/store.ts";
import { syncUniverse } from "./universe.ts";

// A tiny universe: one k-space Region with two Constellations, plus Pochven, a Jove Region and a wormhole Region.
const ROUTES: Record<string, unknown> = {
  "/universe/regions": [10000001, 10000004, 10000070, 11000001],
  "/universe/regions/10000001": { region_id: 10000001, name: "Derelik", constellations: [20000001, 20000002] },
  "/universe/constellations/20000001": {
    constellation_id: 20000001,
    name: "Kalevala",
    region_id: 10000001,
    position: { x: 0, y: 0, z: 0 },
    systems: [30000001, 30000002],
  },
  "/universe/constellations/20000002": {
    constellation_id: 20000002,
    name: "Mossas",
    region_id: 10000001,
    position: { x: 0, y: 0, z: 0 },
    systems: [30000003],
  },
  "/universe/systems/30000001": { system_id: 30000001, name: "Lowsec", constellation_id: 20000001, security_status: 0.3 },
  "/universe/systems/30000002": { system_id: 30000002, name: "NPC", constellation_id: 20000001, security_status: -0.2 },
  "/universe/systems/30000003": { system_id: 30000003, name: "Sov", constellation_id: 20000002, security_status: -0.8 },
  "/sovereignty/map": [
    { system_id: 30000001, faction_id: 500001 },
    { system_id: 30000002, faction_id: 500001 },
    { system_id: 30000003, alliance_id: 99000001, corporation_id: 98000001 },
    { system_id: 31000005 },
  ],
};

function fakeEsi(overrides: Record<string, number> = {}) {
  const requested: string[] = [];
  const esi = createEsi({
    userAgent: "test",
    maxRetries: 0,
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      requested.push(path);
      const status = overrides[path];
      if (status !== undefined) return Promise.resolve(new Response("{}", { status }));
      const body = ROUTES[path];
      if (body === undefined) return Promise.resolve(new Response("{}", { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { "last-modified": "Wed, 18 Nov 2026 11:00:00 GMT" } }),
      );
    },
  });
  return { esi, requested };
}

test("puts only sov-held nullsec in scope and skips wormhole space, Pochven and Jove space", async () => {
  const db = openDb(":memory:");
  const { esi, requested } = fakeEsi();

  const result = await syncUniverse({ esi, db });

  expect(result).toMatchObject({ ok: true, regionsFetched: 1, systemsFetched: 3, errors: [] });
  expect(requested).not.toContain("/universe/regions/10000004");
  expect(requested).not.toContain("/universe/regions/10000070");
  expect(requested).not.toContain("/universe/regions/11000001");
  expect(listNullsecSystems(db)).toEqual([
    expect.objectContaining({ id: 30000003, constellationName: "Mossas", sovAllianceId: 99000001 }),
  ]);
  expect(latestSyncRun(db, "universe")).toMatchObject({
    ok: true,
    esiLastModified: new Date("2026-11-18T11:00:00Z"),
  });
});

test("a second run fetches no static data, refreshes sovereignty, and converges", async () => {
  const db = openDb(":memory:");
  await syncUniverse({ esi: fakeEsi().esi, db });
  const before = listNullsecSystems(db);

  const { esi, requested } = fakeEsi();
  const result = await syncUniverse({ esi, db });

  expect(result).toMatchObject({ ok: true, regionsFetched: 0 });
  expect(requested).toEqual(["/universe/regions", "/sovereignty/map"]);
  expect(listNullsecSystems(db)).toEqual(before);
});

test("a Region that fails is not half-stored and is fetched on the next run", async () => {
  const db = openDb(":memory:");
  const failing = await syncUniverse({ esi: fakeEsi({ "/universe/systems/30000003": 503 }).esi, db });

  expect(failing.ok).toBe(false);
  expect(failing.errors[0]).toMatch(/region 10000001: ESI 503/);
  expect(listNullsecSystems(db)).toEqual([]);
  expect(latestSyncRun(db, "universe")).toMatchObject({ ok: false, error: expect.stringMatching(/ESI 503/) as unknown });

  const retry = await syncUniverse({ esi: fakeEsi().esi, db });
  expect(retry).toMatchObject({ ok: true, regionsFetched: 1 });
  expect(listNullsecSystems(db).map((s) => s.id)).toEqual([30000003]);
});

test("a failed sovereignty fetch fails the run, leaves nothing in scope, and keeps the static data", async () => {
  const db = openDb(":memory:");
  const result = await syncUniverse({ esi: fakeEsi({ "/sovereignty/map": 500 }).esi, db });

  expect(result).toMatchObject({ ok: false, regionsFetched: 1 });
  expect(listNullsecSystems(db)).toEqual([]);

  const { esi, requested } = fakeEsi();
  expect(await syncUniverse({ esi, db })).toMatchObject({ ok: true, regionsFetched: 0 });
  expect(requested).toEqual(["/universe/regions", "/sovereignty/map"]);
  expect(listNullsecSystems(db).map((s) => s.id)).toEqual([30000003]);
});
