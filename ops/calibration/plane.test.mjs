import { describe, expect, it } from "vitest";
import { EXTERNAL_SOURCE, syncWorkItem } from "./plane.mjs";

/** An in-memory Plane with one ESS project, answering the endpoints syncWorkItem uses. */
function fakePlane({ items = [], pageSize = 100 } = {}) {
  const plane = {
    items: items.map((i) => ({ ...i })),
    writes: [],
    keys: new Set(),
    fetch: async (url, { method, headers, body }) => {
      plane.keys.add(headers["X-API-Key"]);
      const { pathname, searchParams } = new URL(url);
      const path = pathname.replace("/api/v1/workspaces/home", "");
      const page = (results) => {
        const start = Number(searchParams.get("cursor") ?? 0);
        const end = start + Math.min(pageSize, Number(searchParams.get("per_page")));
        return { results: results.slice(start, end), next_cursor: String(end), next_page_results: end < results.length };
      };
      const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
      if (method === "GET" && path === "/projects/") return json(page([{ id: "p0", identifier: "WEB" }, { id: "p1", identifier: "ESS" }]));
      if (method === "GET" && path === "/projects/p1/states/")
        return json(page([{ id: "s-todo", name: "Todo", group: "unstarted" }, { id: "s-wip", name: "In Progress", group: "started" }, { id: "s-done", name: "Done", group: "completed" }]));
      if (method === "GET" && path === "/projects/p1/labels/") return json(page([{ id: "l-bug", name: "bug" }, { id: "l-research", name: "research" }]));
      if (method === "GET" && path === "/projects/p1/work-items/") return json(page(plane.items));
      const data = body === undefined ? undefined : JSON.parse(body);
      if (method === "POST" && path === "/projects/p1/work-items/") {
        const item = { id: `w${String(plane.items.length + 1)}`, ...data };
        plane.items.push(item);
        plane.writes.push(method);
        return json(item, 201);
      }
      const patch = /^\/projects\/p1\/work-items\/([^/]+)\/$/.exec(path);
      if (method === "PATCH" && patch) {
        const item = plane.items.find((i) => i.id === patch[1]);
        Object.assign(item, data);
        plane.writes.push(method);
        return json(item);
      }
      return json({ detail: "not found" }, 404);
    },
  };
  return plane;
}

const sync = (plane, overrides) =>
  syncWorkItem({
    baseUrl: "http://plane.test/",
    apiKey: "secret-key",
    workspace: "home",
    project: "ESS",
    month: "2026-11",
    prUrl: "https://github.com/o/r/pull/12",
    done: true,
    fetch: plane.fetch,
    ...overrides,
  });

describe("syncWorkItem", () => {
  it("creates a Done research item that links the PR", async () => {
    const plane = fakePlane();
    expect(await sync(plane)).toEqual({ action: "created as Done", id: "w1" });
    expect(plane.items).toEqual([
      expect.objectContaining({
        name: "Recalibrate ISK per NPC kill for 2026-11",
        state: "s-done",
        labels: ["l-research"],
        external_source: EXTERNAL_SOURCE,
        external_id: "2026-11",
        description_html: expect.stringContaining('<a href="https://github.com/o/r/pull/12">'),
      }),
    ]);
    expect(plane.keys).toEqual(new Set(["secret-key"]));
  });

  it("updates the same item on a re-run instead of adding another", async () => {
    const plane = fakePlane();
    await sync(plane, { done: false });
    expect(plane.items[0].state).toBe("s-wip");
    expect(await sync(plane)).toEqual({ action: "updated as Done", id: "w1" });
    expect(plane.items).toHaveLength(1);
    expect(plane.items[0].state).toBe("s-done");
  });

  it("finds the existing item on a later page and keeps its other labels", async () => {
    const others = Array.from({ length: 5 }, (_, i) => ({ id: `o${String(i)}`, external_source: null, external_id: null, labels: [] }));
    const mine = { id: "mine", external_source: EXTERNAL_SOURCE, external_id: "2026-11", labels: ["l-bug"] };
    const plane = fakePlane({ items: [...others, mine], pageSize: 2 });
    expect(await sync(plane)).toEqual({ action: "updated as Done", id: "mine" });
    expect(plane.items.find((i) => i.id === "mine").labels).toEqual(["l-bug", "l-research"]);
  });

  it("does not match another month's item", async () => {
    const plane = fakePlane({ items: [{ id: "old", external_source: EXTERNAL_SOURCE, external_id: "2026-10", labels: [] }] });
    expect((await sync(plane)).action).toBe("created as Done");
    expect(plane.items).toHaveLength(2);
  });

  it("writes nothing in a dry run", async () => {
    const plane = fakePlane();
    expect(await sync(plane, { dryRun: true })).toEqual({ action: "would be created as Done", id: undefined });
    expect(plane.writes).toEqual([]);
  });

  it("reports a missing project without the key", async () => {
    const plane = fakePlane();
    const error = await sync(plane, { project: "NOPE" }).catch((e) => e);
    expect(error.message).toBe("Plane has no project NOPE in home");
    expect(error.message).not.toContain("secret-key");
  });
});
