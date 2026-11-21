import type { FastifyInstance } from "fastify";
import { isApiUrl, refuse, send } from "./access.ts";
import type { Audit } from "./audit.ts";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null; // "null", sent by sandboxed frames and some redirects, is no host at all.
  }
}

/**
 * Refuses a state-changing /api request that a browser sent from another site. A request with no
 * Origin passes: browsers send one with every such request, and SameSite=Strict already keeps the
 * session cookie off cross-site ones, so this is a second lock, not the only one.
 */
export function refuseForeignOrigins(app: FastifyInstance, audit: Audit): void {
  app.addHook("onRequest", (request, reply, done) => {
    const { origin } = request.headers;
    const checked = origin !== undefined && STATE_CHANGING.has(request.method) && isApiUrl(request.url);
    // request.host is the Host header, or behind a trusted proxy the X-Forwarded-Host it set.
    if (!checked || originHost(origin) === request.host.toLowerCase()) {
      done();
      return;
    }
    audit({ event: "forbiddenOrigin", origin, method: request.method, url: request.url, ip: request.ip });
    // Replying here ends the request; calling done as well would run the handler too.
    return void send(reply, refuse(403, "forbiddenOrigin", "This request came from another site."));
  });
}
