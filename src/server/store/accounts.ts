import type { DatabaseSync } from "node:sqlite";
import { accountId, type AccountId, type AccountList, type AccountRole, type AccountView } from "../../domain/index.ts";
import { transaction } from "./db.ts";
import { num, str, type Row } from "./store.ts";

export type StoredAccount = AccountView & { readonly passwordHash: string; readonly mustChangePassword: boolean };

const ACCOUNT_COLUMNS = "a.id, a.username, a.role, a.password_hash, a.must_change_password";

function role(row: Row): AccountRole {
  const value = str(row, "role");
  if (value !== "admin" && value !== "robber") throw new Error(`column role: unknown role ${value}`);
  return value;
}

function accountView(row: Row): AccountView {
  return { id: accountId(num(row, "id")), username: str(row, "username"), role: role(row) };
}

function storedAccount(row: Row): StoredAccount {
  return {
    ...accountView(row),
    passwordHash: str(row, "password_hash"),
    mustChangePassword: num(row, "must_change_password") === 1,
  };
}

/**
 * Every new Account must change its password at first sign-in, so there is no way to insert one that need not.
 * Null when the username is taken, whatever its case.
 */
export function insertAccount(
  db: DatabaseSync,
  account: { readonly username: string; readonly passwordHash: string; readonly role: AccountRole; readonly createdAt: Date },
): AccountView | null {
  const row = db
    .prepare(
      `INSERT INTO accounts (username, password_hash, role, must_change_password, created_at)
       VALUES (?, ?, ?, 1, ?) ON CONFLICT (username) DO NOTHING
       RETURNING id, username, role`,
    )
    .get(account.username, account.passwordHash, account.role, account.createdAt.toISOString());
  return row === undefined ? null : accountView(row);
}

export function accountByUsername(db: DatabaseSync, username: string): StoredAccount | null {
  const row = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.username = ?`).get(username);
  return row === undefined ? null : storedAccount(row);
}

export function listAccounts(db: DatabaseSync): AccountList {
  const rows = db
    .prepare("SELECT id, username, role, must_change_password, created_at FROM accounts ORDER BY username, id")
    .all();
  return {
    accounts: rows.map((row) => ({
      ...accountView(row),
      mustChangePassword: num(row, "must_change_password") === 1,
      createdAt: str(row, "created_at"),
    })),
  };
}

/** Admins are never deleted. Deleting an Account deletes its sessions with it. */
export function deleteAccount(db: DatabaseSync, id: AccountId): "deleted" | "admin" | "notFound" {
  return transaction(db, () => {
    const row = db.prepare("SELECT role FROM accounts WHERE id = ?").get(id);
    if (row === undefined) return "notFound";
    if (role(row) === "admin") return "admin";
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    return "deleted";
  });
}

/** The Account's chosen password: it no longer must change it, and every session it had is signed out. */
export function replacePassword(db: DatabaseSync, id: AccountId, passwordHash: string): void {
  transaction(db, () => {
    db.prepare("UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(passwordHash, id);
    db.prepare("DELETE FROM sessions WHERE account_id = ?").run(id);
  });
}

/** A session also ends after 7 days unused, besides at its `expiresAt`. */
const SESSION_IDLE_MS = 7 * 24 * 3_600_000;
/** Use is recorded at most hourly, not on every request, so a session may end up to an hour early. */
const SESSION_TOUCH_MS = 3_600_000;

const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

export function insertSession(
  db: DatabaseSync,
  session: { readonly tokenHash: string; readonly accountId: AccountId; readonly createdAt: Date; readonly expiresAt: Date },
): void {
  const createdAt = session.createdAt.toISOString();
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    session.tokenHash,
    session.accountId,
    createdAt,
    session.expiresAt.toISOString(),
    createdAt,
  );
}

/** The session's Account, recording the use; null for an unknown, expired or idle session, which is deleted. */
export function sessionAccount(db: DatabaseSync, tokenHash: string, now: Date): StoredAccount | null {
  const row = db
    .prepare(
      `SELECT ${ACCOUNT_COLUMNS}, s.expires_at, s.last_seen_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (row === undefined) return null;
  const lastSeenAt = str(row, "last_seen_at");
  if (str(row, "expires_at") <= now.toISOString() || lastSeenAt <= before(now, SESSION_IDLE_MS)) {
    deleteSession(db, tokenHash);
    return null;
  }
  if (lastSeenAt <= before(now, SESSION_TOUCH_MS)) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now.toISOString(), tokenHash);
  }
  return storedAccount(row);
}

export function deleteSession(db: DatabaseSync, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteExpiredSessions(db: DatabaseSync, now: Date): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(now.toISOString(), before(now, SESSION_IDLE_MS));
}
