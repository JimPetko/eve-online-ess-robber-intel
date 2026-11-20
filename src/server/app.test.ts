import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  constellationId,
  DEFAULT_BOUNTY_ASSUMPTIONS,
  iskPerNpcKill,
  type AllianceId,
  type FactionId,
  isk,
  regionId,
  systemId,
  type RegionList,
  type RegionView,
  type SyncStatus,
} from "../domain/index.ts";
import { buildApp } from "./app.ts";
import { openDb } from "./store/db.ts";
import { finishSyncRun, recordKillSnapshot, replaceSovereignty, startSyncRun, upsertRegionTree } from "./store/store.ts";

const HOUR = 3_600_000;
/** The latest pull. */
const T = new Date("2026-11-18T12:00:00Z");
const hoursBefore = (n: number) => new Date(T.getTime() - n * HOUR);
const NEXT_PULL = new Date("2026-11-18T13:00:20Z");

const DELVE = regionId(10000060);
/** Delve's calibrated ISK per NPC kill. */
const DELVE_ISK = iskPerNpcKill(DELVE, DEFAULT_BOUNTY_ASSUMPTIONS);
const BUSY = systemId(30004759);
const FRESH = systemId(30004760);
const QUIET = systemId(30004761);
/** Out of scope: NPC and unclaimed nullsec in Delve, and Regions holding only one or the other. */
const FACTION = systemId(30004762);
const UNCLAIMED = systemId(30004763);
const STAIN = regionId(10000022);
const STAIN_SYSTEM = systemId(30002000);
const WICKED_CREEK = regionId(10000006);
const WICKED_CREEK_SYSTEM = systemId(30000400);
const SERPENTIS = 500020 as FactionId;
const GOONS = 1354830081 as AllianceId;

function seed() {
  const db = openDb(":memory:");
  upsertRegionTree(db, {
    id: DELVE,
    name: "Delve",
    constellations: [
      {
        id: constellationId(20000696),
        name: "O-EIMK",
        systems: [
          { id: BUSY, name: "1DQ1-A", securityStatus: -0.5 },
          { id: FRESH, name: "T5ZI-S", securityStatus: -0.1 },
          { id: FACTION, name: "NPC-1", securityStatus: -0.6 },
          { id: UNCLAIMED, name: "OPEN-1", securityStatus: -0.6 },
        ],
      },
      { id: constellationId(20000694), name: "1P-VL2", systems: [{ id: QUIET, name: "PUIG-F", securityStatus: -0.9 }] },
    ],
  });
  upsertRegionTree(db, {
    id: regionId(10000001),
    name: "Derelik",
    constellations: [
      { id: constellationId(20000001), name: "Kalevala", systems: [{ id: systemId(30000001), name: "Hi", securityStatus: 0.5 }] },
    ],
  });
  upsertRegionTree(db, {
    id: regionId(10000002),
    name: "Catch",
    constellations: [
      { id: constellationId(20000002), name: "Far", systems: [{ id: systemId(30000009), name: "Far", securityStatus: -0.3 }] },
    ],
  });
  upsertRegionTree(db, {
    id: STAIN,
    name: "Stain",
    constellations: [
      { id: constellationId(20000300), name: "Faction", systems: [{ id: STAIN_SYSTEM, name: "NPC-2", securityStatus: -0.4 }] },
    ],
  });
  upsertRegionTree(db, {
    id: WICKED_CREEK,
    name: "Wicked Creek",
    constellations: [
      {
        id: constellationId(20000060),
        name: "Open",
        systems: [{ id: WICKED_CREEK_SYSTEM, name: "OPEN-2", securityStatus: -0.4 }],
      },
    ],
  });
  replaceSovereignty(db, [
    { systemId: BUSY, allianceId: GOONS, factionId: null },
    { systemId: FRESH, allianceId: GOONS, factionId: null },
    { systemId: QUIET, allianceId: GOONS, factionId: null },
    { systemId: systemId(30000009), allianceId: GOONS, factionId: null },
    { systemId: FACTION, allianceId: null, factionId: SERPENTIS },
    { systemId: STAIN_SYSTEM, allianceId: null, factionId: SERPENTIS },
  ]);
  return db;
}

/** A successful poll a minute after ESI stamped `pulledAt`, storing `kills` as [System, NPC kills]. */
function pull(db: ReturnType<typeof openDb>, pulledAt: Date, kills: [number, number][]) {
  recordKillSnapshot(db, pulledAt, new Map(kills.map(([id, n]) => [systemId(id), n])));
  const run = startSyncRun(db, "kills", new Date(pulledAt.getTime() + 60_000));
  finishSyncRun(db, run, new Date(pulledAt.getTime() + 62_000), { ok: true, esiLastModified: pulledAt });
}

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function app(db = seed(), options: { webRoot?: string } = {}) {
  const instance = buildApp({ db, nextPullAt: () => NEXT_PULL, ...options });
  apps.push(instance);
  return instance;
}

