import { expect, test } from "vitest";
import { securityBand } from "./bounty-assumptions.ts";

test.each([
  [0, "0.0 to -0.2"],
  [-0.19, "0.0 to -0.2"],
  [-0.2, "-0.2 to -0.4"],
  [-0.4, "-0.4 to -0.6"],
  [-0.6, "-0.6 to -0.8"],
  [-0.79, "-0.6 to -0.8"],
  [-0.8, "-0.8 to -1.0"],
  [-1, "-0.8 to -1.0"],
])("security %d is in band %s", (security, band) => {
  expect(securityBand(security)).toBe(band);
});

test("rejects security above nullsec", () => {
  expect(() => securityBand(0.01)).toThrow(RangeError);
  expect(() => securityBand(Number.NaN)).toThrow(RangeError);
});
