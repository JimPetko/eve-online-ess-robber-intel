import type { DatabaseSync } from "node:sqlite";
import type { Esi } from "../esi/client.ts";
import type { RegionId } from "../ids.ts";
import {
  finishSyncRun,
  knownRegionIds,
  type RegionTree,
  replaceSovereignty,
  startSyncRun,
  upsertRegionTree,
} from "../store/store.ts";

export const POCHVEN_REGION_ID = 10000070;
export const FIRST_WORMHOLE_REGION_ID = 11000000;

export function isKspaceRegion(id: RegionId): boolean {
  return id < FIRST_WORMHOLE_REGION_ID && id !== POCHVEN_REGION_ID;
}

export interface UniverseSyncDeps {
  readonly esi: Esi;
  readonly db: DatabaseSync;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

export interface UniverseSyncResult {
  readonly ok: boolean;
  readonly regionsFetched: number;
  readonly systemsFetched: number;
  readonly sovereigntyEntries: number;
  readonly errors: readonly string[];
}

async function fetchRegionTree(esi: Esi, id: RegionId): Promise<RegionTree> {
  const region = (await esi.region(id)).data;
  const constellations = await Promise.all(
    region.constellations.map(async (constellationId) => {
      const constellation = (await esi.constellation(constellationId)).data;
      const systems = await Promise.all(constellation.systems.map(async (systemId) => (await esi.system(systemId)).data));
      return {
        id: constellation.constellation_id,
        name: constellation.name,
        systems: systems.map((s) => ({ id: s.system_id, name: s.name, securityStatus: s.security_status })),
      };
    }),
  );
  return { id: region.region_id, name: region.name, constellations };
}

/**
 * Fetches static data for k-space Regions not yet stored (each Region written atomically with its
 * Constellations and Systems), then refreshes sovereignty for every stored System. Safe to rerun:
 * a failed Region is retried next run, and stored Regions are not refetched.
 */
export async function syncUniverse({
  esi,
  db,
  log = () => undefined,
  now = () => new Date(),
}: UniverseSyncDeps): Promise<UniverseSyncResult> {
  const runId = startSyncRun(db, "universe", now());
  const errors: string[] = [];
  let regionsFetched = 0;
  let systemsFetched = 0;
  let sovereigntyEntries = 0;
  let sovLastModified: Date | null = null;

  try {
    const known = knownRegionIds(db);
    const missing = (await esi.regionIds()).data.filter((id) => isKspaceRegion(id) && !known.has(id));
    log(`universe: ${String(known.size)} regions stored, ${String(missing.length)} to fetch`);

    await Promise.all(
      missing.map(async (id) => {
        try {
          const tree = await fetchRegionTree(esi, id);
          upsertRegionTree(db, tree);
          const systems = tree.constellations.reduce((n, c) => n + c.systems.length, 0);
          regionsFetched++;
          systemsFetched += systems;
          log(`universe: region ${tree.name} (${String(regionsFetched)}/${String(missing.length)}), ${String(systems)} systems`);
        } catch (error) {
          errors.push(`region ${String(id)}: ${message(error)}`);
        }
      }),
    );

    const sov = await esi.sovereigntyMap();
    replaceSovereignty(
      db,
      sov.data.map((entry) => ({ systemId: entry.system_id, allianceId: entry.alliance_id, factionId: entry.faction_id })),
    );
    sovereigntyEntries = sov.data.length;
    sovLastModified = sov.lastModified;
    log(`universe: sovereignty refreshed (${String(sovereigntyEntries)} entries)`);
  } catch (error) {
    errors.push(message(error));
  }

  finishSyncRun(
    db,
    runId,
    now(),
    errors.length === 0
      ? { ok: true, esiLastModified: sovLastModified }
      : { ok: false, error: errors.join("; "), esiLastModified: sovLastModified },
  );
  return { ok: errors.length === 0, regionsFetched, systemsFetched, sovereigntyEntries, errors };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
