import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { accountId } from "../domain/index.ts";
import { ApiError, fixtureApi, httpApi, type Api } from "./api.ts";
import { AuthGate } from "./AuthGate.tsx";
import {
  FIXTURE_SEED,
  fixtureAccounts,
  type FixtureAccount,
} from "./fixtures/accounts.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

const ROBBER: FixtureAccount = {
  username: "Sticky Fingers",
  password: "robber-password-1",
  role: "robber",
  mustChangePassword: false,
};

function renderGate(api: Api = fixtureApi()) {
  const user = userEvent.setup();
  render(<AuthGate api={api} />);
  return user;
}

const signedOutApi = (seed = FIXTURE_SEED) =>
  fixtureApi("recent", undefined, fixtureAccounts(seed, null));

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  password: string,
) {
  await user.type(await screen.findByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

async function openAccounts(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Accounts" }));
  await screen.findByRole("table");
}

const accountRow = (username: string) => {
  const row = screen
    .getByRole("rowheader", { name: new RegExp(`^${username}`) })
    .closest("tr");
  if (!row) throw new Error(`no row for ${username}`);
  return row;
};

test("a wrong password shows the server's message and stays on sign-in", async () => {
  const user = renderGate(signedOutApi());
  await signIn(user, "admin", "not-the-password");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Wrong username or password.",
  );
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Region" })).toBeNull();
});

test("the first sign-in forces a password change, then lands on the intel", async () => {
  const user = renderGate(signedOutApi());
  await signIn(user, "Ratbag", "temporary1");

  expect(
    await screen.findByRole("heading", { name: "Choose a new password" }),
  ).toBeTruthy();
  expect(screen.getByText(/first sign-in for/).textContent).toContain("Ratbag");
  expect(screen.getByText("At least 12 characters, without your username.")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Region" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Accounts" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

  await user.type(screen.getByLabelText("Current password"), "temporary1");
  await user.type(
    screen.getByLabelText("New password"),
    "a much longer secret",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a much longer secret",
  );
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByRole("combobox", { name: "Region" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Delve" })).toBeTruthy();
  expect(screen.getByText("Ratbag")).toBeTruthy();
});

test("a wrong current password shows the server's message", async () => {
  const user = renderGate(signedOutApi());
  await signIn(user, "Ratbag", "temporary1");
  await user.type(
    await screen.findByLabelText("Current password"),
    "wrong guess",
  );
  await user.type(
    screen.getByLabelText("New password"),
    "a much longer secret",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a much longer secret",
  );
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Your current password is wrong.",
  );
});

test("mismatched new passwords are caught before anything is sent", async () => {
  const base = signedOutApi();
  const changePassword = vi.fn(base.changePassword);
  const user = renderGate({ ...base, changePassword });
  await signIn(user, "Ratbag", "temporary1");
  await user.type(
    await screen.findByLabelText("Current password"),
    "temporary1",
  );
  await user.type(
    screen.getByLabelText("New password"),
    "a much longer secret",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a much longer secrex",
  );
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(screen.getByRole("alert").textContent).toBe(
    "The new passwords do not match.",
  );
  expect(changePassword).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Choose a new password" }),
  ).toBeTruthy();
});

test("a Robber sees the intel but no Accounts toggle", async () => {
  renderGate(
    fixtureApi(
      "recent",
      undefined,
      fixtureAccounts([...FIXTURE_SEED, ROBBER], ROBBER.username),
    ),
  );
  expect(await screen.findByRole("heading", { name: "Delve" })).toBeTruthy();
  expect(screen.getByText("Sticky Fingers")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accounts" })).toBeNull();
});

test("an Admin creates an Account and it appears, flagged to change its password", async () => {
  const user = renderGate();
  await openAccounts(user);
  expect(screen.getByRole("combobox", { name: "Role" })).toHaveProperty(
    "value",
    "robber",
  );

  await user.type(screen.getByLabelText("Username"), "New Guy");
  await user.type(screen.getByLabelText("Temporary password"), "letmein123");
  await user.click(screen.getByRole("button", { name: "Create Account" }));

  expect((await screen.findByRole("status")).textContent).toMatch(
    /Created New Guy/,
  );
  const row = await screen.findByRole("rowheader", { name: /^New Guy/ });
  expect(within(row).getByText("Must change password")).toBeTruthy();
  expect(within(accountRow("New Guy")).getByText("Robber")).toBeTruthy();
});

test("creating a taken username shows the server's error inline", async () => {
  const user = renderGate();
  await openAccounts(user);
  await user.type(screen.getByLabelText("Username"), "ratbag");
  await user.type(screen.getByLabelText("Temporary password"), "letmein123");
  await user.click(screen.getByRole("button", { name: "Create Account" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "An Account named ratbag already exists.",
  );
});

test("Admin rows have no Delete; a Robber is deleted only after confirming", async () => {
  const user = renderGate();
  await openAccounts(user);
  expect(
    within(accountRow("admin")).queryByRole("button", { name: /Delete/ }),
  ).toBeNull();
  expect(within(accountRow("admin")).getByText("Admin")).toBeTruthy();
  const [, ...rows] = within(screen.getByRole("table")).getAllByRole("row");
  const width = screen.getAllByRole("columnheader").length;
  for (const row of rows)
    expect(row.querySelectorAll("th, td").length).toBe(width);

  await user.click(
    within(accountRow("Ratbag")).getByRole("button", { name: "Delete Ratbag" }),
  );
  expect(within(accountRow("Ratbag")).getByText("Delete Ratbag?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(accountRow("Ratbag")).toBeTruthy();

  await user.click(
    within(accountRow("Ratbag")).getByRole("button", { name: "Delete Ratbag" }),
  );
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  await vi.waitFor(() => {
    expect(screen.queryByRole("rowheader", { name: /^Ratbag/ })).toBeNull();
  });
  expect(accountRow("admin")).toBeTruthy();
});

test("a 401 from the Regions call returns to sign-in and says why", async () => {
  const base = fixtureApi();
  renderGate({
    ...base,
    regions: () =>
      Promise.reject(
        new ApiError(401, "signInRequired", "Sign in to continue."),
      ),
  });
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  expect(
    screen.getByText("Your session has ended. Sign in again."),
  ).toBeTruthy();
});

test("Sign out returns to sign-in, and signing back in restores the intel", async () => {
  const user = renderGate();
  await screen.findByRole("heading", { name: "Delve" });
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();

  await signIn(user, "admin", "fixture-admin-password");
  expect(await screen.findByRole("heading", { name: "Delve" })).toBeTruthy();
});

test("a server that cannot be reached says so and offers a retry", async () => {
  const base = fixtureApi();
  let calls = 0;
  const user = renderGate({
    ...base,
    session: () =>
      ++calls === 1
        ? Promise.reject(new Error("Failed to fetch"))
        : base.session(),
  });
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not reach the server: Failed to fetch",
  );
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Delve" })).toBeTruthy();
});

test("the HTTP client sends JSON and turns an error answer into an ApiError", async () => {
  const sent: {
    url: string;
    method: string;
    contentType: string | null;
    body: unknown;
  }[] = [];
  const fakeFetch: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method ?? "GET",
      contentType: headers.get("content-type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (url === "/api/session" && init?.method === "POST")
      return Promise.resolve(
        Response.json(
          {
            error: "tooManyAttempts",
            message: "Too many attempts. Wait a minute.",
          },
          { status: 429 },
        ),
      );
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const api = httpApi(fakeFetch);

  const failure = await api
    .signIn({ username: "admin", password: "x" })
    .catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({
    status: 429,
    code: "tooManyAttempts",
    message: "Too many attempts. Wait a minute.",
  });
  await expect(api.deleteAccount(accountId(7))).resolves.toBeUndefined();
  await api.signOut();

  expect(sent).toEqual([
    {
      url: "/api/session",
      method: "POST",
      contentType: "application/json",
      body: { username: "admin", password: "x" },
    },
    { url: "/api/accounts/7", method: "DELETE", contentType: null, body: null },
    { url: "/api/session", method: "DELETE", contentType: null, body: null },
  ]);
});
