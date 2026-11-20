import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountId,
  PASSWORD_RULE,
  USERNAME_RULE,
  type AccountList,
  type AccountView,
  type SessionView,
} from "../../domain/index.ts";
import {
  accountByUsername,
  deleteAccount,
  deleteExpiredSessions,
  deleteSession,
  insertAccount,
  insertSession,
  listAccounts,
  replacePassword,
  type StoredAccount,
} from "../store/accounts.ts";
import { refuse, send, sessionView, signedInAs, type Refusal } from "./access.ts";
import type { Audit } from "./audit.ts";
import { COMMON_PASSWORDS } from "./common-passwords.ts";
import type { HashingLimit } from "./hashing-limit.ts";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.ts";
import { newSessionToken, SESSION_LIFETIME_MS, sessionCookie, tokenHash } from "./session-cookie.ts";
import type { SignInThrottle } from "./throttle.ts";

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (body: unknown): Fields =>
  typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Fields) : {};

const INVALID_CREDENTIALS = refuse(401, "invalidCredentials", "Wrong username or password.");

function parseUsername(value: unknown): string | Refusal {
  if (
    typeof value === "string" &&
    value.length >= USERNAME_RULE.minLength &&
    value.length <= USERNAME_RULE.maxLength &&
    USERNAME_RULE.pattern.test(value)
  ) {
    return value;
  }
  return refuse(
    400,
    "invalidUsername",
    `A username is ${String(USERNAME_RULE.minLength)} to ${String(USERNAME_RULE.maxLength)} letters, digits, dots, underscores, hyphens or single spaces.`,
  );
}

function parsePassword(value: unknown, minLength: number): string | Refusal {
  if (typeof value === "string" && value.length >= minLength && value.length <= PASSWORD_RULE.maxLength) return value;
  return refuse(400, "weakPassword", `A password is ${String(minLength)} to ${String(PASSWORD_RULE.maxLength)} characters.`);
}

/** A password an Account chooses for itself; an Admin's temporary one lasts only until first sign-in, so skips these checks. */
function parseChosenPassword(value: unknown, username: string): string | Refusal {
  const password = parsePassword(value, PASSWORD_RULE.minLength);
  if (typeof password !== "string") return password;
  const lower = password.toLowerCase();
  if (lower.includes(username.toLowerCase())) return refuse(400, "weakPassword", "A password must not contain your username.");
  if (COMMON_PASSWORDS.has(lower)) {
    return refuse(400, "weakPassword", "That is one of the most common passwords, so it is among the first guessed. Choose another.");
  }
  return password;
}

export async function createAccount(db: DatabaseSync, body: unknown, now: Date): Promise<AccountView | Refusal> {
  const fields = fieldsOf(body);
  const username = parseUsername(fields.username);
  if (typeof username !== "string") return username;
  const password = parsePassword(fields.password, PASSWORD_RULE.temporaryMinLength);
  if (typeof password !== "string") return password;
  const { role } = fields;
  if (role !== "admin" && role !== "robber") return refuse(400, "invalidRole", 'A role is "admin" or "robber".');
  const account = insertAccount(db, { username, passwordHash: await hashPassword(password), role, createdAt: now });
  return account ?? refuse(409, "usernameTaken", `There is already an Account named "${username}".`);
}

export interface AuthRouteDeps {
  readonly db: DatabaseSync;
  readonly now: () => Date;
  readonly throttle: SignInThrottle;
  readonly hashing: HashingLimit;
  readonly audit: Audit;
}

