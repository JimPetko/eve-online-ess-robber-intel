import { loadConfig } from "../config.ts";
import { createEsi } from "../esi/client.ts";
import { openDb } from "../store/db.ts";
import { listNullsecSystems } from "../store/store.ts";
import { syncUniverse } from "./universe.ts";

const config = loadConfig();
const db = openDb(config.dbPath);
const started = performance.now();

const result = await syncUniverse({
  esi: createEsi({ userAgent: config.userAgent }),
  db,
  log: (line) => {
    console.log(line);
  },
});

const systems = listNullsecSystems(db);
const count = (kind: string) => systems.filter((s) => s.sovKind === kind).length;
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      dbPath: config.dbPath,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      fetched: { regions: result.regionsFetched, systems: result.systemsFetched },
      nullsec: {
        regions: new Set(systems.map((s) => s.regionId)).size,
        constellations: new Set(systems.map((s) => s.constellationId)).size,
        systems: systems.length,
        sov: count("sov"),
        npc: count("npc"),
        unclaimed: count("unclaimed"),
      },
      errors: result.errors,
    },
    null,
    2,
  ),
);
db.close();
process.exitCode = result.ok ? 0 : 1;
