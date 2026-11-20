#!/usr/bin/env bash
# Recalibrates ISK per NPC kill for the previous month and lands it through a PR.
# Safe to run daily: it exits 0 when the month is done or its MER is not out yet.
# Usage: run-calibration.sh [--dry-run] [--month YYYY-MM]
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CALIBRATION_REPO:-JimPetko/eve-online-ess-robber-intel}"
CACHE="${CALIBRATION_CACHE:-/cache}"
CHECKS_TIMEOUT="${CALIBRATION_CHECKS_TIMEOUT:-1200}"
GENERATED="src/domain/isk-per-npc-kill.generated.ts"
DRY_RUN=0
MONTH=""

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
stamp() { while IFS= read -r line; do log "  $line"; done; }
die() { log "FAILED: $*"; exit 1; }
cal() { node "$HERE/calibration.mjs" "$@"; }
trap 'log "FAILED: exit $? at line $LINENO: $BASH_COMMAND"' ERR

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --month) MONTH="${2:?--month needs YYYY-MM}"; shift ;;
    *) echo "usage: run-calibration.sh [--dry-run] [--month YYYY-MM]" >&2; exit 2 ;;
  esac
  shift
done

# Outside the container, a logged-in gh CLI can stand in for GH_TOKEN.
GH_TOKEN="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
[ -n "$GH_TOKEN" ] || die "GH_TOKEN is not set"
export GH_TOKEN GH_PROMPT_DISABLED=1
# git reads the token from the environment at each request; it is never written to disk.
export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=""
export GIT_CONFIG_KEY_1=credential.helper
# shellcheck disable=SC2016 # expanded by git's helper shell, not here
export GIT_CONFIG_VALUE_1='!f() { test "$1" = get && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f'

TARGET="${MONTH:-$(cal target-month)}"
BRANCH="calibration/$TARGET"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
[ "$DRY_RUN" = 1 ] && log "dry run: nothing will be pushed, opened, merged or written to Plane"
log "target month $TARGET in $REPO"

# Plane is optional; a Plane failure is logged and never fails the run, and the next run converges it.
plane() {
  if [ -z "${PLANE_API_KEY:-}" ]; then log "PLANE_API_KEY unset; skipping Plane"; return 0; fi
  local flag=""
  [ "$DRY_RUN" = 1 ] && flag="--dry-run"
  cal plane-sync "$TARGET" "$1" "$2" ${flag:+"$flag"} 2>&1 | stamp || log "WARNING: Plane sync failed; the next run retries it"
}

# 1. Already done?
gh pr list -R "$REPO" --head "$BRANCH" --state all --json number,state,url >"$WORK/prs.json"
read -r PR_STATE PR_URL <<<"$(cal pr-state "$WORK/prs.json") "
case "$PR_STATE" in
  MERGED) log "$BRANCH already merged: $PR_URL"; plane "$PR_URL" done; exit 0 ;;
  OPEN) log "$BRANCH already open: $PR_URL; leaving it for a human"; plane "$PR_URL" in-progress; exit 0 ;;
esac
MAIN_MONTH="$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/$GENERATED?ref=main" | cal calibrated-month)"
if [ "$MAIN_MONTH" = "$TARGET" ]; then log "main is already calibrated for $TARGET; nothing to do"; exit 0; fi
log "main is calibrated for ${MAIN_MONTH:-nothing}; calibrating $TARGET"

# 2. Fresh checkout of main, then calibrate.
CHECKOUT="$CACHE/repo"
export npm_config_cache="$CACHE/npm"
mkdir -p "$CACHE"
# The scheduled run and a manual one share the cached checkout; only one may use it.
if command -v flock >/dev/null; then
  exec 9>"$CACHE/.lock"
  flock -n 9 || { log "another run holds $CACHE/.lock; exiting"; exit 0; }
fi
if [ -d "$CHECKOUT/.git" ]; then
  log "updating cached checkout"
  git -C "$CHECKOUT" fetch --quiet --depth 1 origin main 2>&1 | stamp
  git -C "$CHECKOUT" checkout --quiet --force --detach FETCH_HEAD
  git -C "$CHECKOUT" clean --quiet -ffdx
