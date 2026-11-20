#!/usr/bin/env bash
# Deploys the current checkout to a Docker host over SSH and (re)starts the server there.
# The host needs Docker with Compose, nothing else: no Node, no GitHub access.
#
#   ops/home-server/deploy.sh user@host [--dir ~/ess-robber-intel] [--seed-db file.sqlite] [--allow-any-branch]
#
# --seed-db copies a database into the server's volume, only if the volume has none yet.
# Make the copy with SQLite's backup (see README), not by copying a live WAL database.
set -euo pipefail

die() { echo "deploy: $*" >&2; exit 1; }

[ $# -ge 1 ] || die "usage: deploy.sh user@host [--dir DIR] [--seed-db FILE] [--allow-any-branch]"
HOST="$1"; shift
DIR='~/ess-robber-intel'
SEED_DB=""
ALLOW_ANY_BRANCH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --seed-db) SEED_DB="$2"; shift 2 ;;
    --allow-any-branch) ALLOW_ANY_BRANCH=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[ -z "$SEED_DB" ] || [ -f "$SEED_DB" ] || die "no such file: $SEED_DB"

cd "$(git rev-parse --show-toplevel)"
if [ "$ALLOW_ANY_BRANCH" -eq 0 ]; then
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "checkout is not on main (pass --allow-any-branch)"
  [ -z "$(git status --porcelain)" ] || die "checkout has uncommitted changes (pass --allow-any-branch)"
fi
COMMIT="$(git rev-parse --short HEAD)"

# One SSH connection for every step, so a password is asked for at most once.
CONTROL="$(mktemp -u "${TMPDIR:-/tmp}/ess-deploy.XXXXXX")"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$CONTROL" -o ControlPersist=120)
trap '"${SSH[@]}" -O exit "$HOST" 2>/dev/null || true' EXIT

echo "deploy: shipping $COMMIT to $HOST:$DIR"
# Extract into a fresh folder and swap it in, so files deleted from the repo do not linger.
git archive --format=tar HEAD | "${SSH[@]}" "$HOST" "set -e
  rm -rf $DIR.new && mkdir -p $DIR.new && tar -x -C $DIR.new
  echo $COMMIT > $DIR.new/DEPLOYED_COMMIT
  rm -rf $DIR.old; if [ -d $DIR ]; then mv $DIR $DIR.old; fi
  mv $DIR.new $DIR && rm -rf $DIR.old"

COMPOSE="cd $DIR/ops/home-server && docker compose"
"${SSH[@]}" "$HOST" "$COMPOSE build --pull"

if [ -n "$SEED_DB" ]; then
  echo "deploy: seeding the database from $SEED_DB (skipped if the volume already has one)"
  "${SSH[@]}" "$HOST" "$COMPOSE stop server >/dev/null 2>&1 || true"
  "${SSH[@]}" "$HOST" "$COMPOSE run --rm --no-deps -T --entrypoint sh server -c \
    'if [ -e \"\$DB_PATH\" ]; then echo \"volume already has a database; not seeding\"; cat >/dev/null; else cat > \"\$DB_PATH\"; fi'" < "$SEED_DB"
fi

"${SSH[@]}" "$HOST" "$COMPOSE up -d --remove-orphans"

echo "deploy: waiting for the health check"
for _ in $(seq 1 30); do
  if "${SSH[@]}" "$HOST" "curl -fsS http://127.0.0.1:\${ESS_PORT:-3917}/api/health" >/dev/null 2>&1; then
    echo "deploy: $COMMIT is up on $HOST"
    exit 0
  fi
  sleep 2
done
"${SSH[@]}" "$HOST" "$COMPOSE logs --tail 40 server" || true
die "server did not answer /api/health within 60 s"
