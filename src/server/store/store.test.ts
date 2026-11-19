import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { AllianceId, ConstellationId, FactionId, RegionId, SystemId } from "../../domain/index.ts";
import { openDb, SCHEMA_VERSION } from "./db.ts";
import {
  finishSyncRun,
  latestSyncRun,
  listNullsecSystems,
  pruneKillSnapshots,
  recordKillSnapshot,
  replaceSovereignty,
  startSyncRun,
  upsertRegionTree,
} from "./store.ts";

const sys = (id: number) => id as SystemId;

function seed() {
  const db = openDb(":memory:");
  upsertRegionTree(db, {
    id: 10000001 as RegionId,
    name: "Derelik",
    constellations: [
      {
        id: 20000001 as ConstellationId,
        name: "Kalevala",
        systems: [
          { id: sys(30000001), name: "Highsec", securityStatus: 0.5 },
          { id: sys(30000002), name: "Zero", securityStatus: 0 },
          { id: sys(30000003), name: "Deep", securityStatus: -0.4 },
          { id: sys(30000004), name: "Empty", securityStatus: -0.1 },
        ],
      },
    ],
  });
  return db;
}

test("reopening a file database keeps data and does not rerun migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "ess-store-"));
  try {
    const path = join(dir, "nested", "test.sqlite");
    const first = openDb(path);
    upsertRegionTree(first, { id: 10000001 as RegionId, name: "Derelik", constellations: [] });
    first.close();

    const second = openDb(path);
    expect(second.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    expect(second.prepare("SELECT name FROM regions").all()).toEqual([{ name: "Derelik" }]);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrading a database drops Jove Regions stored before they were out of scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "ess-store-"));
  try {
    const path = join(dir, "test.sqlite");
    const old = openDb(path);
    const tree = (region: number, constellation: number, system: number) => ({
      id: region as RegionId,
      name: String(region),
      constellations: [
        {
          id: constellation as ConstellationId,
          name: String(constellation),
          systems: [{ id: sys(system), name: String(system), securityStatus: -0.5 }],
        },
      ],
    });
    upsertRegionTree(old, tree(10000001, 20000001, 30000001));
    upsertRegionTree(old, tree(10000017, 20000201, 30001401));
    recordKillSnapshot(old, new Date(), new Map([[sys(30000001), 3], [sys(30001401), 9]]));
    old.exec("PRAGMA user_version = 1");
    old.close();

    const db = openDb(path);
    expect(listNullsecSystems(db).map((s) => s.id)).toEqual([30000001]);
    expect(db.prepare("SELECT id FROM regions").all()).toEqual([{ id: 10000001 }]);
    expect(db.prepare("SELECT system_id FROM kill_snapshots").all()).toEqual([{ system_id: 30000001 }]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lists only nullsec Systems, with sovereignty and ESS Presence Unconfirmed", () => {
  const db = seed();
  expect(listNullsecSystems(db).map((s) => s.sovKind)).toEqual([null, null, null]);

  replaceSovereignty(db, [
    { systemId: sys(30000001), allianceId: null, factionId: 500001 as FactionId },
    { systemId: sys(30000002), allianceId: null, factionId: 500001 as FactionId },
    { systemId: sys(30000003), allianceId: 99000001 as AllianceId, factionId: null },
  ]);

  expect(listNullsecSystems(db, 10000001 as RegionId)).toEqual([
    expect.objectContaining({ id: 30000002, sovKind: "npc", sovFactionId: 500001, essPresenceUnconfirmed: true }),
    expect.objectContaining({ id: 30000003, sovKind: "sov", sovAllianceId: 99000001, essPresenceUnconfirmed: false }),
    expect.objectContaining({
      id: 30000004,
      name: "Empty",
      constellationName: "Kalevala",
      regionName: "Derelik",
      sovKind: "unclaimed",
      essPresenceUnconfirmed: false,
    }),
  ]);
  expect(listNullsecSystems(db, 10000002 as RegionId)).toEqual([]);
});

test("a refreshed sovereignty map replaces the previous one", () => {
  const db = seed();
  replaceSovereignty(db, [{ systemId: sys(30000003), allianceId: 99000001 as AllianceId, factionId: null }]);
  replaceSovereignty(db, []);
  expect(listNullsecSystems(db).find((s) => s.id === sys(30000003))).toMatchObject({
    sovKind: "unclaimed",
    sovAllianceId: null,
  });
});

test("prunes kill snapshots older than 30 days", () => {
  const db = seed();
  const now = new Date("2026-11-18T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  recordKillSnapshot(db, new Date(now.getTime() - 31 * day), new Map([[sys(30000003), 5]]));
  recordKillSnapshot(db, new Date(now.getTime() - 29 * day), new Map([[sys(30000003), 7], [sys(30000004), 0]]));

  expect(pruneKillSnapshots(db, now)).toBe(1);
  expect(db.prepare("SELECT system_id, npc_kills FROM kill_snapshots ORDER BY system_id").all()).toEqual([
    { system_id: 30000003, npc_kills: 7 },
    { system_id: 30000004, npc_kills: 0 },
  ]);
});

test("rejects snapshots for Systems the universe sync has not stored", () => {
  const db = seed();
  expect(() => {
    recordKillSnapshot(db, new Date(), new Map([[sys(31000001), 1]]));
  }).toThrow(/FOREIGN KEY/);
});

test("records sync runs and reports the latest per kind", () => {
  const db = openDb(":memory:");
  expect(latestSyncRun(db, "kills")).toBeNull();

  const first = startSyncRun(db, "kills", new Date("2026-11-18T10:00:00Z"));
  finishSyncRun(db, first, new Date("2026-11-18T10:00:05Z"), {
    ok: true,
    esiLastModified: new Date("2026-11-18T09:55:00Z"),
  });
  const second = startSyncRun(db, "kills", new Date("2026-11-18T11:00:00Z"));
  finishSyncRun(db, second, new Date("2026-11-18T11:00:02Z"), { ok: false, error: "ESI 503", esiLastModified: null });

  expect(latestSyncRun(db, "kills")).toEqual({
    id: second,
    kind: "kills",
    startedAt: new Date("2026-11-18T11:00:00Z"),
    finishedAt: new Date("2026-11-18T11:00:02Z"),
    ok: false,
    error: "ESI 503",
    esiLastModified: null,
  });
  expect(latestSyncRun(db, "universe")).toBeNull();
});
