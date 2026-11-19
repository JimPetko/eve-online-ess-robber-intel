import type { RegionId, RegionList, RegionView } from "../domain/index.ts";
import { FIXTURE_REGIONS, fixtureRegionView, type FixtureSync } from "./fixtures/region-view.ts";

export type Api = {
  readonly regions: () => Promise<RegionList>;
  readonly regionView: (id: RegionId) => Promise<RegionView>;
};

async function getJson<T>(fetchFn: typeof fetch, path: string): Promise<T> {
  const res = await fetchFn(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

/** Our own API; its types are the shared domain contract, so no runtime parse. */
export function httpApi(fetchFn: typeof fetch = fetch): Api {
  return {
    regions: () => getJson<RegionList>(fetchFn, "/api/regions"),
    regionView: (id) => getJson<RegionView>(fetchFn, `/api/regions/${String(id)}`),
  };
}

/** Serves the fixture with timestamps relative to each call, so freshness stays put. */
export function fixtureApi(sync: FixtureSync = "recent", now: () => Date = () => new Date()): Api {
  return {
    regions: () => Promise.resolve(FIXTURE_REGIONS),
    regionView: (id) => {
      const delve = fixtureRegionView(now(), sync);
      if (id === delve.region.id) return Promise.resolve(delve);
      const summary = FIXTURE_REGIONS.regions.find((r) => r.id === id);
      if (!summary) return Promise.reject(new Error(`/api/regions/${String(id)}: HTTP 404`));
      return Promise.resolve({
        ...delve,
        region: { id: summary.id, name: summary.name },
        constellations: [],
        systems: [],
      });
    },
  };
}
