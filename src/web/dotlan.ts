const BASE = "https://evemaps.dotlan.net";

/** Dotlan writes spaces as underscores in every path segment. */
const segment = (name: string) => encodeURIComponent(name.replaceAll(" ", "_"));

/**
 * Shapes taken from dotlan's own links (checked 2026-11-18): region pages link
 * constellations as /map/Cloud_Ring/Assilot and systems as /system/00TY-J.
 */
export type DotlanTarget =
  | { readonly kind: "region"; readonly region: string }
  | { readonly kind: "constellation"; readonly region: string; readonly constellation: string }
  | { readonly kind: "system"; readonly system: string };

export function dotlanUrl(target: DotlanTarget): string {
  switch (target.kind) {
    case "region":
      return `${BASE}/map/${segment(target.region)}`;
    case "constellation":
      return `${BASE}/map/${segment(target.region)}/${segment(target.constellation)}`;
    case "system":
      return `${BASE}/system/${segment(target.system)}`;
  }
}

export function dotlanLabel(target: DotlanTarget): string {
  switch (target.kind) {
    case "region":
      return target.region;
    case "constellation":
      return target.constellation;
    case "system":
      return target.system;
  }
}
