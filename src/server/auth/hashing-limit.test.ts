import { expect, test } from "vitest";
import { createHashingLimit } from "./hashing-limit.ts";

test("4 run at once; a 5th is busy without running, and runs once one of the 4 finishes or fails", async () => {
  const limit = createHashingLimit();
  const works = Array.from({ length: 4 }, () => Promise.withResolvers<string>());
  const running = works.map((work) => limit.run(() => work.promise));
  let ranFifth = false;
  const fifth = () => {
    ranFifth = true;
    return Promise.resolve("hashed");
  };

  expect(await limit.run(fifth)).toBe("busy");
  expect(ranFifth).toBe(false);

  works[0]?.resolve("hashed");
  works[1]?.reject(new Error("scrypt failed"));
  expect(await running[0]).toBe("hashed");
  await expect(running[1]).rejects.toThrow("scrypt failed");
  const next = ["a", "b", "c"].map((value) => limit.run(() => Promise.resolve(value)));
  expect(await Promise.all(next)).toEqual(["a", "b", "busy"]);
});
