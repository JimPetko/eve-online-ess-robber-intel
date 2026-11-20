import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { regionId, type RegionList } from "../domain/index.ts";
import { enforceAccess } from "./auth/access.ts";
import { auditLog } from "./auth/audit.ts";
import { registerAuthRoutes } from "./auth/routes.ts";
import { createSignInThrottle } from "./auth/throttle.ts";
import { regionView } from "./region-view.ts";
import { addSecurityHeaders } from "./security-headers.ts";
import { listNullsecRegions, regionKills } from "./store/store.ts";

export interface AppDeps {
  readonly db: DatabaseSync;
  /** When the scheduler will next poll kills; null while a poll is in flight or none is scheduled. */
  readonly nextPullAt: () => Date | null;
  /** The built web UI (dist/web). Served only if it holds an index.html; in dev Vite serves the UI instead. */
  readonly webRoot?: string;
  /**
   * Behind one reverse proxy directly in front: take the client's IP and protocol from the entry that
   * proxy appended to X-Forwarded-*. Entries before it are whatever the client sent, so they are ignored.
   */
  readonly trustProxy?: boolean;
  readonly now?: () => Date;
  /** Where a 5xx's error goes, since its response says only that something went wrong. */
  readonly logError?: (line: string, error: unknown) => void;
  /** Where each security event goes: one `audit {json}` line per sign-in, password change, Account change or refused origin. */
  readonly logAudit?: (line: string) => void;
}

export function buildApp({
  db,
  nextPullAt,
  webRoot,
  trustProxy = false,
  now = () => new Date(),
  logError = console.error,
  logAudit = console.log,
}: AppDeps): FastifyInstance {
  const audit = auditLog(logAudit, now);
  // Trusts the immediate peer and nothing past it. Fastify reads a hop count (`trustProxy: 1`) as trust-nothing.
  const app = Fastify({ logger: false, trustProxy: trustProxy && ((_address: string, hop: number) => hop === 0) });
  addSecurityHeaders(app);
  enforceAccess(app, db, now);

  // Fastify's own 4xx (bad JSON, unsupported content type) describe the request; anything else may describe the server.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalidRequest", message: error.message });
    }
    logError(`${request.method} ${request.url} failed:`, error);
    return reply.code(500).send({ error: "internal", message: "Something went wrong." });
  });

  app.get("/api/health", { config: { access: "public" } }, () => ({ ok: true }));

  registerAuthRoutes(app, { db, now, throttle: createSignInThrottle(now), audit });

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
