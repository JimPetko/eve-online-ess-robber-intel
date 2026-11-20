import { Readable } from "node:stream";
import { afterEach, expect, test } from "vitest";
import type { AccountView, SessionView } from "../domain/index.ts";
import { accountsCli } from "./accounts-cli.ts";
import { buildApp } from "./app.ts";
import { listAccounts } from "./store/accounts.ts";
import { openDb } from "./store/db.ts";
import { signIn } from "./test-support.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const stdin = (text: string) => Readable.from([text]);

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

test.each([
  ["a plain line", "first-temp\nnot the password\n"],
  ["Windows PowerShell's byte-order mark and CRLF", `${String.fromCodePoint(0xfeff)}first-temp\r\n`],
  ["no final newline", "first-temp"],
])(
  "create-admin prints the new Admin, who signs in with the first stdin line (%s) and must change it first",
  async (_, input) => {
    const db = openDb(":memory:");
    const result = await accountsCli(db, ["create-admin", "First Admin"], stdin(input), NOW);

    expect(result.exitCode).toBe(0);
    const admin = JSON.parse(result.output) as AccountView;
    expect(admin).toEqual({ id: expect.any(Number) as unknown, username: "First Admin", role: "admin" });

    const app = buildApp({ db, nextPullAt: () => null });
    apps.push(app);
    const cookie = await signIn(app, "First Admin", "first-temp");
    const session = await app.inject({ method: "GET", url: "/api/session", headers: { cookie } });
    expect(session.json()).toEqual({ status: "mustChangePassword", account: admin } satisfies SessionView);
  },
);

test.each([
  ["a taken username, in any case", ["create-admin", "first admin"], "another-temp\n", /^usernameTaken: /],
  ["an invalid username", ["create-admin", "no/slashes"], "first-temp\n", /^invalidUsername: /],
  ["a password under 8 characters", ["create-admin", "Second"], "short\n", /^weakPassword: /],
  ["empty stdin", ["create-admin", "Second"], "", /^weakPassword: /],
  ["no username", ["create-admin"], "first-temp\n", /^usage: /],
  ["an unknown command", ["create-robber", "Second"], "first-temp\n", /^usage: /],
])("create-admin exits 1 on %s and creates nothing", async (_, args, input, output) => {
  const db = openDb(":memory:");
  await accountsCli(db, ["create-admin", "First Admin"], stdin("first-temp\n"), NOW);

  const result = await accountsCli(db, args, stdin(input), NOW);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(output);
  expect(listAccounts(db).accounts.map((a) => a.username)).toEqual(["First Admin"]);
});
