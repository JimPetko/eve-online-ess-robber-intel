import { afterEach, expect, test } from "vitest";
import type {
  AccountList,
  AccountView,
  AuthErrorCode,
  RegionList,
  SessionView,
} from "../../domain/index.ts";
import { buildApp } from "../app.ts";
import { openDb } from "../store/db.ts";
import { addAccount, PASSWORD, signIn } from "../test-support.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-11-19T12:00:00Z");
const NEW_PASSWORD = "a brand new passphrase";

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(options: { trustProxy?: boolean } = {}) {
  const db = openDb(":memory:");
  const admin = addAccount(db, "Admin", "admin");
  let now = T0;
  const auditLines: string[] = [];
  const app = buildApp({ db, nextPullAt: () => null, now: () => now, logAudit: (line) => auditLines.push(line), ...options });
  apps.push(app);
  const call = (method: "GET" | "POST" | "DELETE", url: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(cookie === undefined ? {} : { headers: { cookie } }),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return {
    db,
    app,
    admin,
    call,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    session: async (cookie?: string) => (await call("GET", "/api/session", cookie)).json<SessionView>(),
    auditLines,
    /** The audit lines written since the last call, each parsed from its `audit {json}` form. */
    audited: () => auditLines.splice(0).map((line) => JSON.parse(line.replace(/^audit /, "")) as unknown),
  };
}

const authError = (error: AuthErrorCode) => ({ error, message: expect.any(String) as unknown });

function cookieAttributes(setCookie: unknown): Record<string, string> {
  if (typeof setCookie !== "string") throw new Error(`no single Set-Cookie: ${String(setCookie)}`);
  const [first = "", ...rest] = setCookie.split(";").map((part) => part.trim());
  const attributes: Record<string, string> = { cookie: first };
  for (const part of rest) {
    const [name = "", value = ""] = part.split("=");
    attributes[name.toLowerCase()] = value;
  }
  return attributes;
}

test("GET /api/session is signedOut without a cookie or with one the server never issued", async () => {
  const { session } = setup();
  expect(await session()).toEqual({ status: "signedOut" } satisfies SessionView);
  expect(await session(`ess_session=${"A".repeat(43)}`)).toEqual({ status: "signedOut" });
  expect(await session("ess_session=junk")).toEqual({ status: "signedOut" });
});

test("signing in answers the session and sets an HttpOnly, SameSite=Strict, 30-day cookie that signs later requests in", async () => {
  const { call, admin, session } = setup();
  const res = await call("POST", "/api/session", undefined, { username: "Admin", password: PASSWORD });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "active", account: admin } satisfies SessionView);
  const attributes = cookieAttributes(res.headers["set-cookie"]);
  expect(attributes).toEqual({
    cookie: expect.stringMatching(/^ess_session=[A-Za-z0-9_-]{43}$/) as unknown,
    "max-age": String(30 * 24 * 3600),
    path: "/",
    httponly: "",
    samesite: "Strict",
  });
  expect(await session(attributes.cookie)).toEqual({ status: "active", account: admin });
});

test("the cookie is Secure when the request came over https through a trusted proxy, and only then", async () => {
  const forwardedHttps = { username: "Admin", password: PASSWORD };
  const signInVia = async (trustProxy: boolean) => {
    const { app } = setup({ trustProxy });
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { "x-forwarded-proto": "https" },
      payload: forwardedHttps,
    });
    return cookieAttributes(res.headers["set-cookie"]);
  };

  expect(await signInVia(true)).toHaveProperty("secure", "");
  expect(await signInVia(false)).not.toHaveProperty("secure");
});

test("usernames match whatever their case, and the session names the Account as it was created", async () => {
  const { call, admin } = setup();
  const res = await call("POST", "/api/session", undefined, { username: "aDMIN", password: PASSWORD });
  expect(res.json()).toEqual({ status: "active", account: admin });
  expect(admin.username).toBe("Admin");
});

test("a wrong password and an unknown username get the same 401", async () => {
  const { call } = setup();
  const wrong = await call("POST", "/api/session", undefined, { username: "Admin", password: "not the password" });
  const unknown = await call("POST", "/api/session", undefined, { username: "Nobody", password: PASSWORD });

  for (const res of [wrong, unknown]) {
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  }
  expect(wrong.json()).toEqual(authError("invalidCredentials"));
  expect(unknown.json()).toEqual(wrong.json());
});

