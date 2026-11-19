import type { AllianceId, ConstellationId, FactionId, RegionId, SystemId } from "../../domain/index.ts";
import { arrayOf, branded, finite, integer, object, optional, type Parser, string } from "./parse.ts";

export const ESI_BASE_URL = "https://esi.evetech.net";
// Required by ESI; the only value the live spec accepts.
export const ESI_COMPATIBILITY_DATE = "2020-01-01";

export interface EsiResponse<T> {
  readonly data: T;
  readonly lastModified: Date | null;
  readonly expires: Date | null;
}

export class EsiError extends Error {
  override name = "EsiError";
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, body: string) {
    super(`ESI ${String(status)} for ${path}: ${body.slice(0, 200)}`);
    this.status = status;
    this.path = path;
  }
}

export interface EsiOptions {
  readonly userAgent: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  /** Max requests in flight at once, across every caller of this client. */
  readonly maxConcurrency?: number;
  /** Retries after the first attempt for 5xx, network errors, 420 and 429. */
  readonly maxRetries?: number;
  /** Pause all requests until the error window resets once remaining errors fall to this. */
  readonly errorLimitFloor?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const regionId = branded<RegionId>();
const constellationId = branded<ConstellationId>();
const systemId = branded<SystemId>();

const parseRegion = object({ region_id: regionId, name: string, constellations: arrayOf(constellationId) });
const parseConstellation = object({
  constellation_id: constellationId,
  name: string,
  region_id: regionId,
  systems: arrayOf(systemId),
});
const parseSystem = object({
  system_id: systemId,
  name: string,
  constellation_id: constellationId,
  security_status: finite,
});
const parseSovereignty = arrayOf(
  object({
    system_id: systemId,
    alliance_id: optional(branded<AllianceId>()),
    faction_id: optional(branded<FactionId>()),
  }),
);
const parseSystemKills = arrayOf(object({ system_id: systemId, npc_kills: integer }));

export type EsiRegion = ReturnType<typeof parseRegion>;
export type EsiConstellation = ReturnType<typeof parseConstellation>;
export type EsiSystem = ReturnType<typeof parseSystem>;
export type EsiSovereignty = ReturnType<typeof parseSovereignty>;
export type EsiSystemKills = ReturnType<typeof parseSystemKills>;

export interface Esi {
  regionIds(): Promise<EsiResponse<RegionId[]>>;
  region(id: RegionId): Promise<EsiResponse<EsiRegion>>;
  constellation(id: ConstellationId): Promise<EsiResponse<EsiConstellation>>;
  system(id: SystemId): Promise<EsiResponse<EsiSystem>>;
  sovereigntyMap(): Promise<EsiResponse<EsiSovereignty>>;
  systemKills(): Promise<EsiResponse<EsiSystemKills>>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter so a newcomer cannot overtake it.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

function headerDate(headers: Headers, name: string): Date | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function headerSeconds(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function createEsi(options: EsiOptions): Esi {
  const fetchFn = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? ESI_BASE_URL;
  const maxRetries = options.maxRetries ?? 4;
  const errorLimitFloor = options.errorLimitFloor ?? 20;
  const sleep = options.sleep ?? defaultSleep;
  const limit = createLimiter(options.maxConcurrency ?? 20);
  const headers = {
    "User-Agent": options.userAgent,
    "X-Compatibility-Date": ESI_COMPATIBILITY_DATE,
    Accept: "application/json",
  };

  // Shared by every request: while set, nobody sends.
  let pause: Promise<void> | null = null;
  function pauseFor(seconds: number) {
    pause ??= sleep(Math.max(1, seconds) * 1000).then(() => {
      pause = null;
    });
  }

  async function get<T>(path: string, parse: Parser<T>): Promise<EsiResponse<T>> {
    return limit(async () => {
      for (let attempt = 0; ; attempt++) {
        while (pause) await pause;
        const canRetry = attempt < maxRetries;

        let res: Response;
        try {
          res = await fetchFn(baseUrl + path, { headers });
        } catch (error) {
          if (!canRetry) throw error;
          await sleep(backoffMs(attempt));
          continue;
        }

        const remain = headerSeconds(res.headers, "x-esi-error-limit-remain");
        const reset = headerSeconds(res.headers, "x-esi-error-limit-reset");
        if (remain !== null && reset !== null && remain <= errorLimitFloor) pauseFor(reset);

        if (res.ok) {
          const body: unknown = await res.json();
          return {
            data: parse(body, path),
            lastModified: headerDate(res.headers, "last-modified"),
            expires: headerDate(res.headers, "expires"),
          };
        }

        const body = await res.text();
        if ((res.status === 420 || res.status === 429) && canRetry) {
          pauseFor(headerSeconds(res.headers, "retry-after") ?? reset ?? 60);
          continue;
        }
        if (res.status >= 500 && canRetry) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new EsiError(res.status, path, body);
      }
    });
  }

  return {
    regionIds: () => get("/universe/regions", arrayOf(regionId)),
    region: (id) => get(`/universe/regions/${String(id)}`, parseRegion),
    constellation: (id) => get(`/universe/constellations/${String(id)}`, parseConstellation),
    system: (id) => get(`/universe/systems/${String(id)}`, parseSystem),
    sovereigntyMap: () => get("/sovereignty/map", parseSovereignty),
    systemKills: () => get("/universe/system_kills", parseSystemKills),
  };
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}
