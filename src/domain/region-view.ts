import type { ConstellationId, Isk, RegionId, SystemId } from "./ids.ts";
import type { MainBankCeiling } from "./main-bank.ts";
import type { ReserveBankEstimate } from "./reserve-bank.ts";

/**
 * The JSON contract between the API and the web UI. Every type here survives
 * JSON.stringify/parse unchanged, so timestamps are ISO 8601 strings.
 */
export type IsoTimestamp = string;

/** `GET /api/regions` */
export type RegionList = { readonly regions: readonly RegionSummary[] };

export type RegionSummary = {
  readonly id: RegionId;
  readonly name: string;
  readonly nullsecSystemCount: number;
};

/** One run of the hourly `system_kills` pull. */
export type SyncAttempt =
  | { readonly at: IsoTimestamp; readonly ok: true }
  | { readonly at: IsoTimestamp; readonly ok: false; readonly error: string };

/**
 * Region-wide, because one `system_kills` response covers every System
 * (absent Systems had 0 kills), so every System shares the same pull.
 */
export type SyncStatus = {
  /** Wall-clock time of the last successful pull; Stale is measured from here. */
  readonly lastSuccessAt: IsoTimestamp | null;
  readonly lastAttempt: SyncAttempt | null;
  /** ESI `Last-Modified` of the snapshot the figures come from ("data as of"). */
  readonly dataAsOf: IsoTimestamp | null;
  readonly nextPullAt: IsoTimestamp | null;
};

/** `null` until the sovereignty map has been pulled. NPC-null carries ESS Presence Unconfirmed. */
export type SovKind = "sov" | "npc" | "unclaimed";

export type SystemView = {
  readonly id: SystemId;
  readonly name: string;
  readonly constellationId: ConstellationId;
  readonly securityStatus: number;
  readonly sovKind: SovKind | null;
  readonly mainBank: MainBankCeiling;
  /** As of the prior pull, so the client can find Surges for any Surge Threshold. */
  readonly previousMainBank: MainBankCeiling | null;
  /** Sent rather than derived, because the server's Bounty Assumptions are configurable. */
  readonly robberTake: Isk;
  readonly reserve: ReserveBankEstimate;
};

/**
 * `GET /api/regions/:id`; 404 for an unknown Region. Constellation totals are
 * left to the client (`constellationCeiling`) so they cannot disagree with
 * the Systems they sum.
 */
export type RegionView = {
  readonly region: { readonly id: RegionId; readonly name: string };
  readonly sync: SyncStatus;
  readonly constellations: readonly { readonly id: ConstellationId; readonly name: string }[];
  readonly systems: readonly SystemView[];
};
