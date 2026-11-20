import type { AccountId, AccountRole } from "../../domain/index.ts";

/** A security event. Never carries a password, a session token or a hash. */
export type AuditEvent =
  | { readonly event: "signInSucceeded" | "signInFailed" | "signInThrottled"; readonly username: string; readonly ip: string }
  | { readonly event: "passwordChanged"; readonly username: string; readonly ip: string }
  | { readonly event: "accountCreated"; readonly username: string; readonly role: AccountRole; readonly by: string; readonly ip: string }
  | { readonly event: "accountDeleted"; readonly accountId: AccountId; readonly by: string; readonly ip: string }
  | { readonly event: "forbiddenOrigin"; readonly origin: string; readonly method: string; readonly url: string; readonly ip: string };

export type Audit = (event: AuditEvent) => void;

/** Caps a field a client chose, such as a sign-in username, so one request cannot write a huge line. */
const MAX_FIELD = 200;

/** One `audit {json}` line per event. JSON escapes newlines, so a client cannot forge a line. */
export function auditLog(write: (line: string) => void, now: () => Date): Audit {
  return (event) => {
    const fields = Object.entries(event).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, MAX_FIELD) : value]);
    write(`audit ${JSON.stringify({ at: now().toISOString(), ...Object.fromEntries(fields) })}`);
  };
}
