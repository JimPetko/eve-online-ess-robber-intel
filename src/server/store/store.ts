import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { AllianceId, ConstellationId, FactionId, RegionId, SystemId } from "../ids.ts";
import { transaction } from "./db.ts";

type Row = Record<string, SQLOutputValue>;

function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`column ${key}: expected number, got ${typeof value}`);
  return value;
}

function numOrNull(row: Row, key: string): number | null {
  return row[key] === null ? null : num(row, key);
}

function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`column ${key}: expected string, got ${typeof value}`);
  return value;
}

export type SovKind = "sov" | "npc" | "unclaimed";

export interface RegionTree {
  readonly id: RegionId;
  readonly name: string;
  readonly constellations: readonly {
    readonly id: ConstellationId;
    readonly name: string;
    readonly systems: readonly { readonly id: SystemId; readonly name: string; readonly securityStatus: number }[];
  }[];
}

export function knownRegionIds(db: DatabaseSync): Set<RegionId> {
  return new Set(db.prepare("SELECT id FROM regions").all().map((row) => num(row, "id") as RegionId));
}

/** Writes a Region with all its Constellations and Systems atomically, so a stored Region is always complete. */
export function upsertRegionTree(db: DatabaseSync, region: RegionTree): void {
  const upsertRegion = db.prepare(
    "INSERT INTO regions (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name",
  );
  const upsertConstellation = db.prepare(
    `INSERT INTO constellations (id, region_id, name) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET region_id = excluded.region_id, name = excluded.name`,
  );
  const upsertSystem = db.prepare(
    `INSERT INTO systems (id, constellation_id, name, security_status) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET constellation_id = excluded.constellation_id,
       name = excluded.name, security_status = excluded.security_status`,
  );
  transaction(db, () => {
    upsertRegion.run(region.id, region.name);
    for (const constellation of region.constellations) {
      upsertConstellation.run(constellation.id, region.id, constellation.name);
      for (const system of constellation.systems) {
        upsertSystem.run(system.id, constellation.id, system.name, system.securityStatus);
      }
    }
  });
}

export interface SovereigntyEntry {
  readonly systemId: SystemId;
  readonly allianceId: AllianceId | null;
  readonly factionId: FactionId | null;
}

/** Replaces every stored System's sovereignty. Systems absent from the map are unclaimed. */
export function replaceSovereignty(db: DatabaseSync, entries: readonly SovereigntyEntry[]): void {
  const reset = db.prepare(
    "UPDATE systems SET sov_kind = 'unclaimed', sov_alliance_id = NULL, sov_faction_id = NULL",
  );
  const set = db.prepare("UPDATE systems SET sov_kind = ?, sov_alliance_id = ?, sov_faction_id = ? WHERE id = ?");
  transaction(db, () => {
    reset.run();
    for (const entry of entries) {
      const kind: SovKind = entry.allianceId !== null ? "sov" : entry.factionId !== null ? "npc" : "unclaimed";
      set.run(kind, entry.allianceId, entry.factionId, entry.systemId);
    }
  });
}

export interface NullsecSystem {
  readonly id: SystemId;
  readonly name: string;
  readonly securityStatus: number;
  readonly constellationId: ConstellationId;
  readonly constellationName: string;
  readonly regionId: RegionId;
  readonly regionName: string;
  /** null until sovereignty has been refreshed since the System was stored. */
  readonly sovKind: SovKind | null;
  readonly sovAllianceId: AllianceId | null;
  readonly sovFactionId: FactionId | null;
  /** NPC nullsec: an ESS is not verified to exist. */
  readonly essPresenceUnconfirmed: boolean;
}

function sovKind(row: Row): SovKind | null {
  const value = row.sov_kind;
  if (value === null || value === "sov" || value === "npc" || value === "unclaimed") return value ?? null;
  throw new Error(`column sov_kind: unexpected ${String(value)}`);
}

