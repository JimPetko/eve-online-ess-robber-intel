import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_TITLE } from "../domain/app.ts";
import type { AccountView, SessionView } from "../domain/index.ts";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { ApiError, errorMessage, type Api } from "./api.ts";
import { App } from "./App.tsx";
import { ChangePassword, SignIn } from "./AuthForms.tsx";

type GateState =
  | { readonly status: "loading" }
  | { readonly status: "unreachable"; readonly message: string }
  | { readonly status: "expired" }
  | SessionView;

function watchSession(api: Api, onSignedOut: () => void): Api {
  const watch =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      call(...args).catch((e: unknown) => {
        if (e instanceof ApiError && e.code === "signInRequired") onSignedOut();
        throw e;
      });
  return {
    regions: watch(api.regions),
    regionView: watch(api.regionView),
    session: watch(api.session),
    signIn: watch(api.signIn),
    signOut: watch(api.signOut),
    changePassword: watch(api.changePassword),
    accounts: watch(api.accounts),
    createAccount: watch(api.createAccount),
    deleteAccount: watch(api.deleteAccount),
  };
}

export function AuthGate({ api }: { api: Api }) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const watched = useMemo(
    () =>
      watchSession(api, () => {
        setState({ status: "expired" });
      }),
    [api],
  );
  const checkSession = useCallback(() => {
    api.session().then(setState, (e: unknown) => {
      setState({ status: "unreachable", message: errorMessage(e) });
    });
  }, [api]);
  useEffect(checkSession, [checkSession]);

  const signOut = () => {
    api
      .signOut()
      .catch(() => undefined)
      .finally(() => {
        setState({ status: "signedOut" });
      });
  };

  switch (state.status) {
    case "loading":
      return (
        <div className="app">
          <p className="muted">Loading…</p>
        </div>
      );
    case "unreachable":
      return (
        <div className="app">
          <h1>{APP_TITLE}</h1>
          <div className="banner" role="alert">
            Could not reach the server: {state.message}
          </div>
          <p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                checkSession();
              }}
            >
              Try again
            </button>
          </p>
        </div>
      );
    case "signedOut":
    case "expired":
      return (
        <SignIn
          api={api}
          notice={state.status === "expired" ? "Your session has ended. Sign in again." : null}
          onSession={setState}
        />
      );
    case "mustChangePassword":
      return <ChangePassword api={watched} account={state.account} onSession={setState} onSignOut={signOut} />;
    case "active":
      return <SignedIn api={watched} account={state.account} onSignOut={signOut} />;
  }
}

function SignedIn({ api, account, onSignOut }: { api: Api; account: AccountView; onSignOut: () => void }) {
  const [view, setView] = useState<"intel" | "accounts">("intel");
  return (
    <>
      <div className="session-bar">
        <span className="muted">
          Signed in as <strong>{account.username}</strong>
          {account.role === "admin" && " (Admin)"}
        </span>
        {account.role === "admin" && (
          <div className="segmented" role="group" aria-label="Section">
            <button type="button" aria-pressed={view === "intel"} onClick={() => { setView("intel"); }}>
              Intel
            </button>
            <button type="button" aria-pressed={view === "accounts"} onClick={() => { setView("accounts"); }}>
              Accounts
            </button>
          </div>
        )}
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      {view === "accounts" ? (
        <div className="app">
          <h1>{APP_TITLE}</h1>
          <AccountsPanel api={api} />
        </div>
      ) : (
        <App api={api} />
      )}
    </>
  );
}
