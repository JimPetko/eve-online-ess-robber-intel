# ESS Robber Intel: v1 design

Goal: show a Robber, for a chosen Region, which nullsec Systems could hold the most ISK in their ESS right now. Vocabulary is defined in [GLOSSARY.md](../GLOSSARY.md); the core modelling decision is [ADR 0001](adr/0001-main-bank-ceiling-from-npc-kills.md).

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
| Sovereignty (sov vs NPC null) | `/sovereignty/map` | daily |

- A System absent from a successful `system_kills` response had 0 NPC kills. Record the 0.
- Snapshots are stamped with ESI's `Last-Modified`, not our wall clock.
- Retain raw hourly snapshots for 30 days.
- User-Agent: `ess-robber-intel/<version> (petko.james@gmail.com)`, from config.
- Respect ESI's cache headers and error-limit headers.
- Third-party sources (zKillboard etc.) are out of scope but the source layer stays pluggable.

## Scope of Systems

All Systems with true security ≤ 0.0. NPC-nullsec Systems carry the ESS Presence Unconfirmed tag. Wormhole space and Pochven are excluded.

## Model

All figures below are Bounty Assumptions in one config file.

- **Payout Cycle**: 2h45m.
- **Main Bank Ceiling** = (kills in the latest 2 hourly snapshots + 0.75 × kills in the 3rd) × ISK-per-kill for the System's Security Band × Main Bank share (0.40). The 0.75 derives from the cycle length.
- **Robber Take** = Main Bank Ceiling × 0.80.
- **Reserve Bank Estimate**: provisional. Model pending [research](research/reserve-bank.md). Cut it if it does not work well in practice.
- A System is **Warming Up** until its history covers a full Payout Cycle.

## UI

- Region picker.
- Two views, toggled:
  - **Flat** (default): every System in the Region ranked richest first.
  - **Grouped**: Constellations, each showing the sum of its Systems' ceilings, sorted by that sum; Systems sorted within.
- Sortable columns: Main Bank Ceiling, Robber Take, Reserve Bank Estimate, name.
- **Surge**: a Robber-adjustable Surge Threshold (default 20M ISK). Systems whose ceiling rose by at least the threshold since the previous pull are highlighted with the ISK delta, and the list can be filtered to Surges only. Drops are never highlighted.
- **Freshness**: "data as of" (ESI Last-Modified) plus time since the last successful pull. Older than 1 hour is Stale. A global banner reports a failed or stopped sync. Warming Up is a separate signal.
- **Dotlan**: right-click any Region, Constellation or System to open it on evemaps.dotlan.net. Verify the URL shape for each level before building.
- The UI states that Robberies and payouts are invisible, so a ceiling may stay high for up to one Payout Cycle after the bank was emptied.

## Deferred (v2+)

- Optional EVE SSO: calibrate Bounty Assumptions from a Ratter's wallet journal; client actions (Show Info, Set Destination).
- zKillboard or crowd-reported Robberies.
- Distance in jumps from the Robber.
