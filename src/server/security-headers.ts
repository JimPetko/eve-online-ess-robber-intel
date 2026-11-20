import type { FastifyInstance } from "fastify";
import { isApiUrl } from "./auth/access.ts";

/**
 * The built UI is one script and one stylesheet from this origin, with no inline script or style
 * element. React's `style` prop sets properties through the CSSOM, which CSP does not govern, so no
 * 'unsafe-inline' is needed. `img-src data:` is for the favicon, an inline SVG in index.html.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const EVERY_RESPONSE = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

/** onSend, so 404s, refusals and scrubbed 5xx carry them too. */
export function addSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.headers(EVERY_RESPONSE);
    // Over plain HTTP the header is ignored, and sending it there would pin a host still being set up.
    if (request.protocol === "https") void reply.header("strict-transport-security", "max-age=31536000");
    if (isApiUrl(request.url)) void reply.header("cache-control", "no-store");
    done(null, payload);
  });
}
