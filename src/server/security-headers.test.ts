import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, test } from "vitest";
import { buildApp } from "./app.ts";
import { openDb } from "./store/db.ts";

const webRoot = mkdtempSync(join(tmpdir(), "ess-web-"));
writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>ESS</title>");
afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(options: { trustProxy?: boolean } = {}) {
  const db = openDb(":memory:");
  const app = buildApp({ db, nextPullAt: () => null, webRoot, logError: () => undefined, ...options });
  apps.push(app);
  return { db, app };
}

const EVERY_RESPONSE = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

test.each([
  ["the app shell", "/", 200],
  ["a client route", "/regions/delve", 200],
  ["a missing asset", "/assets/gone.js", 404],
  ["a public API route", "/api/health", 200],
  ["an API route refused for want of a session", "/api/regions", 401],
  ["an unknown API route", "/api/nope", 404],
])("%s carries the security headers", async (_, url, status) => {
  const res = await setup().app.inject({ method: "GET", url });
  expect(res.statusCode).toBe(status);
  expect(res.headers).toMatchObject(EVERY_RESPONSE);
});

test("a scrubbed 500 carries the security headers too", async () => {
  const { db, app } = setup();
  db.close();
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { username: "Admin", password: "x" } });
  expect(res.statusCode).toBe(500);
  expect(res.headers).toMatchObject({ ...EVERY_RESPONSE, "cache-control": "no-store" });
});

test("API responses are never cached; the app shell keeps its own caching", async () => {
  const { app } = setup();
  for (const url of ["/api/health", "/api/session", "/api/regions", "/api/nope", "/api?x=1"]) {
    expect([url, (await app.inject({ method: "GET", url })).headers["cache-control"]]).toEqual([url, "no-store"]);
  }
  expect((await app.inject({ method: "GET", url: "/" })).headers["cache-control"]).not.toBe("no-store");
});

test("Strict-Transport-Security is sent only when the request arrived over https", async () => {
  const proxied = setup({ trustProxy: true }).app;
  const overHttps = await proxied.inject({ method: "GET", url: "/", headers: { "x-forwarded-proto": "https" } });
  expect(overHttps.headers["strict-transport-security"]).toBe("max-age=31536000");
  const overHttp = await proxied.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-proto": "http" } });
  expect(overHttp.headers["strict-transport-security"]).toBeUndefined();

  // Without a trusted proxy, a client's own X-Forwarded-Proto is not believed.
  const direct = await setup().app.inject({ method: "GET", url: "/", headers: { "x-forwarded-proto": "https" } });
  expect(direct.headers["strict-transport-security"]).toBeUndefined();
});
