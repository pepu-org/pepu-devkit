#!/usr/bin/env bash
# shellcheck disable=SC2030,SC2031  # PATH is deliberately set per subshell (bundler and policy use different Node versions)
# deploy.sh - update the hosted PEPU bundler + v1 policy service in place and reload them under pm2.
#
# READ BEFORE RUNNING. What this script changes (and nothing else):
#   - /opt/pepu/app            git fetch + fast-forward (or checkout --ref), only if /opt/pepu/app is a git checkout
#   - services/bundler/node_modules                  npm ci --omit=dev, only when package-lock.json changed
#   - services/paymaster/policy-service/{node_modules,dist}   npm ci (when the lockfile changed) + tsup build
#   - /var/lib/pepu/backups    one fresh SQLite snapshot of the policy DB before anything is replaced
#   - /var/lib/pepu/deploy-history.log   one appended line per run (from-commit -> to-commit)
#   - the pepu user's pm2 daemon: `pm2 startOrReload ecosystem.config.cjs --update-env`, then `pm2 save`
# It does NOT touch nginx, certificates, ufw, /etc/pepu (config and secrets), cron, or the on-chain contracts.
# Fork-mode `pm2 reload` is a restart: expect a few seconds of 502 from nginx while the two services come back.
#
# Usage (as root or any sudoer; it re-executes itself as the `pepu` user):
#   sudo /opt/pepu/app/deploy/hosting/nginx-pm2/deploy.sh                 # pull main, build, reload
#   sudo .../deploy.sh --ref <commit|tag>                                  # deploy (or ROLL BACK to) an exact commit
#   sudo .../deploy.sh --no-pull                                           # just rebuild + reload what is checked out
#                                                                          # (use after rsync-ing a new tree)
#   sudo .../deploy.sh --build-only                                        # install deps + build, no reload (install.sh)
#   sudo .../deploy.sh --skip-backup                                       # skip the pre-deploy DB snapshot
#   sudo .../deploy.sh --dry-run                                           # print what would run, change nothing
#
# Environment overrides (all optional): PEPU_USER=pepu PEPU_HOME=/opt/pepu PEPU_APP_DIR=$PEPU_HOME/app
#   PEPU_STATE_DIR=/var/lib/pepu POLICY_NODE_VERSION=22.21.1 ALTO_NODE_VERSION=24.4.1
set -euo pipefail

PEPU_USER="${PEPU_USER:-pepu}"
PEPU_HOME="${PEPU_HOME:-/opt/pepu}"
APP="${PEPU_APP_DIR:-$PEPU_HOME/app}"
STATE="${PEPU_STATE_DIR:-/var/lib/pepu}"
POLICY_NODE_VERSION="${POLICY_NODE_VERSION:-22.21.1}"
ALTO_NODE_VERSION="${ALTO_NODE_VERSION:-24.4.1}"
ALTO_VERSION_PIN="0.0.21"   # @pimlico/alto: never bump casually, see services/bundler/README.md

DO_PULL=1
DO_RELOAD=1
DO_BACKUP=1
DRY=0
REF=""

usage() { sed -n '3,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) DO_PULL=0 ;;
    --build-only) DO_RELOAD=0; DO_PULL=0; DO_BACKUP=0 ;;
    --skip-backup) DO_BACKUP=0 ;;
    --dry-run) DRY=1 ;;
    --ref) REF="${2:?--ref needs a commit or tag}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "deploy.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" -eq 1 ]; then printf '[deploy] (dry-run) %s\n' "$*"; else "$@"; fi; }

