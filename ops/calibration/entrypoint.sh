#!/usr/bin/env bash
# With no arguments, runs the schedule. With arguments, runs them instead,
# so `docker compose run --rm calibration run-calibration.sh --dry-run` works.
set -euo pipefail

if [ $# -gt 0 ]; then exec "$@"; fi

crontab=/opt/calibration/crontab
if [ -n "${CALIBRATION_CRON:-}" ]; then
  crontab="$(mktemp)"
  printf '%s run-calibration.sh\n' "$CALIBRATION_CRON" >"$crontab"
fi
echo "schedule (UTC): $(grep -v '^#' "$crontab")"
exec supercronic -passthrough-logs "$crontab"