async function get(instance: ReturnType<typeof app>, url: string) {
  return instance.inject({ method: "GET", url });
}

test("GET /api/health reports ok", async () => {
  const res = await get(app(), "/api/health");
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});

test("GET /api/regions lists Regions with in-scope Systems, by name", async () => {
  const res = await get(app(), "/api/regions");
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    regions: [
      { id: regionId(10000002), name: "Catch", nullsecSystemCount: 1 },
      { id: DELVE, name: "Delve", nullsecSystemCount: 3 },
    ],
  } satisfies RegionList);
});

test("NPC and unclaimed nullsec are out of scope: absent from counts and views, and their Regions are unknown", async () => {
  const db = seed();
  pull(db, T, [
    [BUSY, 40],
    [FACTION, 500],
    [UNCLAIMED, 500],
    [STAIN_SYSTEM, 500],
    [WICKED_CREEK_SYSTEM, 500],
  ]);
  const instance = app(db);

  const regions = (await get(instance, "/api/regions")).json<RegionList>().regions;
  expect(regions.map((r) => r.name)).toEqual(["Catch", "Delve"]);
  expect(regions.find((r) => r.id === DELVE)?.nullsecSystemCount).toBe(3);

  const delve = (await get(instance, `/api/regions/${String(DELVE)}`)).json<RegionView>();
  expect(delve.systems.map((s) => s.name)).toEqual(["1DQ1-A", "T5ZI-S", "PUIG-F"]);

  expect((await get(instance, `/api/regions/${String(STAIN)}`)).statusCode).toBe(404);
  expect((await get(instance, `/api/regions/${String(WICKED_CREEK)}`)).statusCode).toBe(404);
});

test("GET /api/regions/:id computes ceilings, previous ceiling and Robber Take per System, with no Reserve figure", async () => {
  const db = seed();
  // BUSY has four full hours; FRESH only the latest; QUIET none at all.
  pull(db, hoursBefore(3), [[BUSY, 10]]);
  pull(db, hoursBefore(2), [[BUSY, 20]]);
  pull(db, hoursBefore(1), [[BUSY, 30]]);
  pull(db, T, [
    [BUSY, 40],
    [FRESH, 6],
  ]);

  const res = await get(app(db), `/api/regions/${String(DELVE)}`);

  expect(res.statusCode).toBe(200);
  // Delve's calibrated ISK per kill, 40% to the Main Bank, over hours weighted [1, 1, 0.75] latest first.
  expect(res.json()).toEqual({
    region: { id: DELVE, name: "Delve" },
    sync: {
      lastSuccessAt: new Date(T.getTime() + 62_000).toISOString(),
      lastAttempt: { at: new Date(T.getTime() + 62_000).toISOString(), ok: true },
      dataAsOf: T.toISOString(),
      nextPullAt: NEXT_PULL.toISOString(),
    },
    constellations: [
      { id: constellationId(20000694), name: "1P-VL2" },
      { id: constellationId(20000696), name: "O-EIMK" },
    ],
    systems: [
      {
        id: BUSY,
        name: "1DQ1-A",
        constellationId: constellationId(20000696),
        securityStatus: -0.5,
        // 40 + 30 + 0.75 * 20 = 85 weighted kills
        mainBank: { status: "ready", ceiling: isk(85 * DELVE_ISK * 0.4) },
        // 30 + 20 + 0.75 * 10 = 57.5 weighted kills
        previousMainBank: { status: "ready", ceiling: isk(57.5 * DELVE_ISK * 0.4) },
        robberTake: isk(isk(85 * DELVE_ISK * 0.4) * 0.8),
      },
      {
        id: FRESH,
        name: "T5ZI-S",
        constellationId: constellationId(20000696),
        securityStatus: -0.1,
        mainBank: { status: "warmingUp", ceiling: isk(6 * DELVE_ISK * 0.4), hoursCovered: 1, hoursNeeded: 3 },
        previousMainBank: null,
        robberTake: isk(isk(6 * DELVE_ISK * 0.4) * 0.8),
      },
      {
        id: QUIET,
        name: "PUIG-F",
        constellationId: constellationId(20000694),
        securityStatus: -0.9,
        mainBank: { status: "warmingUp", ceiling: isk(0), hoursCovered: 0, hoursNeeded: 3 },
        previousMainBank: null,
        robberTake: isk(0),
      },
    ],
  } satisfies RegionView);
});

