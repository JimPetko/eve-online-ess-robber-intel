import {
  accountId,
  PASSWORD_RULE,
  USERNAME_RULE,
  type AccountList,
  type AccountRole,
  type AccountView,
  type AuthErrorCode,
  type SessionView,
} from "../../domain/index.ts";
import { ApiError, type Api } from "../api.ts";

export type FixtureAccount = {
  readonly username: string;
  readonly password: string;
  readonly role: AccountRole;
  readonly mustChangePassword: boolean;
};

export type FixtureAccounts = {
  readonly api: Pick<
    Api,
    "session" | "signIn" | "signOut" | "changePassword" | "accounts" | "createAccount" | "deleteAccount"
  >;
  /** Runs `serve` only for an active session, failing the way the server does otherwise. */
  readonly whenActive: <T>(serve: () => T) => Promise<T>;
};

export const FIXTURE_SEED: readonly FixtureAccount[] = [
  { username: "admin", password: "fixture-admin-password", role: "admin", mustChangePassword: false },
  { username: "Ratbag", password: "temporary1", role: "robber", mustChangePassword: true },
];

type Stored = FixtureAccount & { readonly id: AccountView["id"]; readonly createdAt: string };

const fail = (status: number, code: AuthErrorCode, message: string): never => {
  throw new ApiError(status, code, message);
};

/** A thrown ApiError becomes a rejection, as it would from the HTTP client. */
const settle = <T,>(f: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(f());
  });

/**
 * An in-memory stand-in for the server's Accounts and session endpoints, with the same rules
 * and error codes. `signedInAs` names the Account whose session is open at the start.
 */
export function fixtureAccounts(
  seed: readonly FixtureAccount[] = FIXTURE_SEED,
  signedInAs: string | null = "admin",
): FixtureAccounts {
  let nextId = 1;
  let accounts: Stored[] = seed.map((a) => ({ ...a, id: accountId(nextId++), createdAt: "2026-11-01T12:00:00Z" }));
  let current = accounts.find((a) => a.username === signedInAs)?.id ?? null;

  const view = ({ id, username, role }: Stored): AccountView => ({ id, username, role });
  const signedIn = () => accounts.find((a) => a.id === current) ?? null;
  const session = (): SessionView => {
    const me = signedIn();
    if (!me) return { status: "signedOut" };
    return { status: me.mustChangePassword ? "mustChangePassword" : "active", account: view(me) };
  };
  const requireActive = (): Stored => {
    const me = signedIn() ?? fail(401, "signInRequired", "Sign in to continue.");
    if (me.mustChangePassword) fail(403, "passwordChangeRequired", "Change your password to continue.");
    return me;
  };
  const requireAdmin = () => {
    if (requireActive().role !== "admin") fail(403, "adminRequired", "Only an Admin can manage Accounts.");
  };
  const replace = (id: Stored["id"], patch: Partial<Stored>) => {
    accounts = accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
  };

  return {
    whenActive: (serve) =>
      settle(() => {
        requireActive();
        return serve();
      }),
    api: {
      session: () => settle(session),
      signIn: ({ username, password }) =>
        settle(() => {
          const match = accounts.find((a) => a.username === username && a.password === password);
          current = (match ?? fail(401, "invalidCredentials", "Wrong username or password.")).id;
          return session();
        }),
      signOut: () =>
        settle(() => {
          current = null;
        }),
      changePassword: ({ currentPassword, newPassword }) =>
        settle(() => {
          const me = signedIn() ?? fail(401, "signInRequired", "Sign in to continue.");
          if (me.password !== currentPassword) fail(401, "invalidCredentials", "Your current password is wrong.");
          if (newPassword.length < PASSWORD_RULE.minLength)
            fail(400, "weakPassword", `Use at least ${String(PASSWORD_RULE.minLength)} characters.`);
          replace(me.id, { password: newPassword, mustChangePassword: false });
          return session();
        }),
      accounts: () =>
        settle((): AccountList => {
          requireAdmin();
          return {
            accounts: accounts
              .toSorted((a, b) => a.username.localeCompare(b.username))
              .map((a) => ({ ...view(a), mustChangePassword: a.mustChangePassword, createdAt: a.createdAt })),
          };
        }),
      createAccount: ({ username, password, role }) =>
        settle(() => {
          requireAdmin();
          if (
            username.length < USERNAME_RULE.minLength ||
            username.length > USERNAME_RULE.maxLength ||
            !USERNAME_RULE.pattern.test(username)
          )
            fail(400, "invalidUsername", "Usernames are 3 to 32 letters, digits, spaces, dots, underscores or hyphens.");
          if (password.length < PASSWORD_RULE.temporaryMinLength)
            fail(400, "weakPassword", `Use at least ${String(PASSWORD_RULE.temporaryMinLength)} characters.`);
          if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase()))
            fail(409, "usernameTaken", `An Account named ${username} already exists.`);
          const created: Stored = {
            id: accountId(nextId++),
            username,
            password,
            role,
            mustChangePassword: true,
            createdAt: new Date().toISOString(),
          };
          accounts = [...accounts, created];
          return view(created);
        }),
      deleteAccount: (id) =>
        settle(() => {
          requireAdmin();
          const target = accounts.find((a) => a.id === id) ?? fail(404, "accountNotFound", "No such Account.");
          if (target.role === "admin") fail(403, "cannotDeleteAdmin", "An Admin cannot be deleted.");
          accounts = accounts.filter((a) => a.id !== id);
        }),
    },
  };
}
