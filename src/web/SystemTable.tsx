import { useState, type MouseEvent } from "react";
import {
  constellationCeiling,
  surge,
  type ConstellationId,
  type Isk,
  type RegionView,
  type Surge,
  type SystemView,
} from "../domain/index.ts";
import type { DotlanTarget } from "./dotlan.ts";
import { formatIsk } from "./format.ts";

export type SortKey = "name" | "mainBank" | "robberTake" | "reserve";
export type Sort = { readonly key: SortKey; readonly dir: "asc" | "desc" };
export type ViewMode = "flat" | "grouped";

export const DEFAULT_SORT: Sort = { key: "mainBank", dir: "desc" };

const NUMERIC: Record<Exclude<SortKey, "name">, (s: SystemView) => number> = {
  mainBank: (s) => s.mainBank.ceiling,
  robberTake: (s) => s.robberTake,
  reserve: (s) => s.reserve.low,
};

const COLUMNS: readonly { key: SortKey; label: string; className: string }[] = [
  { key: "name", label: "System", className: "col-name" },
  { key: "mainBank", label: "Main Bank Ceiling", className: "num" },
  { key: "robberTake", label: "Robber Take", className: "num" },
  { key: "reserve", label: "Reserve Bank Estimate (floor)", className: "num col-reserve" },
];

/** Clicking the active column flips it; a new column starts richest (or A) first. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Sorts by `sort`, ties broken by name A–Z whatever the direction. */
function sorted<T extends { name: string }>(items: readonly T[], sort: Sort, value: (t: T) => number) {
  const sign = sort.dir === "asc" ? 1 : -1;
  return items.toSorted((a, b) => {
    const primary = sort.key === "name" ? byName(a, b) : value(a) - value(b);
    return sign * primary || byName(a, b);
  });
}

const systemValue = (key: SortKey) => (key === "name" ? () => 0 : NUMERIC[key]);

function systemSurge(s: SystemView, threshold: Isk): Surge {
  return s.previousMainBank ? surge(s.previousMainBank, s.mainBank, threshold) : { kind: "none" };
}

type OpenDotlan = (e: MouseEvent, target: DotlanTarget) => void;

type Props = {
  readonly view: RegionView;
  readonly mode: ViewMode;
  readonly sort: Sort;
  readonly onSort: (key: SortKey) => void;
  readonly surgeThreshold: Isk;
  readonly surgesOnly: boolean;
  readonly onDotlan: OpenDotlan;
};

export function SystemTable({ view, mode, sort, onSort, surgeThreshold, surgesOnly, onDotlan }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ConstellationId>>(new Set());
  const surges = new Map(view.systems.map((s) => [s.id, systemSurge(s, surgeThreshold)]));
  const visible = (s: SystemView) => !surgesOnly || surges.get(s.id)?.kind === "surge";
  const value = systemValue(sort.key);

  const row = (s: SystemView) => (
    <SystemRow key={s.id} system={s} surge={surges.get(s.id) ?? { kind: "none" }} onDotlan={onDotlan} />
  );

  const toggle = (id: ConstellationId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  let body;
  if (mode === "flat") {
    const systems = sorted(view.systems.filter(visible), sort, value);
    body = systems.length ? <tbody>{systems.map(row)}</tbody> : <EmptyBody surgesOnly={surgesOnly} />;
  } else {
    const groups = view.constellations.map((c) => {
      const members = view.systems.filter((s) => s.constellationId === c.id);
      return {
        ...c,
        members,
        shown: sorted(members.filter(visible), sort, value),
        total: constellationCeiling(members.map((s) => s.mainBank)),
        sum: (key: SortKey) => members.reduce((acc, s) => acc + systemValue(key)(s), 0),
      };
    });
    const shownGroups = sorted(
      groups.filter((g) => g.shown.length > 0),
      sort,
      (g) => g.sum(sort.key),
    );
    body = shownGroups.length ? (
      shownGroups.map((g) => {
        const open = !collapsed.has(g.id);
        return (
          <tbody key={g.id} className="constellation">
            <tr
              className="constellation-row"
              onContextMenu={(e) => {
                onDotlan(e, { kind: "constellation", region: view.region.name, constellation: g.name });
              }}
            >
              <th scope="rowgroup" className="col-name">
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={open}
                  onClick={() => {
                    toggle(g.id);
                  }}
                >
                  <span aria-hidden="true">{open ? "▾" : "▸"}</span> {g.name}
                </button>
                <span className="muted"> {g.members.length} Systems</span>{" "}
                {g.total.warmingUpSystems > 0 && (
                  <span className="badge warming" title="Total understates: some Systems are Warming Up">
                    {g.total.warmingUpSystems} Warming Up
                  </span>
                )}
              </th>
              <td className="col-sec" />
              <td className="num">{formatIsk(g.total.ceiling)}</td>
              <td className="num">{formatIsk(g.sum("robberTake"))}</td>
              <td className="num col-reserve" />
            </tr>
            {open && g.shown.map(row)}
          </tbody>
        );
      })
    ) : (
      <EmptyBody surgesOnly={surgesOnly} />
    );
  }

  return (
    <div className="table-wrap">
      <table className="systems">
        <thead>
          <tr>
            {COLUMNS.slice(0, 1).map((c) => (
              <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />
            ))}
            <th className="col-sec num" title="True security status">
              Sec
            </th>
            {COLUMNS.slice(1).map((c) => (
              <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        {body}
      </table>
    </div>
  );
}

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === column.key;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th className={column.className} aria-sort={ariaSort} scope="col">
      <button
        type="button"
        className="sort"
        onClick={() => {
          onSort(column.key);
        }}
      >
        {column.label}
        <span aria-hidden="true" className="sort-arrow">
          {active ? (sort.dir === "asc" ? " ▴" : " ▾") : ""}
        </span>
      </button>
    </th>
  );
}

function SystemRow({ system: s, surge, onDotlan }: { system: SystemView; surge: Surge; onDotlan: OpenDotlan }) {
  return (
    <tr className={surge.kind === "surge" ? "system surging" : "system"}>
      <th
        scope="row"
        className="col-name"
        onContextMenu={(e) => {
          onDotlan(e, { kind: "system", system: s.name });
        }}
      >
        <span className="system-name">{s.name}</span>{" "}
        {s.mainBank.status === "warmingUp" && (
          <span
            className="badge warming"
            title="History does not yet cover a full Payout Cycle, so this ceiling understates"
          >
            Warming Up {s.mainBank.hoursCovered}/{s.mainBank.hoursNeeded}h
          </span>
        )}
      </th>
      <td className="num col-sec">{s.securityStatus.toFixed(2)}</td>
      <td className="num">
        {surge.kind === "surge" && (
          <span className="surge" title="Surge: rise since the previous pull">
            ▲ +{formatIsk(surge.delta)}{" "}
          </span>
        )}
        {formatIsk(s.mainBank.ceiling)}
      </td>
      <td className="num">{formatIsk(s.robberTake)}</td>
      <td className="num col-reserve" title={`Gained over ${String(s.reserve.hoursCovered)}h of history; a floor, not the balance`}>
        {s.reserve.low === 0 && s.reserve.high === 0
          ? "—"
          : `≥ ${formatIsk(s.reserve.low)}–${formatIsk(s.reserve.high)}`}
      </td>
    </tr>
  );
}

function EmptyBody({ surgesOnly }: { surgesOnly: boolean }) {
  return (
    <tbody>
      <tr>
        <td colSpan={5} className="empty">
          {surgesOnly ? "No Surges at this Surge Threshold." : "No Systems synced for this Region yet."}
        </td>
      </tr>
    </tbody>
  );
}
