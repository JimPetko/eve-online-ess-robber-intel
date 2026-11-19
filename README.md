# ESS Robber Intel

ESS Robber Intel ranks the sov-held nullsec Systems in an EVE Online Region by how much ISK their Encounter Surveillance System (ESS) could hold. It is for Robbers: players who break into an ESS to steal its banked ISK.

Public ESI reports no bank balances, only an hourly NPC kill count per System. The Main Bank Ceiling is therefore an upper bound, modelled from `npc_kills` and the Bounty Assumptions. The true balance lies between zero and the ceiling. The Reserve Bank Estimate is a floor band on what the Reserve Bank gained during the history the tool holds, and Robberies are invisible, so a robbed bank keeps its ceiling for up to one Payout Cycle.

- [GLOSSARY.md](GLOSSARY.md) defines every term in this README.
- [docs/DESIGN.md](docs/DESIGN.md) is the v1 design.
- [docs/adr/](docs/adr/) holds the decision records.
- [docs/research/](docs/research/) holds the Reserve Bank research.

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
| `GET /api/regions/:id` | One Region: sync status, Constellations, and per System the Main Bank Ceiling, previous ceiling, Robber Take and Reserve Bank Estimate. An id that is not a whole number returns 400. An unknown Region, or one without sov-held nullsec, returns 404. |

## Bounty Assumptions

`DEFAULT_BOUNTY_ASSUMPTIONS` in `src/domain/bounty-assumptions.ts` holds every figure that turns kill counts into ISK: the Payout Cycle length, the Main Bank share, the Robber Take share, the reserve fill share, and ISK per NPC kill by Security Band. They are guesses, each with its confidence in a comment. Tune them there and rebuild.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | API with `node --watch` plus the Vite dev server. |
| `npm run build` | Compiles the server to `dist/server` and the UI to `dist/web`. |
| `npm start` | Runs the built server. |
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
- The Main Bank share is 40%, an unverified player estimate. A 2022 patch note says 50% of each bounty enters the ESS, which conflicts with it. See [docs/research/reserve-bank.md](docs/research/reserve-bank.md).
- The Reserve Bank Estimate is provisional. It is cut if it misleads more than it helps.
- ISK per NPC kill is a guess per Security Band, not calibrated.
- Only sov-held nullsec has an ESS, so NPC nullsec, unclaimed nullsec, wormhole space, Pochven and the Jove Regions are excluded. Scope follows the daily sovereignty refresh, so a System that loses sovereignty can show for up to a day after it has no ESS.
