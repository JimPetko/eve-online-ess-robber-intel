# ESS Robber Intel: v1 design

Status: implemented in v1. [What shipped differently](#what-shipped-differently) lists the deviations from this design.

Goal: show a Robber, for a chosen Region, which sov-held nullsec Systems could hold the most ISK in their ESS right now. Vocabulary is defined in [GLOSSARY.md](../GLOSSARY.md); the core modelling decision is [ADR 0001](adr/0001-main-bank-ceiling-from-npc-kills.md).

## Shape

- One repo, TypeScript throughout. Node backend (Fastify), React + Vite frontend.
- Runs on localhost for v1; built so it can later become a hosted dashboard with no redesign.
- A single scheduled poller is the only thing that calls ESI. It writes to SQLite. Browsers talk only to our API.

## Data sources (public ESI only, no SSO in v1)

| Data | Endpoint | Refresh |
|---|---|---|
| NPC kills per System, last hour | `/universe/system_kills` | hourly |
| Region → Constellation → System hierarchy | `/universe/regions`, `/universe/constellations/{id}`, `/universe/systems/{id}` | daily |
| Security status | `/universe/systems/{id}` (`security_status`) | daily |
| Sovereignty (sov-held, NPC or unclaimed) | `/sovereignty/map` | daily |

- A System absent from a successful `system_kills` response had 0 NPC kills. Record the 0.
- Snapshots are stamped with ESI's `Last-Modified`, not our wall clock.
- Retain raw hourly snapshots for 30 days.
- User-Agent: `ess-robber-intel/<version> (petko.james@gmail.com)`, from config.
- Respect ESI's cache headers and error-limit headers.
- Third-party sources (zKillboard etc.) are out of scope but the source layer stays pluggable.

## Scope of Systems

Sov-held Systems with true security ≤ 0.0, because only sov-held nullsec has an ESS. NPC nullsec (faction-held) and unclaimed nullsec are excluded, as are wormhole space and Pochven. A Region with no sov-held System is not offered.

Sovereignty changes over time. Each daily sovereignty refresh decides scope: a System that loses sovereignty becomes unclaimed and drops out, and one that gains it comes in. Its stored kill history is kept, so a System retaken within the 30-day retention comes back with that history (a gap puts it back in Warming Up). A System stored before its first successful sovereignty refresh is out of scope, because the tool claims an ESS only where the sovereignty map shows one. A failed refresh keeps the previous map.

## Model

All figures below are Bounty Assumptions in one config file.

- **Payout Cycle**: 2h45m.
- **Main Bank Ceiling** = (kills in the latest 2 hourly snapshots + 0.75 × kills in the 3rd) × ISK-per-kill for the System's Region × Main Bank share (0.40, measured against the same MER `npc_bounties`). ISK-per-kill is calibrated monthly from CCP's Monthly Economic Report, with a pooled fallback ([research](research/bounty-calibration.md)). The 0.75 derives from the cycle length.
- **Robber Take** = Main Bank Ceiling × 0.80.
- A System is **Warming Up** until its history covers a full Payout Cycle.

## UI

- Region picker.
- Two views, toggled:
  - **Flat** (default): every System in the Region ranked richest first.
  - **Grouped**: Constellations, each showing the sum of its Systems' ceilings, sorted by that sum; Systems sorted within.
- Sortable columns: Main Bank Ceiling, Robber Take, name.
- **Surge**: a Robber-adjustable Surge Threshold (default 20M ISK). Systems whose ceiling rose by at least the threshold since the previous pull are highlighted with the ISK delta, and the list can be filtered to Surges only. Drops are never highlighted.
- **Freshness**: "data as of" (ESI Last-Modified) plus time since the last successful pull. Older than 1 hour is Stale. A global banner reports a failed or stopped sync. Warming Up is a separate signal.
- **Dotlan**: right-click any Region, Constellation or System to open it on evemaps.dotlan.net. Verify the URL shape for each level before building.
- The UI states that Robberies and payouts are invisible, so a ceiling may stay high for up to one Payout Cycle after the bank was emptied.

## What shipped differently

- Jove Regions (10000004, 10000017 and 10000019) are excluded with wormhole space and Pochven, because they are unreachable. See `isInScopeRegion` in `src/server/sync/universe.ts`.
- Constellation totals are computed in the browser with `constellationCeiling`, not sent by the API, so a total cannot disagree with the Systems it sums.
- Scope is one rule, the `nullsec_systems` view in `src/server/store/db.ts` (true security ≤ 0.0 and `sov_kind = 'sov'`). Region counts, the Region view and the kills poll all read it. NPC and unclaimed Systems stay stored but are never polled, computed or shown.
- The API contract is the set of types in `src/domain/region-view.ts`, shared by the server and the UI.
- The provisional Reserve Bank Estimate shipped in v1 and was cut on 2026-11-19. A reserve key pays out on a fixed curve whatever the balance, and balances dwarf what a key drains, so the figure changed no decision. See [research](research/reserve-bank.md#decision-2026-11-19-cut-the-reserve-bank-estimate).

## Deferred (v2+)

- Optional EVE SSO: calibrate Bounty Assumptions from a Ratter's wallet journal; client actions (Show Info, Set Destination).
- zKillboard or crowd-reported Robberies.
- Distance in jumps from the Robber.
