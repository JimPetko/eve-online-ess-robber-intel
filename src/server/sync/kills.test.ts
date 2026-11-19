import { expect, test } from "vitest";
import { constellationId, regionId, systemId } from "../../domain/index.ts";
import { createEsi } from "../esi/client.ts";
import { openDb } from "../store/db.ts";
import { latestSyncRun, regionKills, upsertRegionTree } from "../store/store.ts";
import { pollKills } from "./kills.ts";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-18T11:40:00Z");

function seed() {
  const db = openDb(":memory:");
  upsertRegionTree(db, {
    id: regionId(10000001),
    name: "Derelik",
    constellations: [
      {
        id: constellationId(20000001),
        name: "Kalevala",
        systems: [
          { id: systemId(30000001), name: "Lowsec", securityStatus: 0.3 },
          { id: systemId(30000002), name: "Quiet", securityStatus: -0.2 },
          { id: systemId(30000003), name: "Busy", securityStatus: -0.8 },
        ],
      },
    ],
  });
  return db;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** An ESI whose /universe/system_kills answers with each queued reply in turn. */
function fakeEsi(...replies: Reply[]) {
  return createEsi({
    userAgent: "test",
    maxRetries: 0,
    fetch: () => {
      const reply = replies.shift();
      if (!reply) throw new Error("unexpected ESI call");
      return Promise.resolve(
        new Response(JSON.stringify(reply.body ?? []), { status: reply.status ?? 200, headers: reply.headers ?? {} }),
      );
    },
  });
}

function hourReply(lastModified: Date, kills: { system_id: number; npc_kills: number; ship_kills?: number }[]): Reply {
  return {
    body: kills,
    headers: {
      "last-modified": lastModified.toUTCString(),
      expires: new Date(lastModified.getTime() + HOUR).toUTCString(),
    },
  };
}

const histories = (db: ReturnType<typeof seed>) =>
  Object.fromEntries(regionKills(db, regionId(10000001)).systems.map((s) => [s.name, s.history]));

test("stores 0 for absent nullsec Systems and drops non-nullsec ones", async () => {
  const db = seed();
  const esi = fakeEsi(
    hourReply(T0, [
      { system_id: 30000001, npc_kills: 40 },
      { system_id: 30000003, npc_kills: 120, ship_kills: 2 },
      { system_id: 30099999, npc_kills: 5 },
    ]),
  );

  const result = await pollKills({ esi, db, now: () => new Date(T0.getTime() + 60_000) });

  expect(result).toEqual({
    ok: true,
    pulledAt: T0,
    rowsInserted: 2,
    rowsPruned: 0,
    expires: new Date(T0.getTime() + HOUR),
  });
  expect(histories(db)).toEqual({
    Quiet: [{ hourEnding: T0, npcKills: 0 }],
    Busy: [{ hourEnding: T0, npcKills: 120 }],
  });
  expect(latestSyncRun(db, "kills")).toMatchObject({ ok: true, error: null, esiLastModified: T0 });
});

test("polling again within the same ESI hour stores nothing new", async () => {
  const db = seed();
  const reply = hourReply(T0, [{ system_id: 30000003, npc_kills: 120 }]);
  await pollKills({ esi: fakeEsi(reply), db });
  const before = histories(db);

  const again = await pollKills({ esi: fakeEsi(reply), db });

  expect(again).toMatchObject({ ok: true, pulledAt: T0, rowsInserted: 0 });
  expect(histories(db)).toEqual(before);
});

test("each new ESI hour appends to the history", async () => {
  const db = seed();
  const t1 = new Date(T0.getTime() + HOUR);
  await pollKills({ esi: fakeEsi(hourReply(T0, [{ system_id: 30000003, npc_kills: 120 }])), db });
  await pollKills({ esi: fakeEsi(hourReply(t1, [{ system_id: 30000002, npc_kills: 7 }])), db });

  expect(histories(db)).toEqual({
    Quiet: [
      { hourEnding: T0, npcKills: 0 },
      { hourEnding: t1, npcKills: 7 },
    ],
    Busy: [
      { hourEnding: T0, npcKills: 120 },
      { hourEnding: t1, npcKills: 0 },
    ],
  });
});

test("a failed poll is recorded and leaves stored snapshots intact", async () => {
  const db = seed();
  await pollKills({ esi: fakeEsi(hourReply(T0, [{ system_id: 30000003, npc_kills: 120 }])), db });
  const before = histories(db);

  const result = await pollKills({ esi: fakeEsi({ status: 503, body: { error: "down" } }), db });

  expect(result).toEqual({ ok: false, error: expect.stringMatching(/ESI 503/) as unknown });
  expect(histories(db)).toEqual(before);
  const kills = regionKills(db, regionId(10000001));
  expect(kills.latestRun).toMatchObject({ ok: false, error: expect.stringMatching(/ESI 503/) as unknown });
  expect(kills.latestSuccess).toMatchObject({ ok: true, esiLastModified: T0 });
});

test("without Last-Modified the snapshot is stamped an hour before Expires", async () => {
  const db = seed();
  const expires = new Date(T0.getTime() + HOUR);
  const result = await pollKills({
    esi: fakeEsi({ body: [], headers: { expires: expires.toUTCString() } }),
    db,
  });
  expect(result).toMatchObject({ ok: true, pulledAt: T0 });
});

test("without Last-Modified or Expires the poll fails rather than guess the hour", async () => {
  const db = seed();
  const result = await pollKills({ esi: fakeEsi({ body: [] }), db });
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/neither Last-Modified nor Expires/) as unknown });
  expect(histories(db)).toEqual({ Quiet: [], Busy: [] });
});

test("fails without calling ESI before the universe sync has stored any Systems", async () => {
  const db = openDb(":memory:");
  const result = await pollKills({ esi: fakeEsi(), db });
  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/universe sync/) as unknown });
});

test("prunes snapshots older than 30 days", async () => {
  const db = seed();
  const old = new Date(T0.getTime() - 31 * 24 * HOUR);
  await pollKills({ esi: fakeEsi(hourReply(old, [])), db, now: () => old });

  const result = await pollKills({ esi: fakeEsi(hourReply(T0, [])), db, now: () => T0 });

  expect(result).toMatchObject({ ok: true, rowsInserted: 2, rowsPruned: 2 });
  expect(histories(db)).toEqual({ Quiet: [{ hourEnding: T0, npcKills: 0 }], Busy: [{ hourEnding: T0, npcKills: 0 }] });
});
