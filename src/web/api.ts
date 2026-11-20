import type {
  AccountId,
  AccountList,
  AccountView,
  AuthError,
  AuthErrorCode,
  ChangePasswordRequest,
  CreateAccountRequest,
  RegionId,
  RegionList,
  RegionView,
  SessionView,
  SignInRequest,
} from "../domain/index.ts";
import { fixtureAccounts, type FixtureAccounts } from "./fixtures/accounts.ts";
import { FIXTURE_REGIONS, fixtureRegionView, type FixtureSync } from "./fixtures/region-view.ts";

export type Api = {
  readonly regions: () => Promise<RegionList>;
  readonly regionView: (id: RegionId) => Promise<RegionView>;
  readonly session: () => Promise<SessionView>;
  readonly signIn: (req: SignInRequest) => Promise<SessionView>;
  readonly signOut: () => Promise<void>;
  readonly changePassword: (req: ChangePasswordRequest) => Promise<SessionView>;
  readonly accounts: () => Promise<AccountList>;
  readonly createAccount: (req: CreateAccountRequest) => Promise<AccountView>;
  readonly deleteAccount: (id: AccountId) => Promise<void>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: AuthErrorCode | null;
  constructor(status: number, code: AuthErrorCode | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isAuthError(body: unknown): body is AuthError {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).error === "string" &&
    typeof (body as Record<string, unknown>).message === "string"
  );
}

async function request<T>(fetchFn: typeof fetch, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetchFn(path, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const parsed: unknown = await res.json().catch(() => null);
    if (isAuthError(parsed)) throw new ApiError(res.status, parsed.error, parsed.message);
    throw new ApiError(res.status, null, `${path}: HTTP ${String(res.status)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Our own API, same-origin so the HttpOnly session cookie rides along; its types are the shared domain contract, so no runtime parse. */
export function httpApi(fetchFn: typeof fetch = fetch): Api {
  return {
    regions: () => request(fetchFn, "GET", "/api/regions"),
    regionView: (id) => request(fetchFn, "GET", `/api/regions/${String(id)}`),
    session: () => request(fetchFn, "GET", "/api/session"),
    signIn: (req) => request(fetchFn, "POST", "/api/session", req),
    signOut: () => request(fetchFn, "DELETE", "/api/session"),
    changePassword: (req) => request(fetchFn, "POST", "/api/session/password", req),
    accounts: () => request(fetchFn, "GET", "/api/accounts"),
    createAccount: (req) => request(fetchFn, "POST", "/api/accounts", req),
    deleteAccount: (id) => request(fetchFn, "DELETE", `/api/accounts/${String(id)}`),
  };
}

export function fixtureApi(
  sync: FixtureSync = "recent",
  now: () => Date = () => new Date(),
  accounts: FixtureAccounts = fixtureAccounts(),
): Api {
  return {
    ...accounts.api,
    regions: () => accounts.whenActive(() => FIXTURE_REGIONS),
    regionView: (id) =>
      accounts.whenActive(() => {
        const delve = fixtureRegionView(now(), sync);
        if (id === delve.region.id) return delve;
        const summary = FIXTURE_REGIONS.regions.find((r) => r.id === id);
        if (!summary) throw new ApiError(404, null, `/api/regions/${String(id)}: HTTP 404`);
        return { ...delve, region: { id: summary.id, name: summary.name }, constellations: [], systems: [] };
      }),
  };
}
