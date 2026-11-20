import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "ess_session";
/** Absolute: a session ends 30 days after sign-in however much it is used. */
export const SESSION_LIFETIME_MS = 30 * 24 * 3_600_000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes; only its SHA-256 is stored, so the database never holds a live token. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The session token in a Cookie header, if it carries one that could be ours. */
export function sessionToken(cookieHeader: string | undefined): string | null {
  for (const pair of (cookieHeader ?? "").split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1 || pair.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(eq + 1).trim();
    if (TOKEN.test(value)) return value;
  }
  return null;
}

/** A Set-Cookie value that stores `token`, or clears the cookie when it is null. */
export function sessionCookie(token: string | null, secure: boolean): string {
  const maxAge = token === null ? 0 : SESSION_LIFETIME_MS / 1000;
  return [
    `${SESSION_COOKIE}=${token ?? ""}`,
    `Max-Age=${String(maxAge)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
