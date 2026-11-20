import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { regionId, type RegionList } from "../domain/index.ts";
import { enforceAccess } from "./auth/access.ts";
import { registerAuthRoutes } from "./auth/routes.ts";
import { createSignInThrottle } from "./auth/throttle.ts";
import { regionView } from "./region-view.ts";
import { listNullsecRegions, regionKills } from "./store/store.ts";

export interface AppDeps {
  readonly db: DatabaseSync;
  /** When the scheduler will next poll kills; null while a poll is in flight or none is scheduled. */
  readonly nextPullAt: () => Date | null;
  /** The built web UI (dist/web). Served only if it holds an index.html; in dev Vite serves the UI instead. */
  readonly webRoot?: string;
  /** Behind a reverse proxy: take the client's IP and protocol from its X-Forwarded-* headers. */
  readonly trustProxy?: boolean;
  /** The clock for session expiry and the sign-in throttle. */
  readonly now?: () => Date;
}

export function buildApp({ db, nextPullAt, webRoot, trustProxy = false, now = () => new Date() }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy });
  enforceAccess(app, db, now);

  app.get("/api/health", { config: { access: "public" } }, () => ({ ok: true }));

  registerAuthRoutes(app, { db, now, throttle: createSignInThrottle(now) });

  app.get("/api/regions", { config: { access: "active" } }, (): RegionList => ({ regions: listNullsecRegions(db) }));

  app.get<{ Params: { id: string } }>("/api/regions/:id", { config: { access: "active" } }, (request, reply) => {
    const { id } = request.params;
    if (!/^\d{1,15}$/.test(id)) return reply.code(400).send({ error: `Region id must be a number, got "${id}"` });
    const view = regionView(regionKills(db, regionId(Number(id))), nextPullAt());
    if (view === null) return reply.code(404).send({ error: `no in-scope Region ${id}` });
    return view;
  });

  if (webRoot !== undefined && existsSync(join(webRoot, "index.html"))) {
    void app.register(fastifyStatic, { root: webRoot, wildcard: false });
    // Client-side routes get the app shell; unknown API paths and missing files stay 404s.
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (request.method !== "GET" || path === "/api" || path.startsWith("/api/") || /\.[^/]*$/.test(path)) {
        return reply.code(404).send({ error: `no route ${request.method} ${request.url}` });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
