import { expect, test } from "vitest";
import { DEFAULT_BOUNTY_ASSUMPTIONS, iskPerNpcKill } from "./bounty-assumptions.ts";
import { regionId } from "./ids.ts";
import { ISK_PER_NPC_KILL_CALIBRATION } from "./isk-per-npc-kill.generated.ts";

const VALE_OF_THE_SILENT = regionId(10000003);
const DERELIK = regionId(10000001); // highsec, so never calibrated

test("a calibrated Region prices kills at its own figure", () => {
  const vale = ISK_PER_NPC_KILL_CALIBRATION.regions.find((r) => r.regionId === 10000003);
  expect(iskPerNpcKill(VALE_OF_THE_SILENT, DEFAULT_BOUNTY_ASSUMPTIONS)).toBe(vale?.iskPerNpcKill);
});

test("any other Region uses the pooled fallback", () => {
  expect(iskPerNpcKill(DERELIK, DEFAULT_BOUNTY_ASSUMPTIONS)).toBe(ISK_PER_NPC_KILL_CALIBRATION.fallback);
});

test("the committed calibration is in a plausible range", () => {
  const values = ISK_PER_NPC_KILL_CALIBRATION.regions.map((r) => r.iskPerNpcKill);
  expect(values.length).toBeGreaterThan(20);
  for (const v of values) expect(v).toBeGreaterThan(100_000);
  for (const v of values) expect(v).toBeLessThan(1_000_000);
  expect(ISK_PER_NPC_KILL_CALIBRATION.fallback).toBeGreaterThanOrEqual(Math.min(...values));
  expect(ISK_PER_NPC_KILL_CALIBRATION.fallback).toBeLessThanOrEqual(Math.max(...values));
});
