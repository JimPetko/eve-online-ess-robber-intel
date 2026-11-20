# ESS Robber Intel

ESS Robber Intel ranks the sov-held nullsec Systems in an EVE Online Region by how much ISK their Encounter Surveillance System (ESS) could hold. It is for Robbers: players who break into an ESS to steal its banked ISK.

Public ESI reports no bank balances, only an hourly NPC kill count per System. The Main Bank Ceiling is therefore an upper bound, modelled from `npc_kills` and the Bounty Assumptions. The true balance lies between zero and the ceiling. Robberies are invisible, so a robbed bank keeps its ceiling for up to one Payout Cycle.

- [GLOSSARY.md](GLOSSARY.md) defines every term in this README.
- [docs/DESIGN.md](docs/DESIGN.md) is the v1 design.
- [docs/adr/](docs/adr/) holds the decision records.
- [docs/research/](docs/research/) holds the Reserve Bank and bounty calibration research.

## Set up and run

You need Node 24 or later. Install the dependencies:

```sh
npm ci
```

To develop, run the API and the Vite dev server together:

```sh
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the API on port 3000, and both reload on change.

To run in production mode, build and start one server for the UI and the API:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3000. The server serves the built UI from `dist/web`, so run `npm run build` again and restart after any change.

The server reads these environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. `npm run dev` also points the Vite proxy at it. |
| `HOST` | `127.0.0.1` | Address to bind. |
| `DB_PATH` | `data/ess-robber-intel.sqlite` | SQLite file. The server creates its folder. |

## What to expect on first run

1. The server runs a full universe sync: every Region, Constellation and System, plus the sovereignty map. Expect a minute or two.
2. The first kills poll follows, and the Region view fills in.
3. Every System is Warming Up until three hourly pulls are stored, about two to three hours after the first start.
4. A previous ceiling appears after the second pull. Surges need a previous ceiling that is past Warming Up too, so they appear from the fourth pull.

A kills poll runs when ESI's cached hour expires, not on the clock hour. The universe sync repeats daily. History is kept for 30 days and survives a restart. A gap in pulls puts Systems back in Warming Up until three consecutive hours are stored again.

## API

All responses are JSON. The types are in `src/domain/region-view.ts`.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/regions` | Regions with at least one sov-held nullsec System, by name. |
| `GET /api/regions/:id` | One Region: sync status, Constellations, and per System the Main Bank Ceiling, previous ceiling and Robber Take. An id that is not a whole number returns 400. An unknown Region, or one without sov-held nullsec, returns 404. |

## Bounty Assumptions

`DEFAULT_BOUNTY_ASSUMPTIONS` in `src/domain/bounty-assumptions.ts` holds every figure that turns kill counts into ISK: the Payout Cycle length, the Main Bank share, the Robber Take share, and ISK per NPC kill by Region. Each carries its source and confidence in a comment. Sources and method: [docs/research/bounty-calibration.md](docs/research/bounty-calibration.md).

ISK per NPC kill comes from `src/domain/isk-per-npc-kill.generated.ts`: CCP's Monthly Economic Report bounties per Region ÷ that Region's ESI NPC kills as archived by EVE Ref. A Region with fewer than 100,000 kills that month, or under 90% of them in sov nullsec, uses the pooled fallback. Recalibrate each month once CCP publishes the MER:

```sh
node scripts/calibrate-bounties.mjs 2026-11
```

It downloads about 70 MB, rewrites the generated file, and prints the table. Commit the file.

To run this every month without a human, see [ops/calibration/README.md](ops/calibration/README.md).

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | API with `node --watch` plus the Vite dev server. |
| `npm run build` | Compiles the server to `dist/server` and the UI to `dist/web`. |
| `npm start` | Runs the built server. |
| `node scripts/calibrate-bounties.mjs <YYYY-MM>` | Recalibrates ISK per NPC kill from that month's MER and EVE Ref kills. See Bounty Assumptions. |
| `npm run sync:universe` | Runs one universe sync against `DB_PATH`, prints a JSON summary, and exits non-zero on failure. It takes no flags. |
| `npm test` | Runs the Vitest suite. |
| `npm run typecheck` | Type-checks every project. |
| `npm run lint` | Runs ESLint. |

## Contributing

A PR that changes code under `src/` must also change a `*.test.ts(x)`, or CI's `tests-required` job fails. Label the PR `no-tests-needed` only when it changes no behaviour. Merge only with `node scripts/merge-pr.mjs <pr-number>`. See `CLAUDE.md`.

## Data source etiquette

The scheduled poller is the only code that calls ESI. Browsers call only this API.

- Every request sends `User-Agent: ess-robber-intel/<version> (<contact>)`. If you run your own copy, put your own contact in `CONTACT` in `src/server/config.ts`.
- The kills poll waits for the `Expires` time of the previous response, plus up to 30 seconds, before it asks again.
- The client sends at most 20 requests at once. It pauses all requests when `X-ESI-Error-Limit-Remain` drops to 20 or below, and on a 420 or 429 it waits for `Retry-After`. It retries 5xx errors with backoff.

## Known limitations

- Robberies and payouts are invisible. A ceiling can stay high for up to one Payout Cycle after the bank was emptied.
- ISK per NPC kill and the Main Bank share (40%) are Region-level monthly averages from CCP's MER. A single System farmed at the DBS floor, or sitting at its maximum, can differ. The 50% in patch 20.02 (2022-02-08) applied only at the DBS floor, which no longer exists. See [docs/research/bounty-calibration.md](docs/research/bounty-calibration.md).
- The tool shows no Reserve Bank figure. A reserve key pays out on a fixed curve whatever the balance, so a number would not change where a Robber goes. See [docs/research/reserve-bank.md](docs/research/reserve-bank.md#decision-2026-11-19-cut-the-reserve-bank-estimate).
- Only sov-held nullsec has an ESS, so NPC nullsec, unclaimed nullsec, wormhole space, Pochven and the Jove Regions are excluded. Scope follows the daily sovereignty refresh, so a System that loses sovereignty can show for up to a day after it has no ESS.
