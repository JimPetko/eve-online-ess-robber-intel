// Test-only helpers; excluded from the build.
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import type { AccountRole, AccountView } from "../domain/index.ts";
import { hashPassword } from "./auth/password.ts";
import { insertAccount, replacePassword } from "./store/accounts.ts";

export const PASSWORD = "correct horse battery";
/** Hashed once: scrypt is deliberately slow, and most tests only need some Account to sign in as. */
const PASSWORD_HASH = await hashPassword(PASSWORD);

/** An Account whose password is `PASSWORD`; active unless it still must change it. */
export function addAccount(
  db: DatabaseSync,
  username: string,
  role: AccountRole,
  { mustChangePassword = false }: { mustChangePassword?: boolean } = {},
): AccountView {
  const account = insertAccount(db, { username, passwordHash: PASSWORD_HASH, role, createdAt: new Date("2026-11-01T00:00:00Z") });
  if (account === null) throw new Error(`username ${username} is taken`);
  if (!mustChangePassword) replacePassword(db, account.id, PASSWORD_HASH);
  return account;
}

/** Signs in and returns the Cookie header that carries the session. */
export async function signIn(app: FastifyInstance, username: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { username, password } });
  const setCookie = res.headers["set-cookie"];
  if (res.statusCode !== 200 || typeof setCookie !== "string") {
    throw new Error(`sign-in as ${username} failed: ${String(res.statusCode)} ${res.body}`);
  }
  return setCookie.split(";")[0] ?? "";
}
