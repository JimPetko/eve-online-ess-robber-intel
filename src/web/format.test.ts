import { expect, test } from "vitest";
import { formatAge, formatEveTime, formatIsk } from "./format.ts";

test("ISK reads like the game's shorthand", () => {
  expect(formatIsk(1_234_000_000)).toBe("1.23B");
  expect(formatIsk(456_700_000)).toBe("456.7M");
  expect(formatIsk(20_000_000)).toBe("20.0M");
  expect(formatIsk(12_300)).toBe("12.3K");
  expect(formatIsk(950)).toBe("950");
  expect(formatIsk(0)).toBe("0");
  expect(formatIsk(2_500_000_000_000)).toBe("2.50T");
  expect(formatIsk(999_960_000)).toBe("1.00B");
  expect(formatIsk(999_950)).toBe("1.0M");
  expect(formatIsk(999.6)).toBe("1.0K");
  expect(formatIsk(999_995_000_000)).toBe("1.00T");
  expect(formatIsk(-999_960_000)).toBe("-1.00B");
});

test("ages", () => {
  expect(formatAge(45_000)).toBe("45s");
  expect(formatAge(12 * 60_000)).toBe("12m");
  expect(formatAge(165 * 60_000)).toBe("2h 45m");
  expect(formatAge(26 * 3_600_000)).toBe("1d 2h");
});

test("EVE time is UTC", () => {
  expect(formatEveTime("2026-11-18T14:05:33.000Z")).toBe("2026-11-18 14:05");
});
