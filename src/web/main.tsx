import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fixtureApi, httpApi } from "./api.ts";
import { AuthGate } from "./AuthGate.tsx";
import { FIXTURE_SYNCS, type FixtureSync } from "./fixtures/region-view.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

// `?fixture` (or `?fixture=stale|failed|never`) serves fixture data instead of the API.
const fixture = new URLSearchParams(location.search).get("fixture");
const api =
  fixture === null
    ? httpApi()
    : fixtureApi(FIXTURE_SYNCS.find((s): s is FixtureSync => s === fixture) ?? "recent");

createRoot(root).render(
  <StrictMode>
    <AuthGate api={api} />
  </StrictMode>,
);
