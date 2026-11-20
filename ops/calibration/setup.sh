#!/usr/bin/env bash
# Sets up, or updates, the calibration container on this host.
# Usage: ./setup.sh [--run-now]
#   --run-now  after starting, do one dry run right away without asking.
# GH_TOKEN and PLANE_API_KEY come from the environment, then an existing .env, then a prompt.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

RUN_NOW=0
case "${1:-}" in
  "") ;;
  --run-now) RUN_NOW=1 ;;
  *) echo "usage: ./setup.sh [--run-now]" >&2; exit 2 ;;
esac

say() { printf '==> %s\n' "$*"; }
fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is not installed: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is missing: https://docs.docker.com/compose/install/linux/"
docker info >/dev/null 2>&1 || fail "cannot reach the docker daemon (is it running, and is $USER in the docker group?)"

# The value of KEY in an existing .env, or empty.
current() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }

# Asks for a secret without echoing it; Enter keeps the current value.
ask_secret() {
  local name="$1" prompt="$2" value="${!1:-}"
  [ -n "$value" ] || value="$(current "$name")"
  if [ -t 0 ]; then
    local hint="" answer=""
    [ -n "$value" ] && hint=" [Enter keeps the current one]"
    read -r -s -p "$prompt$hint: " answer
    echo >&2
    [ -n "$answer" ] && value="$answer"
  fi
  printf '%s' "$value"
}

GH_TOKEN="$(ask_secret GH_TOKEN "GitHub fine-grained token (see .env.example for its permissions)")"
[ -n "$GH_TOKEN" ] || fail "a GH_TOKEN is required"
PLANE_API_KEY="$(ask_secret PLANE_API_KEY "Plane API key (empty to skip Plane)")"

value() { local v="${!1:-}"; [ -n "$v" ] || v="$(current "$1")"; [ -n "$v" ] || v="$2"; printf '%s' "$v"; }
PLANE_WORKSPACE_SLUG="$(value PLANE_WORKSPACE_SLUG "")"
if [ -n "$PLANE_API_KEY" ] && [ -z "$PLANE_WORKSPACE_SLUG" ] && [ -t 0 ]; then
  read -r -p "Plane workspace slug: " PLANE_WORKSPACE_SLUG
fi

say "writing .env (mode 600)"
umask 077
cat >.env.tmp <<EOF
GH_TOKEN=$GH_TOKEN
GIT_AUTHOR_NAME=$(value GIT_AUTHOR_NAME "ESS calibration bot")
GIT_AUTHOR_EMAIL=$(value GIT_AUTHOR_EMAIL "calibration@localhost")
PLANE_API_KEY=$PLANE_API_KEY
PLANE_BASE_URL=$(value PLANE_BASE_URL "http://192.168.0.187:8090")
PLANE_WORKSPACE_SLUG=$PLANE_WORKSPACE_SLUG
PLANE_PROJECT_IDENTIFIER=$(value PLANE_PROJECT_IDENTIFIER "ESS")
EOF
schedule="$(value CALIBRATION_CRON "")"
[ -n "$schedule" ] && printf 'CALIBRATION_CRON=%s\n' "$schedule" >>.env.tmp
mv .env.tmp .env
chmod 600 .env

say "building the image"
docker compose build --pull
say "starting the schedule"
docker compose up -d --remove-orphans
docker compose ps

if [ "$RUN_NOW" = 0 ] && [ -t 0 ]; then
  read -r -p "Do a dry run now? It downloads about 70 MB when a month needs calibrating. [y/N] " answer
  case "$answer" in [yY]*) RUN_NOW=1 ;; esac
fi
if [ "$RUN_NOW" = 1 ]; then
  say "dry run"
  docker compose run --rm calibration run-calibration.sh --dry-run
fi
say "done. Logs: docker compose logs -f calibration"