test("the previous ceiling is Warming Up while the history before the latest pull is short", async () => {
  const db = seed();
  pull(db, hoursBefore(2), [[BUSY, 10]]);
  pull(db, hoursBefore(1), [[BUSY, 10]]);
  pull(db, T, [[BUSY, 10]]);

  const busy = (await get(app(db), `/api/regions/${String(DELVE)}`)).json<RegionView>().systems[0];

  expect(busy?.mainBank).toEqual({ status: "ready", ceiling: isk(27.5 * DELVE_ISK * 0.4) });
  expect(busy?.previousMainBank).toEqual({
    status: "warmingUp",
    ceiling: isk(20 * DELVE_ISK * 0.4),
    hoursCovered: 2,
    hoursNeeded: 3,
  });
});

test.each([
  ["non-numeric", "delve", 400],
  ["negative", "-1", 400],
  ["fractional", "10000060.5", 400],
  ["unknown", "10009999", 404],
  ["out of scope (no nullsec)", "10000001", 404],
])("GET /api/regions/:id rejects a %s id", async (_, id, status) => {
  const res = await get(app(), `/api/regions/${id}`);
  expect(res.statusCode).toBe(status);
  expect(res.json()).toEqual({ error: expect.any(String) as unknown });
});

async function syncOf(db: ReturnType<typeof openDb>): Promise<SyncStatus> {
  return (await get(app(db), `/api/regions/${String(DELVE)}`)).json<RegionView>().sync;
}

test("sync status before any poll has finished", async () => {
  const db = seed();
  startSyncRun(db, "kills", T); // in flight

  expect(await syncOf(db)).toEqual({
    lastSuccessAt: null,
    lastAttempt: null,
    dataAsOf: null,
    nextPullAt: NEXT_PULL.toISOString(),
  } satisfies SyncStatus);
});

test("sync status after the last poll failed keeps the last success's data time", async () => {
  const db = seed();
  pull(db, hoursBefore(1), [[BUSY, 10]]);
  const failed = startSyncRun(db, "kills", T);
  finishSyncRun(db, failed, new Date(T.getTime() + 5_000), { ok: false, error: "ESI 503", esiLastModified: null });
  startSyncRun(db, "kills", new Date(T.getTime() + 300_000)); // retry in flight

  expect(await syncOf(db)).toEqual({
    lastSuccessAt: new Date(hoursBefore(1).getTime() + 62_000).toISOString(),
    lastAttempt: { at: new Date(T.getTime() + 5_000).toISOString(), ok: false, error: "ESI 503" },
    dataAsOf: hoursBefore(1).toISOString(),
    nextPullAt: NEXT_PULL.toISOString(),
  } satisfies SyncStatus);
});

test("sync status reports no next pull while one is in flight", async () => {
  const instance = buildApp({ db: seed(), nextPullAt: () => null });
  apps.push(instance);
  expect((await get(instance, `/api/regions/${String(DELVE)}`)).json<RegionView>().sync.nextPullAt).toBeNull();
});

test("serves the built UI, with the app shell for client routes and JSON 404s under /api", async () => {
  const webRoot = mkdtempSync(join(tmpdir(), "ess-web-"));
  try {
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>ESS</title>");
    writeFileSync(join(webRoot, "assets", "index-abc.js"), "console.log(1)");
    const instance = app(seed(), { webRoot });

    const index = await get(instance, "/");
    expect([index.statusCode, index.headers["content-type"], index.body]).toEqual([
      200,
      "text/html; charset=utf-8",
      "<!doctype html><title>ESS</title>",
    ]);
    const asset = await get(instance, "/assets/index-abc.js");
    expect([asset.statusCode, asset.headers["content-type"]]).toEqual([200, expect.stringMatching(/javascript/)]);
    expect((await get(instance, "/regions/delve?x=1")).body).toBe("<!doctype html><title>ESS</title>");
    expect((await get(instance, "/assets/index-old.js")).statusCode).toBe(404);
    for (const url of ["/api/nope", "/api", "/api?x=1"]) {
      const api = await get(instance, url);
      expect([url, api.statusCode, api.headers["content-type"]]).toEqual([url, 404, "application/json; charset=utf-8"]);
    }
  } finally {
    rmSync(webRoot, { recursive: true, force: true });
  }
});

test("without a built UI only the API is served", async () => {
  expect((await get(app(), "/")).statusCode).toBe(404);
});