test.each([
  ["no body", undefined],
  ["a JSON array", []],
  ["a missing password", { username: "Admin" }],
  ["a numeric password", { username: "Admin", password: 12345678 }],
  ["a missing username", { password: PASSWORD }],
])("signing in with %s is a 400", async (_, payload) => {
  const { call } = setup();
  const res = await call("POST", "/api/session", undefined, payload);
  expect([res.statusCode, res.json()]).toEqual([400, authError("invalidCredentials")]);
});

test("signing out ends the session and clears the cookie; signing out again needs a session", async () => {
  const { app, call, session } = setup();
  const cookie = await signIn(app, "Admin");

  const res = await call("DELETE", "/api/session", cookie);
  expect(res.statusCode).toBe(204);
  expect(cookieAttributes(res.headers["set-cookie"])).toMatchObject({ cookie: "ess_session=", "max-age": "0", path: "/" });
  expect(await session(cookie)).toEqual({ status: "signedOut" });

  const again = await call("DELETE", "/api/session", cookie);
  expect([again.statusCode, again.json()]).toEqual([401, authError("signInRequired")]);
});

test("a session ends 30 days after sign-in however much it is used", async () => {
  const { app, call, admin, session, advance } = setup();
  const cookie = await signIn(app, "Admin");

  for (let day = 6; day < 30; day += 6) {
    advance(6 * DAY);
    expect(await session(cookie)).toEqual({ status: "active", account: admin });
  }
  advance(6 * DAY - 1);
  expect(await session(cookie)).toEqual({ status: "active", account: admin });
  advance(1);
  expect(await session(cookie)).toEqual({ status: "signedOut" });
  expect((await call("GET", "/api/regions", cookie)).json()).toEqual(authError("signInRequired"));
});

test("a session unused for 7 days ends and answers like one that never existed, while a used one goes on", async () => {
  const { app, call, admin, session, advance } = setup();
  const used = await signIn(app, "Admin");
  const unused = await signIn(app, "Admin");

  advance(7 * DAY - 1);
  expect(await session(used)).toEqual({ status: "active", account: admin });
  advance(1);
  expect(await session(unused)).toEqual({ status: "signedOut" });
  expect((await call("GET", "/api/regions", unused)).json()).toEqual(authError("signInRequired"));
  advance(7 * DAY - 2);
  expect(await session(used)).toEqual({ status: "active", account: admin });
});

test("use is recorded at most hourly, so a session last used within an hour of its previous use may end up to an hour early", async () => {
  const { app, admin, session, advance } = setup();
  const early = await signIn(app, "Admin");
  const hourly = await signIn(app, "Admin");

  advance(HOUR - 1);
  await session(early);
  advance(1);
  await session(hourly);
  advance(7 * DAY - HOUR);
  expect(await session(early)).toEqual({ status: "signedOut" });
  expect(await session(hourly)).toEqual({ status: "active", account: admin });
});

test("Regions need an active session: 401 signed out, 403 while the password must change", async () => {
  const { app, db, call } = setup();
  addAccount(db, "Fresh Robber", "robber", { mustChangePassword: true });
  addAccount(db, "Robber", "robber");
  const fresh = await signIn(app, "Fresh Robber");
  const robber = await signIn(app, "Robber");

  for (const url of ["/api/regions", "/api/regions/10000060"]) {
    const signedOut = await call("GET", url);
    expect([url, signedOut.statusCode, signedOut.json()]).toEqual([url, 401, authError("signInRequired")]);
    const mustChange = await call("GET", url, fresh);
    expect([url, mustChange.statusCode, mustChange.json()]).toEqual([url, 403, authError("passwordChangeRequired")]);
  }
  const regions = await call("GET", "/api/regions", robber);
  expect([regions.statusCode, regions.json()]).toEqual([200, { regions: [] } satisfies RegionList]);
});

