import { expect, test } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.ts";

test("a hash names its scheme and cost, then a 16-byte salt and a 32-byte key", async () => {
  const hash = await hashPassword("correct horse battery");
  const [scheme, n, r, p, salt, key, ...rest] = hash.split("$");

  expect([scheme, n, r, p, rest]).toEqual(["scrypt", "32768", "8", "1", []]);
  expect(Buffer.from(salt ?? "", "base64")).toHaveLength(16);
  expect(Buffer.from(key ?? "", "base64")).toHaveLength(32);
});

test("the same password hashes differently each time and verifies against both", async () => {
  const [a, b] = await Promise.all([hashPassword("correct horse battery"), hashPassword("correct horse battery")]);

  expect(a).not.toBe(b);
  expect(await verifyPassword("correct horse battery", a)).toBe(true);
  expect(await verifyPassword("correct horse battery", b)).toBe(true);
});

test("a wrong password does not verify, not even with different case", async () => {
  const hash = await hashPassword("correct horse battery");

  expect(await verifyPassword("Correct horse battery", hash)).toBe(false);
  expect(await verifyPassword("", hash)).toBe(false);
});

test("a stored value that is not a scrypt hash never verifies", async () => {
  expect(await verifyPassword("hunter2", "hunter2")).toBe(false);
  expect(await verifyPassword("x", "scrypt$32768$8$1$c2FsdA==$")).toBe(false);
});

test("no password verifies against the dummy hash used for unknown usernames", async () => {
  expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  expect(await verifyPassword("password", DUMMY_HASH)).toBe(false);
});
