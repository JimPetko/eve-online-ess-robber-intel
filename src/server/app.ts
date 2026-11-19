import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { regionId, type RegionList } from "../domain/index.ts";
import { regionView } from "./region-view.ts";
import { listNullsecRegions, regionKills } from "./store/store.ts";

export interface AppDeps {
  readonly db: DatabaseSync;
  /** When the scheduler will next poll kills; null while a poll is in flight or none is scheduled. */
  readonly nextPullAt: () => Date | null;
  /** The built web UI (dist/web). Served only if it holds an index.html; in dev Vite serves the UI instead. */
  readonly webRoot?: string;
}

export function buildApp({ db, nextPullAt, webRoot }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", () => ({ ok: true }));

  app.get("/api/regions", (): RegionList => ({ regions: listNullsecRegions(db) }));

  app.get<{ Params: { id: string } }>("/api/regions/:id", (request, reply) => {
    const { id } = request.params;
    if (!/^\d{1,15}$/.test(id)) return reply.code(400).send({ error: `Region id must be a number, got "${id}"` });
    const view = regionView(regionKills(db, regionId(Number(id))), nextPullAt());
    if (view === null) return reply.code(404).send({ error: `no in-scope Region ${id}` });
    return view;
  });

  if (webRoot !== undefined && existsSync(join(webRoot, "index.html"))) {
    void app.register(fastifyStatic, { root: webRoot, wildcard: false });
    // Client-side routes get the app shell; unknown API paths stay 404s.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: `no route ${request.method} ${request.url}` });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