/** Every in-scope System (k-space, true security <= 0.0), optionally limited to one Region. */
export function listNullsecSystems(db: DatabaseSync, regionId?: RegionId): NullsecSystem[] {
  const rows =
    regionId === undefined
      ? db.prepare("SELECT * FROM nullsec_systems ORDER BY id").all()
      : db.prepare("SELECT * FROM nullsec_systems WHERE region_id = ? ORDER BY id").all(regionId);
  return rows.map((row) => {
    const kind = sovKind(row);
    return {
      id: num(row, "id") as SystemId,
      name: str(row, "name"),
      securityStatus: num(row, "security_status"),
      constellationId: num(row, "constellation_id") as ConstellationId,
      constellationName: str(row, "constellation_name"),
      regionId: num(row, "region_id") as RegionId,
      regionName: str(row, "region_name"),
      sovKind: kind,
      sovAllianceId: numOrNull(row, "sov_alliance_id") as AllianceId | null,
      sovFactionId: numOrNull(row, "sov_faction_id") as FactionId | null,
      essPresenceUnconfirmed: kind === "npc",
    };
  });
}

export const SNAPSHOT_RETENTION_DAYS = 30;

/** Records one hourly pull, stamped with ESI Last-Modified. Re-recording the same pull overwrites it. */
export function recordKillSnapshot(
  db: DatabaseSync,
  pulledAt: Date,
  npcKills: ReadonlyMap<SystemId, number>,
): void {
  const upsert = db.prepare(
    `INSERT INTO kill_snapshots (pulled_at, system_id, npc_kills) VALUES (?, ?, ?)
     ON CONFLICT (pulled_at, system_id) DO UPDATE SET npc_kills = excluded.npc_kills`,
  );
  transaction(db, () => {
    for (const [systemId, kills] of npcKills) upsert.run(pulledAt.getTime(), systemId, kills);
  });
}

/** Deletes snapshots pulled more than `retentionDays` before `now`. Returns rows deleted. */
export function pruneKillSnapshots(db: DatabaseSync, now: Date, retentionDays = SNAPSHOT_RETENTION_DAYS): number {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return Number(db.prepare("DELETE FROM kill_snapshots WHERE pulled_at < ?").run(cutoff).changes);
}

export type SyncKind = "universe" | "kills";

export type SyncRunId = number & { readonly __brand: "SyncRunId" };

export function startSyncRun(db: DatabaseSync, kind: SyncKind, startedAt: Date): SyncRunId {
  const result = db.prepare("INSERT INTO sync_runs (kind, started_at) VALUES (?, ?)").run(kind, startedAt.getTime());
  return Number(result.lastInsertRowid) as SyncRunId;
}

export type SyncOutcome =
  | { readonly ok: true; readonly esiLastModified: Date | null }
  | { readonly ok: false; readonly error: string; readonly esiLastModified: Date | null };

export function finishSyncRun(db: DatabaseSync, id: SyncRunId, finishedAt: Date, outcome: SyncOutcome): void {
  db.prepare("UPDATE sync_runs SET finished_at = ?, ok = ?, error = ?, esi_last_modified = ? WHERE id = ?").run(
    finishedAt.getTime(),
    outcome.ok ? 1 : 0,
    outcome.ok ? null : outcome.error,
    outcome.esiLastModified?.getTime() ?? null,
    id,
  );
}

export interface SyncRun {
  readonly id: SyncRunId;
  readonly kind: SyncKind;
  readonly startedAt: Date;
  /** null while the run is in progress or if it died without finishing. */
  readonly finishedAt: Date | null;
  readonly ok: boolean | null;
  readonly error: string | null;
  readonly esiLastModified: Date | null;
}

export function latestSyncRun(db: DatabaseSync, kind: SyncKind): SyncRun | null {
  const row = db.prepare("SELECT * FROM sync_runs WHERE kind = ? ORDER BY started_at DESC, id DESC LIMIT 1").get(kind);
  if (row === undefined) return null;
  const finishedAt = numOrNull(row, "finished_at");
  const ok = numOrNull(row, "ok");
  const lastModified = numOrNull(row, "esi_last_modified");
  const error = row.error;
  return {
    id: num(row, "id") as SyncRunId,
    kind,
    startedAt: new Date(num(row, "started_at")),
    finishedAt: finishedAt === null ? null : new Date(finishedAt),
    ok: ok === null ? null : ok === 1,
    error: typeof error === "string" ? error : null,
    esiLastModified: lastModified === null ? null : new Date(lastModified),
  };
}
