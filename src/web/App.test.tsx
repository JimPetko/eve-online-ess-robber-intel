import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { regionId } from "../domain/index.ts";
import { fixtureApi, httpApi, type Api } from "./api.ts";
import { App, SURGE_THRESHOLD_KEY } from "./App.tsx";
import type { FixtureSync } from "./fixtures/region-view.ts";
import { REFRESH_MS } from "./hooks.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderApp(sync: FixtureSync = "recent", api: Api = fixtureApi(sync)) {
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByRole("table");
  return user;
}

/** First word of each row header: System names, and Constellation names in Grouped view. */
function rowLabels(): string[] {
  return screen
    .getAllByRole("rowheader")
    .map((h) => h.textContent.replace(/[▾▸]/g, "").trim().split(/\s+/)[0] ?? "");
}

const rowOf = (system: string) => {
  const row = screen.getByText(system).closest("tr");
  if (!row) throw new Error(`no row for ${system}`);
  return row;
};
const surgeIn = (system: string) => within(rowOf(system)).queryByText(/▲/)?.textContent ?? null;

const BY_CEILING = [
  "8QT-H4", "Y-OMTZ", "1DQ1-A", "J5A-IX", "MO-GZ5", "T5ZI-S", "PUIG-F", "QY6-RK", "5BTK-M", "NOL-M9",
];

test("Flat view lists every System richest first", async () => {
  await renderApp();
  expect(rowLabels()).toEqual(BY_CEILING);
});

test("column headers sort, and a second click reverses", async () => {
  const user = await renderApp();
  await user.click(screen.getByRole("button", { name: /^System/ }));
  expect(rowLabels()).toEqual(BY_CEILING.toSorted((a, b) => a.localeCompare(b)));
  await user.click(screen.getByRole("button", { name: /^System/ }));
  expect(rowLabels()).toEqual(BY_CEILING.toSorted((a, b) => b.localeCompare(a)));
  await user.click(screen.getByRole("button", { name: /^Main Bank Ceiling/ }));
  expect(rowLabels()).toEqual(BY_CEILING);
  await user.click(screen.getByRole("button", { name: /^Main Bank Ceiling/ }));
  expect(rowLabels()).toEqual(BY_CEILING.toReversed());
});

test("Grouped view ranks Constellations by summed ceiling, Systems within, and collapses", async () => {
  const user = await renderApp();
  await user.click(screen.getByRole("button", { name: "Grouped" }));
  expect(rowLabels()).toEqual([
    "1P-VL2", "8QT-H4", "Y-OMTZ", "5BTK-M",
    "O-EIMK", "1DQ1-A", "T5ZI-S", "PUIG-F", "NOL-M9",
    "QKQ-BT", "J5A-IX", "MO-GZ5", "QY6-RK",
  ]);
  expect(within(rowOf("O-EIMK")).getByText("666.0M")).toBeTruthy();
  expect(within(rowOf("1P-VL2")).getByText("1 Warming Up")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /O-EIMK/ }));
  expect(rowLabels()).toEqual([
    "1P-VL2", "8QT-H4", "Y-OMTZ", "5BTK-M", "O-EIMK", "QKQ-BT", "J5A-IX", "MO-GZ5", "QY6-RK",
  ]);
});

test("Surges follow the Surge Threshold; drops and Warming Up never highlight", async () => {
  const user = await renderApp();
  expect(surgeIn("8QT-H4")).toBe("▲ +40.0M ");
  expect(surgeIn("1DQ1-A")).toBe("▲ +32.0M ");
  expect(surgeIn("J5A-IX")).toBeNull();
  expect(surgeIn("T5ZI-S")).toBeNull();
  expect(surgeIn("5BTK-M")).toBeNull();

  const threshold = screen.getByRole("spinbutton", { name: /Surge Threshold/ });
  await user.clear(threshold);
  await user.type(threshold, "10");
  expect(surgeIn("J5A-IX")).toBe("▲ +13.0M ");
  expect(surgeIn("T5ZI-S")).toBeNull();

  await user.click(screen.getByRole("checkbox", { name: "Surges only" }));
  expect(rowLabels()).toEqual(["8QT-H4", "1DQ1-A", "J5A-IX", "PUIG-F"]);
});