test("Account management is for active Admins only", async () => {
  const { app, db, call } = setup();
  addAccount(db, "Robber", "robber");
  addAccount(db, "Fresh Admin", "admin", { mustChangePassword: true });
  const robber = await signIn(app, "Robber");
  const freshAdmin = await signIn(app, "Fresh Admin");
  const requests = [
    ["GET", "/api/accounts", undefined],
    ["POST", "/api/accounts", { username: "Someone", password: "temporary", role: "robber" }],
    ["DELETE", "/api/accounts/1", undefined],
  ] as const;

  for (const [method, url, payload] of requests) {
    const outcomes = await Promise.all(
      [undefined, robber, freshAdmin].map(async (cookie) => {
        const res = await call(method, url, cookie, payload);
        return [res.statusCode, res.json<{ error: string }>().error];
      }),
    );
    expect([method, outcomes]).toEqual([
      method,
      [
        [401, "signInRequired"],
        [403, "adminRequired"],
        [403, "passwordChangeRequired"],
      ],
    ]);
  }
});

test("an Admin creates a Robber, who must change its password at first sign-in before seeing any Region", async () => {
  const { app, call, session } = setup();
  const admin = await signIn(app, "Admin");

  const created = await call("POST", "/api/accounts", admin, { username: "New Robber", password: "temp-pass", role: "robber" });
  expect(created.statusCode).toBe(201);
  const robber = created.json<AccountView>();
  expect(robber).toEqual({ id: expect.any(Number) as unknown, username: "New Robber", role: "robber" });

  const first = await signIn(app, "New Robber", "temp-pass");
  expect(await session(first)).toEqual({ status: "mustChangePassword", account: robber } satisfies SessionView);
  expect((await call("GET", "/api/regions", first)).statusCode).toBe(403);

  const changed = await call("POST", "/api/session/password", first, { currentPassword: "temp-pass", newPassword: NEW_PASSWORD });
  expect([changed.statusCode, changed.json()]).toEqual([200, { status: "active", account: robber } satisfies SessionView]);
  const fresh = cookieAttributes(changed.headers["set-cookie"]).cookie;

  expect(fresh).not.toBe(first);
  expect(await session(first)).toEqual({ status: "signedOut" });
  expect((await call("GET", "/api/regions", fresh)).statusCode).toBe(200);

  const oldPassword = await call("POST", "/api/session", undefined, { username: "New Robber", password: "temp-pass" });
  expect([oldPassword.statusCode, oldPassword.json()]).toEqual([401, authError("invalidCredentials")]);
  expect(await session(await signIn(app, "New Robber", NEW_PASSWORD))).toEqual({ status: "active", account: robber });
});

