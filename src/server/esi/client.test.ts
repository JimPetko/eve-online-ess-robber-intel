import { expect, test } from "vitest";
import { createEsi, EsiError } from "./client.ts";
import { EsiParseError } from "./parse.ts";

const UA = "ess-robber-intel/0.0.0 (test@example.com)";

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function recordingSleep() {
  const calls: number[] = [];
  return { calls, sleep: (ms: number) => (calls.push(ms), Promise.resolve()) };
}

test("sends the required headers and returns parsed data with cache headers", async () => {
  const requests: Request[] = [];
  const esi = createEsi({
    userAgent: UA,
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        json([{ system_id: 30000001, npc_kills: 12, ship_kills: 0, pod_kills: 0 }], {
          headers: { "last-modified": "Wed, 18 Nov 2026 11:21:24 GMT", expires: "Wed, 18 Nov 2026 12:21:24 GMT" },
        }),
      );
    },
  });

  const res = await esi.systemKills();

  expect(res.data).toEqual([{ system_id: 30000001, npc_kills: 12 }]);
  expect(res.lastModified?.toISOString()).toBe("2026-11-18T11:21:24.000Z");
  expect(res.expires?.toISOString()).toBe("2026-11-18T12:21:24.000Z");
  const [request] = requests;
  expect(request?.url).toBe("https://esi.evetech.net/universe/system_kills");
  expect(request?.headers.get("user-agent")).toBe(UA);
  expect(request?.headers.get("x-compatibility-date")).toBe("2020-01-01");
});

test("rejects a payload that does not match the expected shape", async () => {
  const esi = createEsi({ userAgent: UA, fetch: () => Promise.resolve(json({ region_id: 1, name: 7 })) });
  await expect(esi.region(1 as never)).rejects.toThrow(EsiParseError);
});

test("retries transient 5xx with growing backoff, then succeeds", async () => {
  const statuses = [502, 503];
  const { calls, sleep } = recordingSleep();
  const esi = createEsi({
    userAgent: UA,
    sleep,
    fetch: () => {
      const status = statuses.shift();
      return Promise.resolve(status === undefined ? json([10000001]) : json({ error: "down" }, { status }));
    },
  });

  expect((await esi.regionIds()).data).toEqual([10000001]);
  expect(calls).toEqual([500, 1000]);
});

test("retries network errors", async () => {
  let attempts = 0;
  const esi = createEsi({
    userAgent: UA,
    sleep: () => Promise.resolve(),
    fetch: () => (++attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(json([1]))),
  });
  expect((await esi.regionIds()).data).toEqual([1]);
  expect(attempts).toBe(2);
});

test("gives up after maxRetries on persistent 5xx", async () => {
  let attempts = 0;
  const esi = createEsi({
    userAgent: UA,
    maxRetries: 2,
    sleep: () => Promise.resolve(),
    fetch: () => (attempts++, Promise.resolve(json({ error: "down" }, { status: 500 }))),
  });
  await expect(esi.regionIds()).rejects.toThrow(EsiError);
  expect(attempts).toBe(3);
});

test("does not retry a 4xx", async () => {
  let attempts = 0;
  const esi = createEsi({
    userAgent: UA,
    fetch: () => (attempts++, Promise.resolve(json({ error: "not found" }, { status: 404 }))),
  });
  await expect(esi.system(1 as never)).rejects.toMatchObject({ status: 404 });
  expect(attempts).toBe(1);
});

test("pauses every request until the error window resets once the budget runs low", async () => {
  let fetches = 0;
  let wake: () => void = () => undefined;
  const sleeps: number[] = [];
  const esi = createEsi({
    userAgent: UA,
    errorLimitFloor: 10,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => (wake = resolve));
    },
    fetch: () => {
      fetches++;
      const remain = fetches === 1 ? "9" : "100";
      return Promise.resolve(json([1], { headers: { "x-esi-error-limit-remain": remain, "x-esi-error-limit-reset": "42" } }));
    },
  });

  await esi.regionIds();
  const second = esi.regionIds();
  await new Promise((resolve) => setImmediate(resolve));
  expect(sleeps).toEqual([42000]);
  expect(fetches).toBe(1);

  wake();
  await second;
  expect(fetches).toBe(2);
  expect(sleeps).toEqual([42000]);
});

test("waits Retry-After on 429 and retries", async () => {
  const { calls, sleep } = recordingSleep();
  let attempts = 0;
  const esi = createEsi({
    userAgent: UA,
    sleep,
    fetch: () =>
      Promise.resolve(++attempts === 1 ? json({ error: "slow down" }, { status: 429, headers: { "retry-after": "7" } }) : json([1])),
  });
  expect((await esi.regionIds()).data).toEqual([1]);
  expect(calls).toEqual([7000]);
});

test("keeps at most maxConcurrency requests in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const release: (() => void)[] = [];
  const esi = createEsi({
    userAgent: UA,
    maxConcurrency: 3,
    fetch: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      return json([1]);
    },
  });

  const all = Promise.all(Array.from({ length: 10 }, () => esi.regionIds()));
  while (release.length > 0 || inFlight > 0) {
    await new Promise((resolve) => setImmediate(resolve));
    release.shift()?.();
  }
  await all;
  expect(peak).toBe(3);
});
