import { useState, type SyntheticEvent } from "react";
import { APP_TITLE } from "../domain/app.ts";
import { PASSWORD_RULE, type AccountView, type SessionView } from "../domain/index.ts";
import type { Api } from "./api.ts";
import { useAction } from "./hooks.ts";

export function SignIn({
  api,
  notice,
  onSession,
}: {
  api: Api;
  notice: string | null;
  onSession: (session: SessionView) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    action.run(() => api.signIn({ username, password }), onSession);
  };
  return (
    <main className="auth">
      <h1>{APP_TITLE}</h1>
      <form className="card" onSubmit={submit}>
        <h2>Sign in</h2>
        {notice && <p className="muted">{notice}</p>}
        <label className="field">
          Username
          <input
            autoFocus
            required
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {action.error && (
          <p className="form-error" role="alert">
            {action.error}
          </p>
        )}
        <button className="primary" type="submit" disabled={action.pending}>
          {action.pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export function ChangePassword({
  api,
  account,
  onSession,
  onSignOut,
}: {
  api: Api;
  account: AccountView;
  onSession: (session: SessionView) => void;
  onSignOut: () => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      action.fail("The new passwords do not match.");
      return;
    }
    action.run(() => api.changePassword({ currentPassword, newPassword }), onSession);
  };
  const hint = `At least ${String(PASSWORD_RULE.minLength)} characters.`;
  return (
    <main className="auth">
      <h1>{APP_TITLE}</h1>
      <form className="card" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <p className="muted">
          This is the first sign-in for <strong>{account.username}</strong>. Replace the password you were given
          with one only you know before you go on.
        </p>
        {/* Lets a password manager file the new password under the right username. */}
        <input hidden readOnly autoComplete="username" value={account.username} />
        <label className="field">
          Current password
          <input
            autoFocus
            required
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrent(e.target.value);
            }}
          />
        </label>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            required
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_RULE.minLength}
            maxLength={PASSWORD_RULE.maxLength}
            aria-describedby="new-password-hint"
            value={newPassword}
            onChange={(e) => {
              setNew(e.target.value);
            }}
          />
          <span id="new-password-hint" className="hint">
            {hint}
          </span>
        </div>
        <label className="field">
          Confirm new password
          <input
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </label>
        {action.error && (
          <p className="form-error" role="alert">
            {action.error}
          </p>
        )}
        <div className="actions">
          <button className="primary" type="submit" disabled={action.pending}>
            {action.pending ? "Saving…" : "Change password"}
          </button>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </main>
  );
}
