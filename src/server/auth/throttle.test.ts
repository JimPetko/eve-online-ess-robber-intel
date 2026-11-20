import { expect, test } from "vitest";
import { createSignInThrottle } from "./throttle.ts";

test("an attempt whose check throws counts as one failure and stops counting once it leaves the window", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const throttle = createSignInThrottle(() => now);
  const broken = () => Promise.reject(new Error("scrypt failed"));

  for (let i = 0; i < 10; i++) await expect(throttle.attempt("Admin", "203.0.113.7", broken)).rejects.toThrow("scrypt failed");
  expect(await throttle.attempt("Admin", "203.0.113.7", () => Promise.resolve(true))).toEqual({ retryAfterSeconds: 15 * 60 });

  now = new Date(now.getTime() + 15 * 60_000);
  expect(await throttle.attempt("Admin", "203.0.113.7", () => Promise.resolve(true))).toBe(true);
});

test("50 attempts for one username started at once: 10 run and 40 are refused before any has failed", async () => {
  const throttle = createSignInThrottle(() => new Date("2026-11-19T12:00:00Z"));
  const checking = Promise.withResolvers<boolean>();
  let ran = 0;
  const attempts = Array.from({ length: 50 }, (_, i) =>
    throttle.attempt("Admin", `198.51.100.${String(i)}`, () => {
      ran++;
      return checking.promise;
    }),
  );
  checking.resolve(false);
  const results = await Promise.all(attempts);

  expect(ran).toBe(10);
  expect(results.filter((result) => result === false)).toHaveLength(10);
  expect(results.filter((result) => result !== false)).toEqual(Array<unknown>(40).fill({ retryAfterSeconds: 15 * 60 }));
});
