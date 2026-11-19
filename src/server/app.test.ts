import { expect, test } from "vitest";
import { buildApp } from "./app.ts";

test("GET /api/health reports ok", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
  await app.close();
});
