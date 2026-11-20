import type { DatabaseSync } from "node:sqlite";
import type { SystemId } from "../../domain/index.ts";
import type { Esi } from "../esi/client.ts";
import {
  emptyScopeReason,
  finishSyncRun,
  listNullsecSystems,
  pruneKillSnapshots,
  recordKillSnapshot,
  startSyncRun,
} from "../store/store.ts";

/** ESI caches /universe/system_kills for an hour: Expires is Last-Modified + 1h. */
const SYSTEM_KILLS_CACHE_MS = 3_600_000;

export interface KillsPollDeps {
  readonly esi: Esi;
  readonly db: DatabaseSync;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

export type KillsPollResult =
  | {
      readonly ok: true;
      /** The hour the snapshot covers, from ESI Last-Modified. */
      readonly pulledAt: Date;
      /** 0 when this pull was already stored. */
      readonly rowsInserted: number;
      readonly rowsPruned: number;
      /** When ESI will serve the next hour; null if ESI sent no Expires. */
      readonly expires: Date | null;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Pulls the last hour of NPC kills and stores a snapshot covering every stored nullsec System:
 * a System absent from the response had 0 kills. Safe to rerun: a pull already stored inserts
 * nothing. A failed poll is recorded and leaves stored snapshots untouched.
 */
export async function pollKills({
  esi,
  db,
  log = () => undefined,
  now = () => new Date(),
}: KillsPollDeps): Promise<KillsPollResult> {
  const runId = startSyncRun(db, "kills", now());
  try {
    const systems = listNullsecSystems(db);
    if (systems.length === 0) throw new Error(`no sov-held nullsec Systems in scope: ${emptyScopeReason(db)}`);

    const response = await esi.systemKills();
    const pulledAt =
      response.lastModified ??
      (response.expires && new Date(response.expires.getTime() - SYSTEM_KILLS_CACHE_MS));
    if (!pulledAt) throw new Error("ESI sent neither Last-Modified nor Expires; cannot tell which hour this is");

    const reported = new Map(response.data.map((entry) => [entry.system_id, entry.npc_kills]));
    const snapshot = new Map<SystemId, number>(systems.map((s) => [s.id, reported.get(s.id) ?? 0]));
    const rowsInserted = recordKillSnapshot(db, pulledAt, snapshot);
    const rowsPruned = pruneKillSnapshots(db, now());

    finishSyncRun(db, runId, now(), { ok: true, esiLastModified: pulledAt });
    log(
      `kills: snapshot ${pulledAt.toISOString()}, ${String(rowsInserted)} rows inserted, ${String(rowsPruned)} pruned`,
    );
    return { ok: true, pulledAt, rowsInserted, rowsPruned, expires: response.expires };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishSyncRun(db, runId, now(), { ok: false, error: message, esiLastModified: null });
    log(`kills: failed: ${message}`);
    return { ok: false, error: message };
  }
}
