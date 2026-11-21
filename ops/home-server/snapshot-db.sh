#!/usr/bin/env bash
# Pulls a consistent copy of the live database from the Docker host to this machine, for
# reading in a SQLite client. The server keeps running. The copy holds password and session
# hashes: keep it out of the repo and shared folders, and delete it when done.
#
#   ops/home-server/snapshot-db.sh user@host [--dir ~/ess-robber-intel] [--out ess-robber-intel.sqlite]
#
# Uses SQLite's backup, not a file copy, because a live WAL database copied raw can be torn.
set -euo pipefail

die() { echo "snapshot: $*" >&2; exit 1; }

[ $# -ge 1 ] || die "usage: snapshot-db.sh user@host [--dir DIR] [--out FILE]"
HOST="$1"; shift
DIR='~/ess-robber-intel'
OUT="ess-robber-intel.sqlite"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done

# Write beside the target and rename at the end, so a failed pull never leaves a half file
# where a SQLite client would open it.
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

echo "snapshot: copying the database from $HOST"
ssh "$HOST" "bash -s" > "$TMP" <<EOF
set -euo pipefail
cd $DIR/ops/home-server
SNAP=/tmp/snapshot-\$\$.sqlite
# exec -T reads stdin, which is this script, so each exec gets /dev/null instead.
docker compose exec -T server node -e '
  const sqlite = require("node:sqlite");
  const db = new sqlite.DatabaseSync(process.env.DB_PATH, { readOnly: true });
  sqlite.backup(db, process.argv[1]).then(() => db.close());
' "\$SNAP" >&2 </dev/null
docker compose exec -T server sh -c 'cat "\$1"; rm -f "\$1"' sh "\$SNAP" </dev/null
EOF

[ "$(head -c 15 "$TMP")" = "SQLite format 3" ] || die "the copy is not a SQLite database; nothing written to $OUT"
mv -f "$TMP" "$OUT"
echo "snapshot: wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