# Re-execute as the service user: the checkout, node_modules and the pm2 daemon all belong to it.
if [ "$(id -u)" -eq 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required to switch to $PEPU_USER"
  id "$PEPU_USER" >/dev/null 2>&1 || die "user $PEPU_USER does not exist: run install.sh first"
  exec sudo -u "$PEPU_USER" -H env "PEPU_USER=$PEPU_USER" "PEPU_HOME=$PEPU_HOME" "PEPU_APP_DIR=$APP" \
    "PEPU_STATE_DIR=$STATE" "POLICY_NODE_VERSION=$POLICY_NODE_VERSION" "ALTO_NODE_VERSION=$ALTO_NODE_VERSION" \
    "$(readlink -f "$0")" "$@"
fi
[ "$(id -un)" = "$PEPU_USER" ] || die "run as root or as $PEPU_USER (currently $(id -un))"

POLICY_NODE_DIR="$PEPU_HOME/node/$POLICY_NODE_VERSION/bin"
ALTO_NODE_DIR="$PEPU_HOME/node/$ALTO_NODE_VERSION/bin"
PM2_BIN="$PEPU_HOME/tools/node_modules/.bin/pm2"
KIT="$APP/deploy/hosting/nginx-pm2"
POLICY_DIR="$APP/services/paymaster/policy-service"
BUNDLER_DIR="$APP/services/bundler"
export PM2_HOME="${PM2_HOME:-$STATE/.pm2}"   # same daemon dir as the pepu-pm2 wrapper

[ -x "$POLICY_NODE_DIR/node" ] || die "Node $POLICY_NODE_VERSION missing at $POLICY_NODE_DIR (run install.sh)"
[ -x "$ALTO_NODE_DIR/node" ] || die "Node $ALTO_NODE_VERSION missing at $ALTO_NODE_DIR (run install.sh)"
[ -d "$APP/services" ] || die "$APP is not a checkout of the repo (run install.sh)"
command -v curl >/dev/null 2>&1 || die "curl is required"

# ---- 1. snapshot the database before replacing anything --------------------------------------------------
DB_PATH="${DB_PATH:-$STATE/db/policy.db}"
if [ "$DO_BACKUP" -eq 1 ]; then
  if [ -f "$DB_PATH" ] && [ -f "$POLICY_DIR/dist/cli/backup-db.js" ]; then
    log "snapshotting $DB_PATH"
    run "$KIT/scripts/backup-sqlite-host.sh" || die "pre-deploy backup failed (fix it, or pass --skip-backup)"
  else
    log "no database or no built CLI yet: skipping the pre-deploy backup"
  fi
fi

# ---- 2. source -----------------------------------------------------------------------------------------
before="(not a git checkout)"
if [ -d "$APP/.git" ]; then
  before="$(git -C "$APP" rev-parse HEAD)"
  has_remote=0
  [ -n "$(git -C "$APP" remote)" ] && has_remote=1
  if [ -n "$REF" ]; then
    [ "$has_remote" -eq 1 ] && run git -C "$APP" fetch --tags --prune origin
    log "checking out $REF (detached)"
    run git -C "$APP" checkout --detach "$REF"
  elif [ "$DO_PULL" -eq 1 ]; then
    [ "$has_remote" -eq 1 ] || die "no git remote configured in $APP; rsync a new tree and use --no-pull"
    branch="$(git -C "$APP" symbolic-ref --short -q HEAD || true)"
    [ -n "$branch" ] || die "$APP is on a detached HEAD (an earlier --ref). Run: git -C $APP switch main"
    log "fast-forwarding $branch from origin"
    run git -C "$APP" pull --ff-only
  fi
else
  log "$APP has no .git (rsync-deployed): building what is on disk"
fi
after="(not a git checkout)"
[ -d "$APP/.git" ] && after="$(git -C "$APP" rev-parse HEAD)"
log "source: $before -> $after"

# ---- 3. dependencies + build ---------------------------------------------------------------------------
# npm ci only when the lockfile (or the Node version) changed: it deletes node_modules, which we would rather not do
# under a running process on every deploy.
stamp_of() { printf '%s-%s' "$(sha256sum "$1/package-lock.json" | cut -d' ' -f1)" "$2"; }

log "bundler: Alto $ALTO_VERSION_PIN on Node $ALTO_NODE_VERSION"
(
  cd "$BUNDLER_DIR"
  export PATH="$ALTO_NODE_DIR:$PATH"
  want="$(stamp_of . "$ALTO_NODE_VERSION")"
  if [ ! -f node_modules/.pepu-stamp ] || [ "$(cat node_modules/.pepu-stamp)" != "$want" ]; then
    run npm ci --omit=dev --no-audit --no-fund
    [ "$DRY" -eq 1 ] || printf '%s' "$want" > node_modules/.pepu-stamp
  else
    log "bundler: dependencies unchanged"
  fi
  if [ "$DRY" -eq 0 ]; then
    got="$(node -p "require('./node_modules/@pimlico/alto/package.json').version")"
    [ "$got" = "$ALTO_VERSION_PIN" ] || { echo "[deploy] ERROR: Alto $got installed, expected $ALTO_VERSION_PIN" >&2; exit 1; }
  fi
)

log "policy service: Node $POLICY_NODE_VERSION (node:sqlite)"
(
  cd "$POLICY_DIR"
  export PATH="$POLICY_NODE_DIR:$PATH"
  want="$(stamp_of . "$POLICY_NODE_VERSION")"
  if [ ! -f node_modules/.pepu-stamp ] || [ "$(cat node_modules/.pepu-stamp)" != "$want" ]; then
    run npm ci --no-audit --no-fund       # devDependencies stay: tsup is needed for every build
    [ "$DRY" -eq 1 ] || printf '%s' "$want" > node_modules/.pepu-stamp
  else
    log "policy service: dependencies unchanged"
  fi
  run ./node_modules/.bin/tsup
  [ "$DRY" -eq 1 ] || [ -f dist/index.js ] || { echo "[deploy] ERROR: build produced no dist/index.js" >&2; exit 1; }
)

if [ "$DRY" -eq 0 ]; then
  mkdir -p "$STATE"
  printf '%s %s %s -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(id -un)" "$before" "$after" >> "$STATE/deploy-history.log" || true
fi

if [ "$DO_RELOAD" -eq 0 ]; then
  log "build finished (--build-only): nothing reloaded"
  exit 0
fi

# ---- 4. reload under pm2 ----------------------------------------------------------------------------------
[ -x "$PM2_BIN" ] || die "pm2 missing at $PM2_BIN (run install.sh)"
for f in /etc/pepu/policy-service.env /etc/pepu/apps.json /etc/pepu/allowlist.json \
         /etc/pepu/secrets/rpc_url /etc/pepu/secrets/executor_private_keys /etc/pepu/secrets/paymaster_signer_private_key \
         /etc/pepu/secrets/privy_app_secret /etc/pepu/secrets/admin_token; do
  [ -r "$f" ] || die "$f is missing or unreadable by $PEPU_USER: finish RUNBOOK sections 4-5 first"
done
export PATH="$POLICY_NODE_DIR:$PATH"

log "pm2 startOrReload (exactly one instance of each app)"
run "$PM2_BIN" startOrReload "$KIT/ecosystem.config.cjs" --update-env
run "$PM2_BIN" save

if [ "$DRY" -eq 1 ]; then log "dry run finished"; exit 0; fi

wait_http() { # url name seconds
  local url="$1" name="$2" tries=$(( $3 / 2 ))
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -m 3 -o /dev/null "$url" 2>/dev/null; then log "$name is up"; return 0; fi
    sleep 2
  done
  return 1
}
fail=0
wait_http http://127.0.0.1:8788/health "policy service /health" 40 || { log "policy service did not come up"; fail=1; }
wait_http http://127.0.0.1:4337/health "bundler /health" 90 || { log "bundler did not come up"; fail=1; }

"$PM2_BIN" status || true
if [ "$fail" -ne 0 ]; then
  cat >&2 <<EOF

[deploy] FAILED. Look at the logs:   sudo pepu-pm2 logs --lines 80 --nostream
[deploy] Roll back to the previous commit:
           sudo $KIT/deploy.sh --ref ${before}
EOF
  exit 1
fi

log "policy service readiness (DB + chain RPC + deposit):"
curl -sS -m 10 http://127.0.0.1:8788/ready || true
echo
log "done: $before -> $after"
