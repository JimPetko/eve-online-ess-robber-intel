import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function derive(password: string, salt: Buffer, keyBytes: number, options: ScryptOptions): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; the default 32 MiB cap is exactly that at N = 2^15, r = 8, so raise it.
  const maxmem = 256 * (options.N ?? N) * (options.r ?? R);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyBytes, { ...options, maxmem }, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

/** A self-describing hash: `scrypt$N$r$p$saltB64$hashB64`, so the cost can rise later without breaking stored hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False for a wrong password, and for a stored hash that is not `hashPassword` output. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash, ...rest] = stored.split("$");
  if (scheme !== "scrypt" || salt === undefined || hash === undefined || rest.length > 0) return false;
  const expected = Buffer.from(hash, "base64");
  if (expected.length === 0) return false;
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Verified against when a username matches no Account, so an unknown username costs as much
 * as a wrong password and response time does not reveal which usernames exist.
 */
export const DUMMY_HASH =
  "scrypt$32768$8$1$4zxSy5W3x+F6vIfgDkLDFQ==$c+aNy0Y/UzlrnIb7LiKFqwozmsJmSzVLuAa+Rw44OF8=";
