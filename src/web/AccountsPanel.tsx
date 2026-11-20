import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import {
  PASSWORD_RULE,
  type AccountId,
  type AccountList,
  type AccountRole,
} from "../domain/index.ts";
import { errorMessage, type Api } from "./api.ts";
import { formatEveTime } from "./format.ts";
import { useAction } from "./hooks.ts";

const ROLE_LABEL: Record<AccountRole, string> = {
  admin: "Admin",
  robber: "Robber",
};

/** Admins only: list, create and delete Accounts. */
export function AccountsPanel({ api }: { api: Api }) {
  const [list, setList] = useState<AccountList["accounts"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api.accounts().then(
      (l) => {
        setList(l.accounts);
        setLoadError(null);
      },
      (e: unknown) => {
        setLoadError(errorMessage(e));
      },
    );
  }, [api]);
  useEffect(refresh, [refresh]);

  return (
    <main>
      <section className="region-head">
        <h2>Accounts</h2>
      </section>
      {loadError && (
        <div className="banner" role="alert">
          Could not load Accounts: {loadError}
        </div>
      )}
      {list && <AccountTable api={api} accounts={list} onChanged={refresh} />}
      {!list && !loadError && <p className="muted">Loading…</p>}
      <CreateAccount api={api} onCreated={refresh} />
    </main>
  );
}

function AccountTable({
  api,
  accounts,
  onChanged,
}: {
  api: Api;
  accounts: AccountList["accounts"];
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<AccountId | null>(null);
  const action = useAction();
  return (
    <>
      {action.error && (
        <p className="form-error" role="alert">
          {action.error}
        </p>
      )}
      <div className="table-wrap">
        <table className="accounts">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Role</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  {a.username}
                  {a.mustChangePassword && (
                    <span className="badge warming">Must change password</span>
                  )}
                </th>
                <td>{ROLE_LABEL[a.role]}</td>
                <td>{formatEveTime(a.createdAt)}</td>
                <td>
                  {a.role === "robber" && (
                    <div className="row-actions">
                      {confirming === a.id ? (
                        <>
                          <span>Delete {a.username}?</span>
                          <button
                            type="button"
                            className="danger"
                            disabled={action.pending}
                            onClick={() => {
                              action.run(
                                () => api.deleteAccount(a.id),
                                () => {
                                  setConfirming(null);
                                  onChanged();
                                },
                              );
                            }}
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={action.pending}
                            onClick={() => {
                              setConfirming(null);
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete ${a.username}`}
                          onClick={() => {
                            setConfirming(a.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CreateAccount({
  api,
  onCreated,
}: {
  api: Api;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccountRole>("robber");
  const [created, setCreated] = useState<string | null>(null);
  const action = useAction();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setCreated(null);
    action.run(
      () => api.createAccount({ username, password, role }),
      (account) => {
        setCreated(account.username);
        setUsername("");
        setPassword("");
        setRole("robber");
        onCreated();
      },
    );
  };
  return (
    <form className="card create-account" onSubmit={submit}>
      <h3>Create an Account</h3>
      <label className="field">
        Username
        <input
          autoFocus
          required
          autoComplete="off"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
        />
      </label>
      <div className="field">
        <label htmlFor="temporary-password">Temporary password</label>
        <input
          id="temporary-password"
          required
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_RULE.temporaryMinLength}
          maxLength={PASSWORD_RULE.maxLength}
          aria-describedby="temporary-password-hint"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <span id="temporary-password-hint" className="hint">
          At least {PASSWORD_RULE.temporaryMinLength} characters. The new
          Account must change it at first sign-in.
        </span>
      </div>
      <label className="field">
        Role
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value === "admin" ? "admin" : "robber");
          }}
        >
          <option value="robber">Robber</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {action.error && (
        <p className="form-error" role="alert">
          {action.error}
        </p>
      )}
      {created && (
        <p role="status">
          Created {created}. Give them the temporary password.
        </p>
      )}
      <button className="primary" type="submit" disabled={action.pending}>
        {action.pending ? "Creating…" : "Create Account"}
      </button>
    </form>
  );
}
