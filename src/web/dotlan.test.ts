import { expect, test } from "vitest";
import { dotlanUrl } from "./dotlan.ts";

test("Region opens its dotlan map, spaces as underscores", () => {
  expect(dotlanUrl({ kind: "region", region: "Delve" })).toBe("https://evemaps.dotlan.net/map/Delve");
  expect(dotlanUrl({ kind: "region", region: "Cloud Ring" })).toBe("https://evemaps.dotlan.net/map/Cloud_Ring");
});

test("Constellation opens under its Region's map", () => {
  expect(dotlanUrl({ kind: "constellation", region: "Delve", constellation: "O-EIMK" })).toBe(
    "https://evemaps.dotlan.net/map/Delve/O-EIMK",
  );
  expect(dotlanUrl({ kind: "constellation", region: "The Bleak Lands", constellation: "Sasen" })).toBe(
    "https://evemaps.dotlan.net/map/The_Bleak_Lands/Sasen",
  );
});

test("System opens its system page", () => {
  expect(dotlanUrl({ kind: "system", system: "1DQ1-A" })).toBe("https://evemaps.dotlan.net/system/1DQ1-A");
  expect(dotlanUrl({ kind: "system", system: "Old Man Star" })).toBe(
    "https://evemaps.dotlan.net/system/Old_Man_Star",
  );
});

test("names cannot break out of their path segment", () => {
  expect(dotlanUrl({ kind: "system", system: "a/b?c" })).toBe("https://evemaps.dotlan.net/system/a%2Fb%3Fc");
});
