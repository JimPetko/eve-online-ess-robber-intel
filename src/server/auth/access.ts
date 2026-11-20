import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthError, AuthErrorCode, SessionView } from "../../domain/index.ts";
import { sessionAccount, type StoredAccount } from "../store/accounts.ts";
import { sessionToken, tokenHash } from "./session-cookie.ts";

/**
 * Who may call a route, each level including the ones after it: `signedIn` is any session, even one
 * that must change its password first; `active` is a session that need not; `admin` is an active Admin.
 */
export type Access = "public" | "signedIn" | "active" | "admin";

/** `/api`, `/api/...` or `/api?...`: the paths whose routes must declare an access level. */
export const isApiUrl = (url: string): boolean => /^\/api(?:[/?]|$)/.test(url);

export interface SignedIn {
  readonly tokenHash: string;
  readonly account: StoredAccount;
}

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    signedIn: SignedIn | null;
  }
}

export interface Refusal {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429;
  readonly body: AuthError;
}

export const refuse = (status: Refusal["status"], error: AuthErrorCode, message: string): Refusal => ({
  status,
  body: { error, message },
});

export const send = (reply: FastifyReply, refusal: Refusal) => reply.code(refusal.status).send(refusal.body);

function refusal(access: Access, signedIn: SignedIn | null): Refusal | null {
  if (access === "public") return null;
  if (signedIn === null) return refuse(401, "signInRequired", "Sign in first.");
  if (access === "signedIn") return null;
  if (signedIn.account.mustChangePassword) {
    return refuse(403, "passwordChangeRequired", "Change your password before doing anything else.");
  }
  if (access === "admin" && signedIn.account.role !== "admin") return refuse(403, "adminRequired", "Only an Admin can do that.");
  return null;
}

export function sessionView(account: StoredAccount | null): SessionView {
  if (account === null) return { status: "signedOut" };
  const { id, username, role, mustChangePassword } = account;
  return { status: mustChangePassword ? "mustChangePassword" : "active", account: { id, username, role } };
}

export function signedInAs(request: FastifyRequest): SignedIn {
  if (request.signedIn === null) throw new Error(`${request.method} ${request.url} ran without a session`);
  return request.signedIn;
}

/**
 * The one place access is enforced. Every /api route must declare its `config.access` or the app
 * refuses to start; the hook resolves the session cookie and turns away a request below that level.
 */
export function enforceAccess(app: FastifyInstance, db: DatabaseSync, now: () => Date): void {
  app.decorateRequest("signedIn", null);

  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api") && route.config?.access === undefined) {
      throw new Error(`${String(route.method)} ${route.url} declares no access level`);
    }
  });

  app.addHook("onRequest", (request, reply, done) => {
    const { access } = request.routeOptions.config;
    if (access !== undefined) {
      const token = sessionToken(request.headers.cookie);
      if (token !== null) {
        const hash = tokenHash(token);
        const account = sessionAccount(db, hash, now());
        request.signedIn = account === null ? null : { tokenHash: hash, account };
      }
      const refused = refusal(access, request.signedIn);
      // Replying here ends the request; calling done as well would run the handler too.
      if (refused !== null) return void send(reply, refused);
    }
    done();
  });
}