test("the Surge Threshold is remembered", async () => {
  const user = await renderApp();
  const threshold = screen.getByRole("spinbutton", { name: /Surge Threshold/ });
  expect(threshold).toHaveProperty("value", "20");
  await user.clear(threshold);
  await user.type(threshold, "35");
  expect(localStorage.getItem(SURGE_THRESHOLD_KEY)).toBe("35");
  cleanup();
  await renderApp();
  expect(screen.getByRole("spinbutton", { name: /Surge Threshold/ })).toHaveProperty("value", "35");
});

test("Warming Up and ESS Presence Unconfirmed tags", async () => {
  await renderApp();
  expect(within(rowOf("5BTK-M")).getByText("Warming Up 1/3h")).toBeTruthy();
  expect(within(rowOf("J5A-IX")).getByText("ESS Presence Unconfirmed")).toBeTruthy();
  expect(within(rowOf("MO-GZ5")).queryByText("ESS Presence Unconfirmed")).toBeNull();
});

test("Reserve Bank Estimate shows a band labelled as a floor", async () => {
  await renderApp();
  expect(screen.getByRole("button", { name: /Reserve Bank Estimate \(floor\)/ })).toBeTruthy();
  expect(within(rowOf("8QT-H4")).getByText("≥ 7.38B–29.52B")).toBeTruthy();
});

test("a recent sync shows Recent and no banner", async () => {
  await renderApp("recent");
  expect(screen.getByText("Recent")).toBeTruthy();
  expect(screen.getByText(/Last successful pull 12m ago/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a sync with no success for an hour is Stale and raises a banner", async () => {
  await renderApp("stale");
  expect(screen.getByText("Stale")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/No successful pull for 2h 00m.*Stale/);
});

test("a failed sync raises a banner with the error", async () => {
  await renderApp("failed");
  expect(screen.getByRole("alert").textContent).toMatch(/last sync failed.*ESI 503/);
});

test("no successful sync ever raises a banner", async () => {
  await renderApp("never");
  expect(screen.getByRole("alert").textContent).toMatch(/No sync has succeeded yet/);
});

test("right-click opens Region, Constellation and System on dotlan in a new tab", async () => {
  const user = await renderApp();
  const menuLink = () => screen.getByRole("menuitem");

  fireEvent.contextMenu(screen.getByText("1DQ1-A"));
  expect(menuLink().getAttribute("href")).toBe("https://evemaps.dotlan.net/system/1DQ1-A");
  expect(menuLink().getAttribute("target")).toBe("_blank");

  fireEvent.contextMenu(screen.getByRole("heading", { name: "Delve" }));
  expect(menuLink().getAttribute("href")).toBe("https://evemaps.dotlan.net/map/Delve");

  await user.click(screen.getByRole("button", { name: "Grouped" }));
  fireEvent.contextMenu(screen.getByRole("button", { name: /O-EIMK/ }));
  expect(menuLink().getAttribute("href")).toBe("https://evemaps.dotlan.net/map/Delve/O-EIMK");

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("switching Region loads that Region's view", async () => {
  const user = await renderApp();
  await user.selectOptions(screen.getByRole("combobox", { name: "Region" }), "Period Basis (27)");
  expect(await screen.findByRole("heading", { name: "Period Basis" })).toBeTruthy();
  expect(screen.getByText("No Systems synced for this Region yet.")).toBeTruthy();
});

test("the Region View refreshes every minute", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  const base = fixtureApi();
  const regionView = vi.fn(base.regionView);
  render(<App api={{ ...base, regionView }} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(regionView).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
  expect(regionView).toHaveBeenCalledTimes(2);
});

test("the HTTP client calls the two endpoints", async () => {
  const urls: string[] = [];
  const fakeFetch: typeof fetch = (url) => {
    urls.push(url instanceof Request ? url.url : url.toString());
    return Promise.resolve(Response.json({ regions: [] }));
  };
  const api = httpApi(fakeFetch);
  await api.regions();
  await api.regionView(regionId(10000060));
  expect(urls).toEqual(["/api/regions", "/api/regions/10000060"]);
});
