# Unattended calibration

A Docker container that recalibrates ISK per NPC kill each month and lands it on `main` without a human.

## What it does

The container runs `run-calibration.sh` daily at 15:00 UTC on days 5 to 28 of each month. Each run works on the previous calendar month (UTC):

1. It exits early if a `calibration/<month>` PR is already merged, or if `src/domain/isk-per-npc-kill.generated.ts` on `main` already has that month.
2. It updates a cached checkout of `main`, runs `npm ci`, and runs `node scripts/calibrate-bounties.mjs <month>`. If CCP has not published that month's MER yet (a 404 on the MER zip), it exits 0, and the next day's run tries again.
3. It pushes `calibration/<month>` and opens a PR labelled `no-tests-needed`. It waits up to 20 minutes for the checks on the PR head, then merges with `node scripts/merge-pr.mjs`. If the checks are still running after 20 minutes, the next run picks the open PR back up, waits again and merges it. If a check fails, it leaves the PR open and exits non-zero, and every later run fails the same way until a human fixes, merges or closes the PR. Closing the PR makes the next run try again from scratch.
4. If `PLANE_API_KEY` is set, it creates or updates the work item `Recalibrate ISK per NPC kill for <month>` in Plane project `ESS`. The item is Done after a merge and In Progress while the PR is open.

Any other failure exits non-zero with a `FAILED:` log line.

## Setup

On the home server, with Docker and the compose plugin installed:

```sh
git clone https://github.com/JimPetko/eve-online-ess-robber-intel.git && cd eve-online-ess-robber-intel/ops/calibration
./setup.sh
docker compose logs -f calibration
```

You can copy this folder to the server instead of cloning the whole repo. `setup.sh` asks for the GitHub token and the Plane API key without echoing them. It can also read them from `GH_TOKEN` and `PLANE_API_KEY` in the environment. It writes `.env` with mode 600, builds the image, starts the container, and offers a dry run. Run it again to rebuild the image after an update. Pressing Enter at a prompt keeps the current value. `./setup.sh --run-now` does the dry run without asking.

The token must be a fine-grained personal access token. `.env.example` lists the permissions it needs.

## Run it by hand

```sh
docker compose run --rm calibration run-calibration.sh --dry-run   # everything except push, PR, merge and Plane writes
docker compose run --rm calibration run-calibration.sh             # a real run
docker compose run --rm calibration run-calibration.sh --month 2026-11
```

## Logs

```sh
docker compose logs -f calibration
```

Each line starts with a UTC timestamp. Docker keeps the last 30 MB.

## Change the schedule

Set `CALIBRATION_CRON` in `.env` to a five-field cron expression in UTC, for example `CALIBRATION_CRON=0 9 * * *`. Then run `docker compose up -d` to apply it.

## Stop it

```sh
docker compose down        # stop and remove the container; the cache volume stays
docker compose down -v     # also delete the cached checkout and npm cache
```
