const UNITS = [
  { size: 1e12, suffix: "T", digits: 2 },
  { size: 1e9, suffix: "B", digits: 2 },
  { size: 1e6, suffix: "M", digits: 1 },
  { size: 1e3, suffix: "K", digits: 1 },
] as const;

/**
 * 1_234_000_000 → "1.23B", 456_700_000 → "456.7M". The unit is chosen after rounding, so
 * 999_960_000 is "1.00B", not "1000.0M".
 */
export function formatIsk(amount: number): string {
  const abs = Math.abs(amount);
  if (Math.round(abs) < 1000) return String(Math.round(amount));
  const unit =
    UNITS.findLast((u) => Number((abs / u.size).toFixed(u.digits)) < 1000) ?? UNITS[0];
  return `${(amount / unit.size).toFixed(unit.digits)}${unit.suffix}`;
}

/** "45s", "12m", "2h 05m", "3d 4h". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ${String(m % 60).padStart(2, "0")}m`;
  return `${String(Math.floor(h / 24))}d ${String(h % 24)}h`;
}

/** EVE time is UTC: "2026-11-18 14:05". */
export function formatEveTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}
