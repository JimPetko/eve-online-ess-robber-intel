// Creates or updates the Plane work item for one month's calibration.
// Idempotent: the item is found again by external_source + external_id.
export const EXTERNAL_SOURCE = "ess-robber-intel-calibration";

export async function syncWorkItem({ baseUrl, apiKey, workspace, project, month, prUrl, done, dryRun = false, fetch = globalThis.fetch }) {
  if (apiKey === "" || workspace === "") throw new Error("PLANE_API_KEY and PLANE_WORKSPACE_SLUG are required");
  const root = `${baseUrl.replace(/\/$/, "")}/api/v1/workspaces/${workspace}`;

  async function api(method, path, body) {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Plane ${method} ${path}: ${String(res.status)}`);
    return res.json();
  }

  /** Every result of a list endpoint, following Plane's cursor pagination. */
  async function all(path) {
    const results = [];
    let cursor = null;
    do {
      const page = await api("GET", `${path}?per_page=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
      if (Array.isArray(page)) return page;
      results.push(...page.results);
      cursor = page.next_page_results ? page.next_cursor : null;
    } while (cursor !== null);
    return results;
  }

  const ess = (await all("/projects/")).find((p) => p.identifier === project);
  if (ess === undefined) throw new Error(`Plane has no project ${project} in ${workspace}`);
  const base = `/projects/${ess.id}`;

  const states = await all(`${base}/states/`);
  const [stateName, group] = done ? ["Done", "completed"] : ["In Progress", "started"];
  const state = states.find((s) => s.name === stateName) ?? states.find((s) => s.group === group);
  if (state === undefined) throw new Error(`Plane project ${project} has no ${stateName} state`);
  const research = (await all(`${base}/labels/`)).find((l) => l.name === "research");

  const existing = (await all(`${base}/work-items/`)).find(
    (i) => i.external_source === EXTERNAL_SOURCE && i.external_id === month,
  );
  const labels = new Set(existing?.labels ?? []);
  if (research !== undefined) labels.add(research.id);
  const item = {
    name: `Recalibrate ISK per NPC kill for ${month}`,
    description_html: `<p>Monthly recalibration of ISK per NPC kill from CCP's Monthly Economic Report for ${month}.</p><p>PR: <a href="${prUrl}">${prUrl}</a></p>`,
    state: state.id,
    labels: [...labels],
    external_source: EXTERNAL_SOURCE,
    external_id: month,
  };
  const action = existing === undefined ? "created" : "updated";
  if (dryRun) return { action: `would be ${action} as ${stateName}`, id: existing?.id };
  const saved =
    existing === undefined
      ? await api("POST", `${base}/work-items/`, item)
      : await api("PATCH", `${base}/work-items/${existing.id}/`, item);
  return { action: `${action} as ${stateName}`, id: saved.id };
}