test("changing a password signs out every other session of that Account, and no one else's", async () => {
  const { app, db, call, session } = setup();
  addAccount(db, "Robber", "robber");
  const laptop = await signIn(app, "Robber");
  const phone = await signIn(app, "Robber");
  const admin = await signIn(app, "Admin");

  const changed = await call("POST", "/api/session/password", laptop, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  expect(changed.statusCode).toBe(200);

  expect((await session(laptop)).status).toBe("signedOut");
  expect((await session(phone)).status).toBe("signedOut");
  expect((await session(admin)).status).toBe("active");
});

test.each([
  ["a wrong current password", { currentPassword: "not my password", newPassword: NEW_PASSWORD }, 401, "invalidCredentials"],
  ["no current password", { newPassword: NEW_PASSWORD }, 400, "invalidCredentials"],
  ["no new password", { currentPassword: PASSWORD }, 400, "weakPassword"],
  ["a new password of 11 characters", { currentPassword: PASSWORD, newPassword: "x".repeat(11) }, 400, "weakPassword"],
  ["a new password of 257 characters", { currentPassword: PASSWORD, newPassword: "x".repeat(257) }, 400, "weakPassword"],
  ["the current password again", { currentPassword: PASSWORD, newPassword: PASSWORD }, 400, "weakPassword"],
  ["a new password holding the username in another case", { currentPassword: PASSWORD, newPassword: "my ADMIN passphrase" }, 400, "weakPassword"],
  ["one of the most common passwords, in another case", { currentPassword: PASSWORD, newPassword: "Password1234" }, 400, "weakPassword"],
  ["a body that is not an object", [PASSWORD, NEW_PASSWORD], 400, "invalidCredentials"],
])("changing a password refuses %s and keeps the old one", async (_, payload, status, code) => {
  const { app, call, session } = setup();
  const cookie = await signIn(app, "Admin");

  const res = await call("POST", "/api/session/password", cookie, payload);
  expect([res.statusCode, res.json()]).toEqual([status, authError(code as AuthErrorCode)]);
  expect((await session(cookie)).status).toBe("active");
  await signIn(app, "Admin", PASSWORD);
});

test("a refused new password says why: it holds the username, or it is too common", async () => {
  const { app, call } = setup();
  const cookie = await signIn(app, "Admin");
  const refusal = async (newPassword: string) =>
    (await call("POST", "/api/session/password", cookie, { currentPassword: PASSWORD, newPassword })).json<{ message: string }>().message;

  expect(await refusal("admin's passphrase")).toMatch(/username/);
  expect(await refusal("qwerty123456")).toMatch(/most common/);
});

test("an Admin may set a temporary password that holds the username or is common, since it must be replaced", async () => {
  const { app, call } = setup();
  const admin = await signIn(app, "Admin");
  const create = (username: string, password: string) => call("POST", "/api/accounts", admin, { username, password, role: "robber" });

  expect((await create("Robber", "robber-temp")).statusCode).toBe(201);
  expect((await create("Ratter", "password1234")).statusCode).toBe(201);
});

test.each([12, 256])("a new password may be exactly %i characters", async (length) => {
  const { app, call } = setup();
  const newPassword = "x".repeat(length);
  const res = await call("POST", "/api/session/password", await signIn(app, "Admin"), { currentPassword: PASSWORD, newPassword });
  expect(res.statusCode).toBe(200);
  await signIn(app, "Admin", newPassword);
});

test("changing a password needs a session", async () => {
  const { call } = setup();
  const res = await call("POST", "/api/session/password", undefined, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  expect([res.statusCode, res.json()]).toEqual([401, authError("signInRequired")]);
});

test("GET /api/accounts lists every Account by username, with whether it must still change its password", async () => {
  const { app, db, call, advance } = setup();
  const admin = await signIn(app, "Admin");
  addAccount(db, "zed", "robber");
  advance(DAY);
  const created = (await call("POST", "/api/accounts", admin, { username: "bob", password: "temporary", role: "robber" })).json<AccountView>();

  const res = await call("GET", "/api/accounts", admin);
  expect(res.statusCode).toBe(200);
  expect(res.json<AccountList>().accounts.map(({ username, role, mustChangePassword, createdAt }) => ({ username, role, mustChangePassword, createdAt }))).toEqual([
    { username: "Admin", role: "admin", mustChangePassword: false, createdAt: "2026-11-01T00:00:00.000Z" },
    { username: "bob", role: "robber", mustChangePassword: true, createdAt: new Date(T0.getTime() + DAY).toISOString() },
    { username: "zed", role: "robber", mustChangePassword: false, createdAt: "2026-11-01T00:00:00.000Z" },
  ]);
  expect(res.json<AccountList>().accounts[1]?.id).toBe(created.id);
});

test("an Admin can create another Admin, who also must change its password first", async () => {
  const { app, call, session } = setup();
  const admin = await signIn(app, "Admin");
  const res = await call("POST", "/api/accounts", admin, { username: "Second Admin", password: "temporary", role: "admin" });
  expect(res.statusCode).toBe(201);
  expect(await session(await signIn(app, "Second Admin", "temporary"))).toEqual({
    status: "mustChangePassword",
    account: res.json<AccountView>(),
  });
});

test.each([
  ["a username of 2 characters", { username: "ab", password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a username of 33 characters", { username: "a".repeat(33), password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a username with a leading space", { username: " Robber", password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a username with a doubled space", { username: "Rob  Ber", password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a username with a slash", { username: "rob/ber", password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a missing username", { password: "temporary", role: "robber" }, 400, "invalidUsername"],
  ["a temporary password of 7 characters", { username: "Robber", password: "1234567", role: "robber" }, 400, "weakPassword"],
  ["a missing password", { username: "Robber", role: "robber" }, 400, "weakPassword"],
  ["an unknown role", { username: "Robber", password: "temporary", role: "owner" }, 400, "invalidRole"],
  ["a username taken in another case", { username: "ADMIN", password: "temporary", role: "robber" }, 409, "usernameTaken"],
])("creating an Account refuses %s", async (_, payload, status, code) => {
  const { app, call } = setup();
  const admin = await signIn(app, "Admin");

  const res = await call("POST", "/api/accounts", admin, payload);
  expect([res.statusCode, res.json()]).toEqual([status, authError(code as AuthErrorCode)]);
  expect((await call("GET", "/api/accounts", admin)).json<AccountList>().accounts).toHaveLength(1);
});

test("a username of 3 or 32 allowed characters with single spaces is accepted, as is an 8-character temporary password", async () => {
  const { app, call } = setup();
  const admin = await signIn(app, "Admin");
  for (const username of ["a.b", `${"x".repeat(15)} ${"y-_.".repeat(4)}`]) {
    const res = await call("POST", "/api/accounts", admin, { username, password: "12345678", role: "robber" });
    expect([username.length, res.statusCode]).toEqual([username.length, 201]);
  }
});

test("deleting a Robber removes it and signs it out at once", async () => {
  const { app, db, call, session } = setup();
  const robber = addAccount(db, "Robber", "robber");
  const robberCookie = await signIn(app, "Robber");
  const admin = await signIn(app, "Admin");

  const res = await call("DELETE", `/api/accounts/${String(robber.id)}`, admin);
  expect(res.statusCode).toBe(204);

  expect(await session(robberCookie)).toEqual({ status: "signedOut" });
  expect((await call("GET", "/api/regions", robberCookie)).statusCode).toBe(401);
  expect((await call("GET", "/api/accounts", admin)).json<AccountList>().accounts.map((a) => a.username)).toEqual(["Admin"]);
  const signInAgain = await call("POST", "/api/session", undefined, { username: "Robber", password: PASSWORD });
  expect(signInAgain.statusCode).toBe(401);
});

test("an Admin can delete neither another Admin nor itself", async () => {
  const { app, db, admin, call, session } = setup();
  const other = addAccount(db, "Other Admin", "admin");
  const otherCookie = await signIn(app, "Other Admin");
  const cookie = await signIn(app, "Admin");

  for (const target of [other, admin]) {
    const res = await call("DELETE", `/api/accounts/${String(target.id)}`, cookie);
    expect([target.username, res.statusCode, res.json()]).toEqual([target.username, 403, authError("cannotDeleteAdmin")]);
  }
  expect((await session(otherCookie)).status).toBe("active");
  expect((await call("GET", "/api/accounts", cookie)).json<AccountList>().accounts).toHaveLength(2);
});

test.each(["999", "abc", "-1"])("deleting Account %s, which does not exist, is a 404", async (id) => {
  const { app, call } = setup();
  const res = await call("DELETE", `/api/accounts/${id}`, await signIn(app, "Admin"));
  expect([res.statusCode, res.json()]).toEqual([404, authError("accountNotFound")]);
});

test("GET /api/health needs no session", async () => {
  const { call } = setup();
  expect((await call("GET", "/api/health")).json()).toEqual({ ok: true });
});

test("an /api route that declares no access level stops the app from starting", () => {
  const { app } = setup();
  expect(() => app.get("/api/forgotten", () => "open")).toThrow(/declares no access level/);
});

const wrongPassword = (username: string) => ({ username, password: "not the password" });

test("after 10 failed sign-ins for a username in any case, even the right password gets 429 until 15 minutes pass", async () => {
  const { call, advance } = setup();
  for (let i = 0; i < 10; i++) {
    const res = await call("POST", "/api/session", undefined, wrongPassword(i % 2 === 0 ? "admin" : "ADMIN"));
    expect([i, res.statusCode]).toEqual([i, 401]);
    advance(1000);
  }

  const blocked = await call("POST", "/api/session", undefined, { username: "Admin", password: PASSWORD });
  expect([blocked.statusCode, blocked.json(), blocked.headers["retry-after"]]).toEqual([
    429,
    authError("tooManyAttempts"),
    String(15 * 60 - 10),
  ]);

  advance((15 * 60 - 10) * 1000 - 1);
  expect((await call("POST", "/api/session", undefined, { username: "Admin", password: PASSWORD })).statusCode).toBe(429);
  advance(1);
  expect((await call("POST", "/api/session", undefined, { username: "Admin", password: PASSWORD })).statusCode).toBe(200);
});

test("after 10 failed sign-ins from one IP, that IP is refused for every username while others still sign in", async () => {
  const { app } = setup();
  const attempt = (remoteAddress: string, payload: object) =>
    app.inject({ method: "POST", url: "/api/session", remoteAddress, payload });
  for (let i = 0; i < 10; i++) {
    expect((await attempt("203.0.113.7", wrongPassword(`guess${String(i)}`))).statusCode).toBe(401);
  }

  const blocked = await attempt("203.0.113.7", { username: "Admin", password: PASSWORD });
  expect([blocked.statusCode, blocked.headers["retry-after"]]).toEqual([429, String(15 * 60)]);
  expect((await attempt("198.51.100.2", { username: "Admin", password: PASSWORD })).statusCode).toBe(200);
});

test("a successful sign-in clears the username's failures but not the IP's", async () => {
  const { app } = setup();
  const attempt = (payload: object) => app.inject({ method: "POST", url: "/api/session", remoteAddress: "203.0.113.7", payload });
  for (let i = 0; i < 9; i++) expect((await attempt(wrongPassword("Admin"))).statusCode).toBe(401);

  expect((await attempt({ username: "Admin", password: PASSWORD })).statusCode).toBe(200);
  expect((await attempt(wrongPassword("someone else"))).statusCode).toBe(401);
  expect((await attempt({ username: "Admin", password: PASSWORD })).statusCode).toBe(429);
});

test("failures behind a trusted proxy count against the forwarded client IP", async () => {
  const { app } = setup({ trustProxy: true });
  const attempt = (clientIp: string, payload: object) =>
    app.inject({ method: "POST", url: "/api/session", headers: { "x-forwarded-for": clientIp }, payload });
  for (let i = 0; i < 10; i++) await attempt("203.0.113.7", wrongPassword(`guess${String(i)}`));

  expect((await attempt("203.0.113.7", { username: "Admin", password: PASSWORD })).statusCode).toBe(429);
  expect((await attempt("198.51.100.2", { username: "Admin", password: PASSWORD })).statusCode).toBe(200);
});

test("behind a trusted proxy, only the X-Forwarded-For entry the proxy appended counts, so a client cannot rotate the entries before it", async () => {
  const { app } = setup({ trustProxy: true });
  const attempt = (forwardedFor: string, payload: object) =>
    app.inject({ method: "POST", url: "/api/session", headers: { "x-forwarded-for": forwardedFor }, payload });
  for (let i = 0; i < 10; i++) {
    const res = await attempt(`10.0.0.${String(i)}, 203.0.113.7`, wrongPassword(`guess${String(i)}`));
    expect([i, res.statusCode]).toEqual([i, 401]);
  }

  expect((await attempt("10.9.9.9, 203.0.113.7", { username: "Admin", password: PASSWORD })).statusCode).toBe(429);
  expect((await attempt("203.0.113.7, 198.51.100.2", { username: "Admin", password: PASSWORD })).statusCode).toBe(200);
});

const wrongCurrentPassword = { currentPassword: "not my password", newPassword: NEW_PASSWORD };
const rightCurrentPassword = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };

test("after 10 wrong current passwords, even the right one gets 429 until 15 minutes pass", async () => {
  const { app, call, advance } = setup();
  const cookie = await signIn(app, "Admin");
  for (let i = 0; i < 10; i++) {
    const res = await call("POST", "/api/session/password", cookie, wrongCurrentPassword);
    expect([i, res.statusCode]).toEqual([i, 401]);
    advance(1000);
  }

  const blocked = await call("POST", "/api/session/password", cookie, rightCurrentPassword);
  expect([blocked.statusCode, blocked.json(), blocked.headers["retry-after"]]).toEqual([
    429,
    authError("tooManyAttempts"),
    String(15 * 60 - 10),
  ]);

  advance((15 * 60 - 10) * 1000);
  expect((await call("POST", "/api/session/password", cookie, rightCurrentPassword)).statusCode).toBe(200);
  await signIn(app, "Admin", NEW_PASSWORD);
});

test("wrong current passwords count against the Account's username, so they also block its sign-in from another IP", async () => {
  const { app, call } = setup();
  const cookie = await signIn(app, "Admin");
  for (let i = 0; i < 10; i++) await call("POST", "/api/session/password", cookie, wrongCurrentPassword);

  const signInElsewhere = await app.inject({
    method: "POST",
    url: "/api/session",
    remoteAddress: "198.51.100.2",
    payload: { username: "admin", password: PASSWORD },
  });
  expect([signInElsewhere.statusCode, signInElsewhere.json()]).toEqual([429, authError("tooManyAttempts")]);
});

test("a successful password change clears the username's failures", async () => {
  const { app, call } = setup();
  const cookie = await signIn(app, "Admin");
  for (let i = 0; i < 9; i++) await call("POST", "/api/session/password", cookie, wrongCurrentPassword);
  expect((await call("POST", "/api/session/password", cookie, rightCurrentPassword)).statusCode).toBe(200);

  const attempt = (password: string) =>
    app.inject({ method: "POST", url: "/api/session", remoteAddress: "198.51.100.2", payload: { username: "Admin", password } });
  for (let i = 0; i < 9; i++) expect((await attempt("not the password")).statusCode).toBe(401);
  expect((await attempt(NEW_PASSWORD)).statusCode).toBe(200);
});

async function statusCounts(responses: Promise<{ statusCode: number }>[]): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  for (const { statusCode } of await Promise.all(responses)) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
  return counts;
}

test("50 wrong sign-ins for one username sent at once: 4 are checked and 46 told the server is busy, which is no failure", async () => {
  const { app, call } = setup();
  const attempts = Array.from({ length: 50 }, (_, i) =>
    app.inject({ method: "POST", url: "/api/session", remoteAddress: `198.51.100.${String(i)}`, payload: wrongPassword("Admin") }),
  );
  expect(await statusCounts(attempts)).toEqual({ 401: 4, 503: 46 });

  for (let i = 0; i < 6; i++) expect((await call("POST", "/api/session", undefined, wrongPassword("Admin"))).statusCode).toBe(401);
  expect((await call("POST", "/api/session", undefined, wrongPassword("Admin"))).statusCode).toBe(429);
});

test("a flood of sign-ins for different usernames from different IPs, which the throttle cannot stop, hashes 4 at a time", async () => {
  const { app } = setup();
  const flood = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      app.inject({ method: "POST", url: "/api/session", remoteAddress: `198.51.100.${String(i)}`, payload: wrongPassword(`guess${String(i)}`) }),
    ),
  );
  expect(flood.map((res) => res.statusCode).sort()).toEqual([401, 401, 401, 401, 503, 503, 503, 503]);
  const refused = flood.find((res) => res.statusCode === 503);
  expect([refused?.headers["retry-after"], refused?.json()]).toEqual(["1", authError("busy")]);

  // Every slot is free again once the flood has been answered.
  await Promise.all(Array.from({ length: 4 }, () => signIn(app, "Admin")));
});

test("50 wrong current passwords sent at once: 4 are checked and 46 told the server is busy", async () => {
  const { app, call } = setup();
  const cookie = await signIn(app, "Admin");
  const attempts = Array.from({ length: 50 }, () => call("POST", "/api/session/password", cookie, wrongCurrentPassword));
  expect(await statusCounts(attempts)).toEqual({ 401: 4, 503: 46 });
});

test("8 Accounts created at once: 4 are created and 4 told the server is busy", async () => {
  const { app, call } = setup();
  const admin = await signIn(app, "Admin");
  const creates = Array.from({ length: 8 }, (_, i) =>
    call("POST", "/api/accounts", admin, { username: `Robber ${String(i)}`, password: "temp-pass", role: "robber" }),
  );
  expect(await statusCounts(creates)).toEqual({ 201: 4, 503: 4 });
  expect((await call("GET", "/api/accounts", admin)).json<AccountList>().accounts).toHaveLength(5);
});

test("a failed sign-in is audited with the username and IP, and never the password", async () => {
  const { app, audited, auditLines } = setup();
  await app.inject({ method: "POST", url: "/api/session", remoteAddress: "203.0.113.7", payload: { username: "admin", password: "hunter2 guess" } });

  expect(auditLines.join("\n")).not.toContain("hunter2");
  expect(audited()).toEqual([{ at: T0.toISOString(), event: "signInFailed", username: "admin", ip: "203.0.113.7" }]);
});

test("sign-ins, throttled sign-ins and password changes are audited", async () => {
  const { app, call, audited } = setup();
  const cookie = await signIn(app, "admin");
  expect(audited()).toEqual([{ at: T0.toISOString(), event: "signInSucceeded", username: "Admin", ip: "127.0.0.1" }]);

  await call("POST", "/api/session/password", cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  expect(audited()).toEqual([{ at: T0.toISOString(), event: "passwordChanged", username: "Admin", ip: "127.0.0.1" }]);

  for (let i = 0; i < 11; i++) await call("POST", "/api/session", undefined, { username: "Admin", password: "not the password" });
  expect(audited().slice(-2)).toEqual([
    { at: T0.toISOString(), event: "signInFailed", username: "Admin", ip: "127.0.0.1" },
    { at: T0.toISOString(), event: "signInThrottled", username: "Admin", ip: "127.0.0.1" },
  ]);
});

test("creating and deleting an Account are audited with the Admin who did it", async () => {
  const { app, call, audited } = setup();
  const admin = await signIn(app, "Admin");
  const created = await call("POST", "/api/accounts", admin, { username: "New Robber", password: "temp-pass", role: "robber" });
  const { id } = created.json<AccountView>();
  await call("DELETE", `/api/accounts/${String(id)}`, admin);

  expect(audited().slice(1)).toEqual([
    { at: T0.toISOString(), event: "accountCreated", username: "New Robber", role: "robber", by: "Admin", ip: "127.0.0.1" },
    { at: T0.toISOString(), event: "accountDeleted", accountId: id, by: "Admin", ip: "127.0.0.1" },
  ]);
});

const signInFrom = (headers: Record<string, string>, remoteAddress = "127.0.0.1") =>
  ({ method: "POST", url: "/api/session", remoteAddress, headers, payload: { username: "Admin", password: PASSWORD } }) as const;

test.each([
  ["another site", "https://evil.example"],
  ["the same host on another scheme's port", "https://ess.example:8443"],
  ['"null"', "null"],
])("a sign-in sent from %s is refused with 403 and audited, and signs nothing in", async (_, origin) => {
  const { app, audited } = setup();
  const res = await app.inject(signInFrom({ host: "ess.example", origin }, "203.0.113.7"));

  expect([res.statusCode, res.json()]).toEqual([403, authError("forbiddenOrigin")]);
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(audited()).toEqual([
    { at: T0.toISOString(), event: "forbiddenOrigin", origin, method: "POST", url: "/api/session", ip: "203.0.113.7" },
  ]);
});

test("a sign-in from the page's own origin, or with no Origin at all, goes through", async () => {
  const { app } = setup();
  expect((await app.inject(signInFrom({ host: "ess.example", origin: "https://ess.example" }))).statusCode).toBe(200);
  expect((await app.inject(signInFrom({ host: "ESS.example:3000", origin: "http://ess.example:3000" }))).statusCode).toBe(200);
  expect((await app.inject(signInFrom({ host: "ess.example" }))).statusCode).toBe(200);
});

test("behind a trusted proxy, the Origin must match the host the proxy forwarded", async () => {
  const { app } = setup({ trustProxy: true });
  const forwarded = { host: "127.0.0.1:3000", "x-forwarded-host": "ess.example", "x-forwarded-proto": "https" };
  expect((await app.inject(signInFrom({ ...forwarded, origin: "https://ess.example" }))).statusCode).toBe(200);
  expect((await app.inject(signInFrom({ ...forwarded, origin: "http://127.0.0.1:3000" }))).statusCode).toBe(403);
});

test("a foreign Origin cannot sign a session out, but may read", async () => {
  const { app, admin } = setup();
  const cookie = await signIn(app, "Admin");
  const headers = { cookie, origin: "https://evil.example" };

  const signOut = await app.inject({ method: "DELETE", url: "/api/session", headers });
  expect([signOut.statusCode, signOut.json()]).toEqual([403, authError("forbiddenOrigin")]);
  const read = await app.inject({ method: "GET", url: "/api/session", headers });
  expect([read.statusCode, read.json()]).toEqual([200, { status: "active", account: admin }]);
});

test("a huge sign-in username is audited cut short", async () => {
  const { call, audited } = setup();
  await call("POST", "/api/session", undefined, { username: "x".repeat(100_000), password: "whatever" });
  expect(audited()).toEqual([expect.objectContaining({ event: "signInFailed", username: "x".repeat(200) })]);
});
