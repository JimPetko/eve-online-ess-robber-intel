import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Append only. Index + 1 is the schema version stored in PRAGMA user_version.
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE regions (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE constellations (
    id        INTEGER PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id),
    name      TEXT NOT NULL
  );
  -- Every k-space System is kept so later syncs know what they already fetched.
  -- Scope (sov-held nullsec) is applied by the nullsec_systems view.
  CREATE TABLE systems (
    id               INTEGER PRIMARY KEY,
    constellation_id INTEGER NOT NULL REFERENCES constellations(id),
    name             TEXT NOT NULL,
    security_status  REAL NOT NULL,
    -- NULL until the first sovereignty refresh after the System was stored.
    sov_kind         TEXT CHECK (sov_kind IN ('sov', 'npc', 'unclaimed')),
    sov_alliance_id  INTEGER,
    sov_faction_id   INTEGER
  );
  CREATE INDEX systems_constellation ON systems(constellation_id);

  CREATE VIEW nullsec_systems AS
    SELECT s.id, s.name, s.security_status, s.sov_kind, s.sov_alliance_id, s.sov_faction_id,
           c.id AS constellation_id, c.name AS constellation_name,
           r.id AS region_id, r.name AS region_name
    FROM systems s
    JOIN constellations c ON c.id = s.constellation_id
    JOIN regions r ON r.id = c.region_id
    WHERE s.security_status <= 0.0;

  -- One row per System per hourly pull. pulled_at is ESI Last-Modified in epoch ms.
  CREATE TABLE kill_snapshots (
    pulled_at INTEGER NOT NULL,
    system_id INTEGER NOT NULL REFERENCES systems(id),
    npc_kills INTEGER NOT NULL CHECK (npc_kills >= 0),
    PRIMARY KEY (pulled_at, system_id)
  ) WITHOUT ROWID;
  CREATE INDEX kill_snapshots_system ON kill_snapshots(system_id, pulled_at);

  CREATE TABLE sync_runs (
    id                INTEGER PRIMARY KEY,
    kind              TEXT NOT NULL CHECK (kind IN ('universe', 'kills')),
    started_at        INTEGER NOT NULL,
    finished_at       INTEGER,
    ok                INTEGER CHECK (ok IN (0, 1)),
    error             TEXT,
    esi_last_modified INTEGER
  );
  CREATE INDEX sync_runs_kind ON sync_runs(kind, started_at);
  `,
  // Jove Regions are unreachable, so the universe sync now skips them. Drop any it stored earlier.
  `
  DELETE FROM kill_snapshots WHERE system_id IN (
    SELECT s.id FROM systems s JOIN constellations c ON c.id = s.constellation_id
    WHERE c.region_id IN (10000004, 10000017, 10000019));
  DELETE FROM systems WHERE constellation_id IN (
    SELECT id FROM constellations WHERE region_id IN (10000004, 10000017, 10000019));
  DELETE FROM constellations WHERE region_id IN (10000004, 10000017, 10000019);
  DELETE FROM regions WHERE id IN (10000004, 10000017, 10000019);
  `,
  // Covering, so reading a Region's history never seeks back into the table for npc_kills.
  `
  DROP INDEX kill_snapshots_system;
  CREATE INDEX kill_snapshots_system ON kill_snapshots(system_id, pulled_at, npc_kills);
  `,
  // Only sov-held nullsec has an ESS, so NPC and unclaimed Systems leave scope, as does a System
  // whose sovereignty is not yet known. Their rows stay; only the view stops returning them.
  `
  DROP VIEW nullsec_systems;
  CREATE VIEW nullsec_systems AS
    SELECT s.id, s.name, s.security_status, s.sov_kind, s.sov_alliance_id,
           c.id AS constellation_id, c.name AS constellation_name,
           r.id AS region_id, r.name AS region_name
    FROM systems s
    JOIN constellations c ON c.id = s.constellation_id
    JOIN regions r ON r.id = c.region_id
    WHERE s.security_status <= 0.0 AND s.sov_kind = 'sov';
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Opens (creating if needed) the database and brings its schema up to date. ":memory:" for tests. */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get();
  const current = typeof row?.user_version === "number" ? row.user_version : 0;
  if (current > MIGRATIONS.length) {
    throw new Error(`database schema v${String(current)} is newer than this build (v${String(MIGRATIONS.length)})`);
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version] ?? "");
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
    });
  }
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