else
  log "cloning $REPO"
  git clone --quiet --depth 1 --branch main "https://github.com/$REPO.git" "$CHECKOUT" 2>&1 | stamp
fi
cd "$CHECKOUT"
log "main at $(git rev-parse --short HEAD)"
npm ci --no-audit --no-fund --no-update-notifier --loglevel=error 2>&1 | stamp || die "npm ci"

log "running calibrate-bounties for $TARGET (downloads about 70 MB)"
CODE=0
node scripts/calibrate-bounties.mjs "$TARGET" >"$WORK/calibrate.log" 2>&1 || CODE=$?
if [ "$CODE" != 0 ] && [ "$(cal mer-not-published "$WORK/calibrate.log")" = yes ]; then
  log "CCP has not published the MER for $TARGET yet; the next run retries"
  exit 0
fi
stamp <"$WORK/calibrate.log"
[ "$CODE" = 0 ] || die "calibrate-bounties exited $CODE for $TARGET"
if git diff --quiet -- "$GENERATED"; then log "$GENERATED unchanged; nothing to do"; exit 0; fi

git show "HEAD:$GENERATED" >"$WORK/before.ts"
cal commit-message "$GENERATED" >"$WORK/commit.txt"
cal pr-body "$REPO" "$GENERATED" "$WORK/before.ts" >"$WORK/body.md"
TITLE="$(head -n 1 "$WORK/commit.txt")"

if [ "$DRY_RUN" = 1 ]; then
  log "would push $BRANCH with:"; git diff --stat -- "$GENERATED" | stamp
  log "commit message:"; stamp <"$WORK/commit.txt"
  log "PR body:"; stamp <"$WORK/body.md"
  plane "https://github.com/$REPO/pulls" done
  log "dry run complete"
  exit 0
fi

# 3. PR, checks, merge.
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-ESS calibration bot}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-calibration@localhost}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
git checkout --quiet -B "$BRANCH"
git commit --quiet -F "$WORK/commit.txt" -- "$GENERATED"
# A closed, unmerged PR leaves the branch behind; this run replaces it.
git push --quiet --force origin "HEAD:refs/heads/$BRANCH" 2>&1 | stamp
PR_URL="$(gh pr create -R "$REPO" --base main --head "$BRANCH" --title "$TITLE" --body-file "$WORK/body.md" --label no-tests-needed)"
PR="${PR_URL##*/}"
log "opened $PR_URL"
# GitHub adds the label after the PR opens, so CI's first run on this commit can miss it.
# A new commit (same tree) makes CI run again with the label on the head it will merge.
sleep 2 # a new committer time, so the amended commit gets a new SHA
git commit --quiet --amend --no-edit
git push --quiet --force origin "HEAD:refs/heads/$BRANCH" 2>&1 | stamp
HEAD_SHA="$(git rev-parse HEAD)"
log "waiting up to ${CHECKS_TIMEOUT}s for checks on $HEAD_SHA"

DEADLINE=$(( $(date +%s) + CHECKS_TIMEOUT ))
while :; do
  gh pr view "$PR" -R "$REPO" --json headRefOid,statusCheckRollup >"$WORK/checks.json"
  STATE=pending
  grep -q "\"$HEAD_SHA\"" "$WORK/checks.json" && STATE="$(cal checks-state "$WORK/checks.json")"
  [ "$STATE" != pending ] && break
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    plane "$PR_URL" in-progress
    die "checks on $PR_URL still pending after ${CHECKS_TIMEOUT}s; PR left open"
  fi
  sleep 30
done
if [ "$STATE" = failed ]; then
  plane "$PR_URL" in-progress
  die "checks failed on $PR_URL; PR left open"
fi
log "checks passed; merging"
git checkout --quiet --detach # so gh's --delete-branch is not deleting the checked-out branch
node scripts/merge-pr.mjs "$PR" 2>&1 | stamp || { plane "$PR_URL" in-progress; die "merge-pr refused $PR_URL; PR left open"; }
plane "$PR_URL" done
log "calibrated $TARGET: $PR_URL"
