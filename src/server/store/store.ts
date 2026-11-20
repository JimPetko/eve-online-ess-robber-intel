import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type {
  AllianceId,
  ConstellationId,
  FactionId,
  HourlyKills,
  RegionId,
  RegionSummary,
  SystemId,
} from "../../domain/index.ts";
import { transaction } from "./db.ts";

type Row = Record<string, SQLOutputValue>;

function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number")
    throw new Error(`column ${key}: expected number, got ${typeof value}`);
  return value;
}

function numOrNull(row: Row, key: string): number | null {
  return row[key] === null ? null : num(row, key);
}

function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new Error(`column ${key}: expected string, got ${typeof value}`);
  return value;
}

export type SovKind = "sov" | "npc" | "unclaimed";

export interface RegionTree {
  readonly id: RegionId;
  readonly name: string;
  readonly constellations: readonly {
    readonly id: ConstellationId;
    readonly name: string;
    readonly systems: readonly {
      readonly id: SystemId;
      readonly name: string;
      readonly securityStatus: number;
    }[];
  }[];
}

export function knownRegionIds(db: DatabaseSync): Set<RegionId> {
  return new Set(
    db
      .prepare("SELECT id FROM regions")
      .all()
      .map((row) => num(row, "id") as RegionId),
  );
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
        upsertSystem.run(
          system.id,
          constellation.id,
          system.name,
          system.securityStatus,
        );
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
export function replaceSovereignty(
  db: DatabaseSync,
  entries: readonly SovereigntyEntry[],
): void {
  const reset = db.prepare(
    "UPDATE systems SET sov_kind = 'unclaimed', sov_alliance_id = NULL, sov_faction_id = NULL",
  );
  const set = db.prepare(
    "UPDATE systems SET sov_kind = ?, sov_alliance_id = ?, sov_faction_id = ? WHERE id = ?",
  );
  transaction(db, () => {
    reset.run();
    for (const entry of entries) {
      const kind: SovKind =
        entry.allianceId !== null
          ? "sov"
          : entry.factionId !== null
            ? "npc"
            : "unclaimed";
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
  /** The alliance holding sovereignty, which is what puts an ESS in the System. */
  readonly sovAllianceId: AllianceId;
}

/**
 * Every in-scope System (k-space, true security <= 0.0, sov-held as of the last sovereignty
 * refresh), optionally limited to one Region.
 */
export function listNullsecSystems(
  db: DatabaseSync,
  regionId?: RegionId,
): NullsecSystem[] {
  const rows =
    regionId === undefined
      ? db.prepare("SELECT * FROM nullsec_systems ORDER BY id").all()
      : db
          .prepare(
            "SELECT * FROM nullsec_systems WHERE region_id = ? ORDER BY id",
          )
          .all(regionId);
  return rows.map((row) => ({
    id: num(row, "id") as SystemId,
    name: str(row, "name"),
    securityStatus: num(row, "security_status"),
    constellationId: num(row, "constellation_id") as ConstellationId,
    constellationName: str(row, "constellation_name"),
    regionId: num(row, "region_id") as RegionId,
    regionName: str(row, "region_name"),
    sovAllianceId: num(row, "sov_alliance_id") as AllianceId,
  }));
}

/**
 * Why no System is in scope: nothing stored yet, no sovereignty refresh has succeeded yet
 * (sov_kind is still NULL everywhere), or the sovereignty map holds no sov-held nullsec.
 */
export function emptyScopeReason(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT COUNT(*) AS n, COUNT(sov_kind) AS withSov FROM systems")
    .get();
  if (row === undefined || num(row, "n") === 0)
    return "no Systems stored; the universe sync has not run";
  if (num(row, "withSov") === 0)
    return "no sovereignty map stored; the sovereignty refresh has not succeeded yet";
  return "the sovereignty map shows no sov-held nullsec Systems";
}

/** Regions holding at least one in-scope System, by name. */
export function listNullsecRegions(db: DatabaseSync): RegionSummary[] {
  return db
    .prepare(
      `SELECT region_id, region_name, COUNT(*) AS n FROM nullsec_systems
       GROUP BY region_id, region_name ORDER BY region_name`,
    )
    .all()
    .map((row) => ({
      id: num(row, "region_id") as RegionId,
      name: str(row, "region_name"),
      nullsecSystemCount: num(row, "n"),
    }));
}

export const SNAPSHOT_RETENTION_DAYS = 30;

/**
 * Records one hourly pull, stamped with ESI Last-Modified. Rows already stored for that pull are
 * kept as they are, so recording the same pull again is a no-op. Returns rows inserted.
 */
export function recordKillSnapshot(
  db: DatabaseSync,
  pulledAt: Date,
  npcKills: ReadonlyMap<SystemId, number>,
): number {
  const insert = db.prepare(
    "INSERT INTO kill_snapshots (pulled_at, system_id, npc_kills) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
  );
  return transaction(db, () => {
    let inserted = 0;
    for (const [systemId, kills] of npcKills)
      inserted += Number(
        insert.run(pulledAt.getTime(), systemId, kills).changes,
      );
    return inserted;
  });
}

/** Deletes snapshots pulled more than `retentionDays` before `now`. Returns rows deleted. */
export function pruneKillSnapshots(
  db: DatabaseSync,
  now: Date,
  retentionDays = SNAPSHOT_RETENTION_DAYS,
): number {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return Number(
    db.prepare("DELETE FROM kill_snapshots WHERE pulled_at < ?").run(cutoff)
      .changes,
  );
}

export type SyncKind = "universe" | "kills";

export type SyncRunId = number & { readonly __brand: "SyncRunId" };

export function startSyncRun(
  db: DatabaseSync,
  kind: SyncKind,
  startedAt: Date,
): SyncRunId {
  const result = db
    .prepare("INSERT INTO sync_runs (kind, started_at) VALUES (?, ?)")
    .run(kind, startedAt.getTime());
  return Number(result.lastInsertRowid) as SyncRunId;
}

export type SyncOutcome =
  | { readonly ok: true; readonly esiLastModified: Date | null }
  | {
      readonly ok: false;
      readonly error: string;
      readonly esiLastModified: Date | null;
    };

export function finishSyncRun(
  db: DatabaseSync,
  id: SyncRunId,
  finishedAt: Date,
  outcome: SyncOutcome,
): void {
  db.prepare(
    "UPDATE sync_runs SET finished_at = ?, ok = ?, error = ?, esi_last_modified = ? WHERE id = ?",
  ).run(
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

function latestRunWhere(
  db: DatabaseSync,
  kind: SyncKind,
  condition: string,
): SyncRun | null {
  const row = db
    .prepare(
      `SELECT * FROM sync_runs WHERE kind = ? AND ${condition} ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(kind);
  return row === undefined ? null : syncRun(row, kind);
}

/** Includes a run still in progress. */
export function latestSyncRun(
  db: DatabaseSync,
  kind: SyncKind,
): SyncRun | null {
  return latestRunWhere(db, kind, "1");
}

export function latestFinishedSyncRun(
  db: DatabaseSync,
  kind: SyncKind,
): SyncRun | null {
  return latestRunWhere(db, kind, "finished_at IS NOT NULL");
}

export function latestSuccessfulSyncRun(
  db: DatabaseSync,
  kind: SyncKind,
): SyncRun | null {
  return latestRunWhere(db, kind, "ok = 1");
}

function syncRun(row: Row, kind: SyncKind): SyncRun {
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

export interface SystemKillHistory extends NullsecSystem {
  /** Oldest first. An hour with no entry is a gap, not 0 kills. */
  readonly history: readonly HourlyKills[];
}

export interface RegionKills {
  /** Every in-scope System in the Region, ordered by id. Empty for an unknown Region. */
  readonly systems: readonly SystemKillHistory[];
  /** The most recent finished kills poll, successful or not; null before the first finishes. */
  readonly latestRun: SyncRun | null;
  /** The most recent successful kills poll; its esiLastModified is "data as of". */
  readonly latestSuccess: SyncRun | null;
}

/** A Region's in-scope Systems with their retained hourly kills, plus the kills poll status. */
export function regionKills(db: DatabaseSync, regionId: RegionId): RegionKills {
  const histories = new Map<number, HourlyKills[]>();
  const rows = db
    .prepare(
      // IN, not a join, so SQLite seeks the index per System instead of scanning every stored snapshot.
      `SELECT system_id, pulled_at, npc_kills FROM kill_snapshots
       WHERE system_id IN (SELECT id FROM nullsec_systems WHERE region_id = ?)
       ORDER BY system_id, pulled_at`,
    )
    .all(regionId);
  for (const row of rows) {
    const id = num(row, "system_id");
    const entry: HourlyKills = {
      hourEnding: new Date(num(row, "pulled_at")),
      npcKills: num(row, "npc_kills"),
    };
    const history = histories.get(id);
    if (history) history.push(entry);
    else histories.set(id, [entry]);
  }
  return {
    systems: listNullsecSystems(db, regionId).map((system) => ({
      ...system,
      history: histories.get(system.id) ?? [],
    })),
    latestRun: latestFinishedSyncRun(db, "kills"),
    latestSuccess: latestSuccessfulSyncRun(db, "kills"),
  };
}
