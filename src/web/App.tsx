import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { APP_TITLE } from "../domain/app.ts";
import { DEFAULT_BOUNTY_ASSUMPTIONS, isk, regionId, type RegionId, type RegionSummary } from "../domain/index.ts";
import type { Api } from "./api.ts";
import { ContextMenu, type MenuState } from "./ContextMenu.tsx";
import type { DotlanTarget } from "./dotlan.ts";
import { formatAge } from "./format.ts";
import { FreshnessLine, SyncBanner } from "./Freshness.tsx";
import { useNow, useRegionView } from "./hooks.ts";
import { readStored, writeStored } from "./storage.ts";
import { DEFAULT_SORT, nextSort, SystemTable, type ViewMode } from "./SystemTable.tsx";

export const SURGE_THRESHOLD_KEY = "surgeThresholdMillions";
const REGION_KEY = "regionId";
const DEFAULT_SURGE_MILLIONS = 20;

function storedSurgeMillions(): number {
  const n = Number(readStored(SURGE_THRESHOLD_KEY) ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SURGE_MILLIONS;
}

export function App({ api }: { api: Api }) {
  const now = useNow();
  const [regions, setRegions] = useState<readonly RegionSummary[] | null>(null);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<RegionId | null>(() => {
    const stored = Number(readStored(REGION_KEY));
    return Number.isInteger(stored) && stored > 0 ? regionId(stored) : null;
  });
  const [mode, setMode] = useState<ViewMode>("flat");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [surgeMillions, setSurgeMillions] = useState(storedSurgeMillions);
  const [surgeDraft, setSurgeDraft] = useState(() => String(surgeMillions));
  const [surgesOnly, setSurgesOnly] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    api.regions().then(
      (list) => {
        setRegions(list.regions.toSorted((a, b) => a.name.localeCompare(b.name)));
      },
      (e: unknown) => {
        setRegionsError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [api]);

  const selected = regions?.some((r) => r.id === chosen) ? chosen : (regions?.[0]?.id ?? null);
  const { view, error } = useRegionView(api, selected);

  const openDotlan = useCallback((e: MouseEvent, target: DotlanTarget) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  return (
    <div className="app">
      <header className="top">
        <h1>{APP_TITLE}</h1>
        <label className="control">
          Region
          <select
            value={selected ?? ""}
            onChange={(e) => {
              const id = regionId(Number(e.target.value));
              setChosen(id);
              writeStored(REGION_KEY, String(id));
            }}
          >
            {regions?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.nullsecSystemCount})
              </option>
            ))}
          </select>
        </label>
      </header>

      {regionsError && (
        <div className="banner" role="alert">
          Could not load Regions: {regionsError}
        </div>
      )}
      {error && (
        <div className="banner" role="alert">
          Could not refresh from the API: {error}
          {view && ". Showing the last figures loaded."}
        </div>
      )}
      {view && <SyncBanner sync={view.sync} now={now} />}

      {view && (
        <main>
          <section className="region-head">
            <h2
              title="Right-click to open on Dotlan"
              onContextMenu={(e) => {
                openDotlan(e, { kind: "region", region: view.region.name });
              }}
            >
              {view.region.name}
            </h2>
            <FreshnessLine sync={view.sync} now={now} />
          </section>

          <div className="toolbar">
            <div className="segmented" role="group" aria-label="View">
              {(["flat", "grouped"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); }}>
                  {m === "flat" ? "Flat" : "Grouped"}
                </button>
              ))}
            </div>
            <label className="control">
              Surge Threshold
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={surgeDraft}
                onChange={(e) => {
                  // The draft may be mid-edit (empty, "1."); only a valid number moves the threshold.
                  setSurgeDraft(e.target.value);
                  const n = e.target.valueAsNumber;
                  if (!Number.isFinite(n) || n < 0) return;
                  setSurgeMillions(n);
                  writeStored(SURGE_THRESHOLD_KEY, String(n));
                }}
              />
              <span className="muted">M ISK</span>
            </label>
            <label className="control">
              <input
                type="checkbox"
                checked={surgesOnly}
                onChange={(e) => {
                  setSurgesOnly(e.target.checked);
                }}
              />
              Surges only
            </label>
          </div>

          <SystemTable
            view={view}
            mode={mode}
            sort={sort}
            onSort={(key) => {
              setSort((s) => nextSort(s, key));
            }}
            surgeThreshold={isk(surgeMillions * 1_000_000)}
            surgesOnly={surgesOnly}
            onDotlan={openDotlan}
          />

          <p className="note">
            Robberies and payouts are invisible to this tool, so a Main Bank Ceiling can stay high for up to one
            Payout Cycle ({formatAge(DEFAULT_BOUNTY_ASSUMPTIONS.payoutCycleMinutes * 60_000)}) after the bank was emptied. The true balance lies between zero and the ceiling.
            Right-click a Region, Constellation or System to open it on Dotlan.
          </p>
        </main>
      )}
      {!view && !error && !regionsError && <p className="muted">Loading…</p>}

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}