export function registerAuthRoutes(app: FastifyInstance, { db, now, throttle, hashing, audit }: AuthRouteDeps): void {
  const secure = (request: FastifyRequest) => request.protocol === "https";

  function startSession(request: FastifyRequest, reply: FastifyReply, account: StoredAccount): SessionView {
    const token = newSessionToken();
    const createdAt = now();
    insertSession(db, {
      tokenHash: tokenHash(token),
      accountId: account.id,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_LIFETIME_MS),
    });
    void reply.header("set-cookie", sessionCookie(token, secure(request)));
    return sessionView(account);
  }

  function tooManyAttempts(reply: FastifyReply, retryAfter: number) {
    void reply.header("retry-after", String(retryAfter));
    return send(reply, refuse(429, "tooManyAttempts", "Too many wrong passwords. Try again later."));
  }

  function busy(reply: FastifyReply) {
    void reply.header("retry-after", "1");
    return send(reply, refuse(503, "busy", "The server is busy checking other passwords. Try again in a moment."));
  }

  app.get(
    "/api/session",
    { config: { access: "public" } },
    (request): SessionView => sessionView(request.signedIn?.account ?? null),
  );

  app.post("/api/session", { config: { access: "public" } }, async (request, reply) => {
    const { username, password } = fieldsOf(request.body);
    if (typeof username !== "string" || typeof password !== "string") {
      return send(reply, refuse(400, "invalidCredentials", "Send a username and a password."));
    }
    const account = accountByUsername(db, username);
    // An unknown username verifies against a dummy hash so it takes as long as a wrong password.
    const verified = await hashing.run(() =>
      throttle.attempt(
        username,
        request.ip,
        async () =>
          password.length <= PASSWORD_RULE.maxLength &&
          (await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH)) &&
          account !== null,
      ),
    );
    if (verified === "busy") return busy(reply);
    const { ip } = request;
    if (typeof verified !== "boolean") {
      audit({ event: "signInThrottled", username, ip });
      return tooManyAttempts(reply, verified.retryAfterSeconds);
    }
    if (!verified || account === null) {
      audit({ event: "signInFailed", username, ip });
      return send(reply, INVALID_CREDENTIALS);
    }
    audit({ event: "signInSucceeded", username: account.username, ip });
    deleteExpiredSessions(db, now());
    return startSession(request, reply, account);
  });

  app.delete("/api/session", { config: { access: "signedIn" } }, (request, reply) => {
    deleteSession(db, signedInAs(request).tokenHash);
    return reply.code(204).header("set-cookie", sessionCookie(null, secure(request))).send();
  });

  app.post("/api/session/password", { config: { access: "signedIn" } }, async (request, reply) => {
    const { account } = signedInAs(request);
    const fields = fieldsOf(request.body);
    const { currentPassword } = fields;
    if (typeof currentPassword !== "string") {
      return send(reply, refuse(400, "invalidCredentials", "Send your current password."));
    }
    const newPassword = parseChosenPassword(fields.newPassword, account.username);
    if (typeof newPassword !== "string") return send(reply, newPassword);
    if (newPassword === currentPassword) {
      return send(reply, refuse(400, "weakPassword", "Choose a password different from your current one."));
    }
    const changed = await hashing.run(async () => {
      // Shares sign-in's counters, so a stolen session cookie cannot guess the password without limit.
      const verified = await throttle.attempt(account.username, request.ip, () =>
        verifyPassword(currentPassword, account.passwordHash),
      );
      return verified === true ? { passwordHash: await hashPassword(newPassword) } : verified;
    });
    if (changed === "busy") return busy(reply);
    if (changed === false) return send(reply, refuse(401, "invalidCredentials", "Your current password is wrong."));
    if ("retryAfterSeconds" in changed) return tooManyAttempts(reply, changed.retryAfterSeconds);
    const { passwordHash } = changed;
    replacePassword(db, account.id, passwordHash);
    audit({ event: "passwordChanged", username: account.username, ip: request.ip });
    return startSession(request, reply, { ...account, passwordHash, mustChangePassword: false });
  });

  app.get("/api/accounts", { config: { access: "admin" } }, (): AccountList => listAccounts(db));

  app.post("/api/accounts", { config: { access: "admin" } }, async (request, reply) => {
    const created = await hashing.run(() => createAccount(db, request.body, now()));
    if (created === "busy") return busy(reply);
    if ("status" in created) return send(reply, created);
    const by = signedInAs(request).account.username;
    audit({ event: "accountCreated", username: created.username, role: created.role, by, ip: request.ip });
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", { config: { access: "admin" } }, (request, reply) => {
    const { id } = request.params;
    const notFound = refuse(404, "accountNotFound", `There is no Account ${id}.`);
    if (!/^\d{1,15}$/.test(id)) return send(reply, notFound);
    const deleting = accountId(Number(id));
    switch (deleteAccount(db, deleting)) {
      case "deleted":
        audit({ event: "accountDeleted", accountId: deleting, by: signedInAs(request).account.username, ip: request.ip });
        return reply.code(204).send();
      case "admin":
        return send(reply, refuse(403, "cannotDeleteAdmin", "An Admin cannot be deleted."));
      case "notFound":
        return send(reply, notFound);
    }
  });
}
