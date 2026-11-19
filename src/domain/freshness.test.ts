import { expect, test } from "vitest";
import { freshness } from "./freshness.ts";

const pull = new Date(Date.UTC(2026, 10, 18, 12));
const after = (ms: number) => new Date(pull.getTime() + ms);

test("Recent just under an hour, Stale at exactly an hour", () => {
  expect(freshness(pull, after(3_600_000 - 1))).toBe("Recent");
  expect(freshness(pull, after(3_600_000))).toBe("Stale");
});
