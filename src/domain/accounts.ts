import type { IsoTimestamp } from "./region-view.ts";

declare const brand: unique symbol;
export type AccountId = number & { readonly [brand]: "AccountId" };
export const accountId = (id: number): AccountId => id as AccountId;

/** An Admin manages Accounts; a Robber only reads the intel. */
export type AccountRole = "admin" | "robber";

export type AccountView = {
  readonly id: AccountId;
  readonly username: string;
  readonly role: AccountRole;
};

/**
 * `GET /api/session`. One state, never a pair of booleans: a signed-in Account
 * whose password is still the one an Admin set (or the seeded one) can do
 * nothing but change it or sign out.
 */
export type SessionView =
  | { readonly status: "signedOut" }
  | { readonly status: "mustChangePassword"; readonly account: AccountView }
  | { readonly status: "active"; readonly account: AccountView };

/** `GET /api/accounts` (Admins only), by username. */
export type AccountList = {
  readonly accounts: readonly (AccountView & {
    readonly mustChangePassword: boolean;
    readonly createdAt: IsoTimestamp;
  })[];
};

/** Request bodies. The server parses each at the boundary; these are the shapes it accepts. */
export type SignInRequest = { readonly username: string; readonly password: string };
export type ChangePasswordRequest = { readonly currentPassword: string; readonly newPassword: string };
export type CreateAccountRequest = {
  readonly username: string;
  /** Temporary: the new Account must replace it at first sign-in. */
  readonly password: string;
  readonly role: AccountRole;
};

/** Every auth or account error answers `{ error: AuthErrorCode, message }` so the UI can branch on the code. */
export type AuthErrorCode =
  | "invalidCredentials"
  | "tooManyAttempts"
  | "signInRequired"
  | "passwordChangeRequired"
  | "adminRequired"
  | "weakPassword"
  | "invalidUsername"
  | "invalidRole"
  | "usernameTaken"
  | "cannotDeleteAdmin"
  | "accountNotFound"
  /** A state-changing request sent by a browser from another site. */
  | "forbiddenOrigin";
export type AuthError = { readonly error: AuthErrorCode; readonly message: string };

export const USERNAME_RULE = {
  minLength: 3,
  maxLength: 32,
  /** Letters, digits, spaces, dot, underscore, hyphen; no leading, trailing or doubled spaces. */
  pattern: /^[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*$/,
} as const;

export const PASSWORD_RULE = {
  /** A password an Account chooses for itself. */
  minLength: 12,
  /** A temporary password an Admin sets; it only lasts until first sign-in. */
  temporaryMinLength: 8,
  maxLength: 256,
} as const;
