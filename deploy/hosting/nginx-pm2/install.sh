#!/usr/bin/env bash
# install.sh - one-time (and safely re-runnable) host preparation for the nginx + pm2 PEPU hosting kit.
#
# READ BEFORE RUNNING. Run as root:  sudo ./install.sh [--dry-run]. Idempotent: every step checks first, nothing is
# overwritten or deleted outside /opt/pepu/app, existing config and secrets are never touched. What it CHANGES on this machine:
#
#   users/groups   creates the system user `pepu` (home /var/lib/pepu, login shell nologin) if it does not exist
#   directories    /opt/pepu/{app,node,tools}                app code (pepu-owned), Node binaries and pm2 (root-owned)
#                  /etc/pepu            root:pepu 750        config files
#                  /etc/pepu/secrets    pepu:pepu 700        key and secret files (files inside are mode 400/600)
#                  /var/lib/pepu/{db,backups,monitor}  pepu  SQLite DB, snapshots, alert state
#                  /var/log/pepu        pepu:pepu 750        pm2 logs
#   Node.js        downloads Node 22.21.1 (policy service) and 24.4.1 (Alto) from nodejs.org into /opt/pepu/node/<v>,
#                  verifying the SHA-256 of each tarball. NOTHING is installed system-wide: your existing Node, nvm,
#                  pm2 and nginx are not touched. (Set ALTO_NODE_VERSION=22.21.1 to use a single Node 22 for both.)
#   pm2            installs pm2 (pinned) under /opt/pepu/tools, plus /usr/local/bin/pepu-pm2, a wrapper that runs pm2
#                  as the pepu user against pepu's OWN daemon (PM2_HOME=/var/lib/pepu/.pm2). Your existing pm2 daemon
#                  and its apps are not touched. Also installs the pm2-logrotate module into that daemon.
#   code           mirrors this checkout into /opt/pepu/app (rsync --delete, only inside that directory; it never
#                  copies .env files or deploy/.keys.env, and keeps node_modules/dist) OR clones REPO_URL there.
#                  Skipped when this script already runs from /opt/pepu/app.
#   build          npm ci + build for services/bundler and services/paymaster/policy-service only (via deploy.sh
#                  --build-only), as the pepu user. Needs outbound HTTPS to registry.npmjs.org.
#   config files   copies the *.example files to /etc/pepu/{policy-service.env,monitor.env,apps.json,allowlist.json}
#                  ONLY if they do not exist yet. You still have to edit them (RUNBOOK section 4).
#
# It does NOT: install or reload nginx config, run certbot, touch ufw/iptables, DNS, cron, systemd units
# (`pm2 startup` is a separate, explicit RUNBOOK step), start the services, generate keys, or move any funds.
#
# Options / environment:
#   --dry-run            print every command instead of running it (read-only checks still run)
#   REPO_URL=<git url>   clone the repo into /opt/pepu/app instead of copying this checkout
#   REPO_REF=<ref>       with REPO_URL: branch or tag to check out (default: the remote's default branch)
#   POLICY_NODE_VERSION  default 22.21.1        ALTO_NODE_VERSION  default 24.4.1        PM2_VERSION  default 7.0.4
#   PEPU_USER=pepu       PEPU_HOME=/opt/pepu    PM2_LOGROTATE_VERSION default 3.0.0
set -euo pipefail

PEPU_USER="${PEPU_USER:-pepu}"
PEPU_HOME="${PEPU_HOME:-/opt/pepu}"
APP="$PEPU_HOME/app"
ETC=/etc/pepu
STATE=/var/lib/pepu
LOGS=/var/log/pepu
POLICY_NODE_VERSION="${POLICY_NODE_VERSION:-22.21.1}"
ALTO_NODE_VERSION="${ALTO_NODE_VERSION:-24.4.1}"
PM2_VERSION="${PM2_VERSION:-7.0.4}"
PM2_LOGROTATE_VERSION="${PM2_LOGROTATE_VERSION:-3.0.0}"
REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-}"
DRY=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install.sh: unknown option $arg" >&2; exit 2 ;;
  esac
done

log() { printf '[install] %s\n' "$*"; }
die() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" -eq 1 ]; then printf '[install] (dry-run) %s\n' "$*"; else "$@"; fi; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0)"
[ "$(uname -s)" = "Linux" ] || die "Linux only"
for c in curl tar sha256sum git rsync openssl sudo useradd; do
  command -v "$c" >/dev/null 2>&1 || die "missing command: $c  (Debian/Ubuntu: sudo apt-get install -y curl git rsync openssl sudo)"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# SHA-256 of the official tarballs (https://nodejs.org/dist/v<ver>/SHASUMS256.txt, checked 2026-10-10).
declare -A NODE_SHA=(
  ["22.21.1-x64"]="219a152ea859861d75adea578bdec3dce8143853c13c5187f40c40e77b0143b2"
  ["22.21.1-arm64"]="c86830dedf77f8941faa6c5a9c863bdfdd1927a336a46943decc06a38f80bfb2"
  ["24.4.1-x64"]="063f2eb299ba60e3fc9b424d8e87d0e2f6be84b39bdeadc421ee2865914c498b"
  ["24.4.1-arm64"]="fde5421e2652e51199bc678e1e6c4d80bbb4c55337ec0a82206568517e9792ef"
)
case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die "unsupported CPU architecture $(uname -m)" ;;
esac

# ---- 1. user and directories ---------------------------------------------------------------------------
if id "$PEPU_USER" >/dev/null 2>&1; then
  log "user $PEPU_USER exists"
else
  log "creating system user $PEPU_USER"
  run useradd --system --no-create-home --home-dir "$STATE" --shell /usr/sbin/nologin "$PEPU_USER"
fi

mkd() { # mode owner path
  if [ -d "$3" ]; then log "dir exists: $3"; else log "mkdir $3"; run install -d -m "$1" -o "${2%%:*}" -g "${2##*:}" "$3"; fi
}
mkd 0755 root:root "$PEPU_HOME"
mkd 0755 root:root "$PEPU_HOME/node"
mkd 0755 root:root "$PEPU_HOME/tools"
mkd 0755 "$PEPU_USER:$PEPU_USER" "$APP"
mkd 0750 "root:$PEPU_USER" "$ETC"
mkd 0700 "$PEPU_USER:$PEPU_USER" "$ETC/secrets"
mkd 0750 "$PEPU_USER:$PEPU_USER" "$STATE"
mkd 0700 "$PEPU_USER:$PEPU_USER" "$STATE/db"
mkd 0750 "$PEPU_USER:$PEPU_USER" "$STATE/backups"
mkd 0750 "$PEPU_USER:$PEPU_USER" "$STATE/monitor"
mkd 0750 "$PEPU_USER:$PEPU_USER" "$LOGS"

# ---- 2. Node.js (per-version, under /opt/pepu/node) ---------------------------------------------------
install_node() {
  local v="$1" dest="$PEPU_HOME/node/$1"
  if [ -x "$dest/bin/node" ] && [ "$("$dest/bin/node" -v)" = "v$v" ]; then log "Node $v already installed"; return; fi
  local file="node-v$v-linux-$NODE_ARCH.tar.gz" tmp want
  want="${NODE_SHA["$v-$NODE_ARCH"]:-}"
  if [ -z "$want" ]; then
    log "no pinned checksum for Node $v: reading it from nodejs.org SHASUMS256.txt (integrity only, not authenticity)"
    want="$(curl -fsSL "https://nodejs.org/dist/v$v/SHASUMS256.txt" | awk -v f="$file" '$2==f {print $1}')"
    [ -n "$want" ] || die "cannot find a checksum for $file"
  fi
  log "downloading Node $v ($NODE_ARCH)"
  if [ "$DRY" -eq 1 ]; then log "(dry-run) download $file, verify sha256 $want, extract to $dest"; return; fi
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/v$v/$file"
  if ! echo "$want  $tmp/$file" | sha256sum -c - >/dev/null; then
    rm -rf "$tmp"
    die "checksum mismatch for $file: refusing to install"
  fi
  mkdir -p "$tmp/x"
  tar -xzf "$tmp/$file" -C "$tmp/x" --strip-components=1
  rm -rf "$dest"
  mv "$tmp/x" "$dest"
  chown -R root:root "$dest"
  rm -rf "$tmp"
  log "installed Node $("$dest/bin/node" -v) at $dest"
}
install_node "$POLICY_NODE_VERSION"
if [ "$ALTO_NODE_VERSION" != "$POLICY_NODE_VERSION" ]; then install_node "$ALTO_NODE_VERSION"; fi
POLICY_NODE_DIR="$PEPU_HOME/node/$POLICY_NODE_VERSION/bin"

# ---- 3. code -----------------------------------------------------------------------------------------
if [ "$REPO_ROOT" = "$APP" ]; then
  log "running from $APP already: no copy needed"
elif [ -n "$REPO_URL" ]; then
  if [ -d "$APP/.git" ]; then
    log "$APP is already a git checkout: leaving it (deploy.sh updates it)"
  else
    [ -z "$(ls -A "$APP" 2>/dev/null)" ] || die "$APP is not empty and not a git checkout; move it away first"
    log "cloning $REPO_URL"
    run sudo -u "$PEPU_USER" -H git clone ${REPO_REF:+--branch "$REPO_REF"} "$REPO_URL" "$APP"
  fi
else
  log "copying $REPO_ROOT -> $APP (rsync; no .env files, no deploy/.keys.env, no node_modules)"
  GIT_EXCLUDE=()
  # A git worktree has a .git FILE pointing outside the tree: copying it would leave a broken checkout.
  if [ -f "$REPO_ROOT/.git" ]; then GIT_EXCLUDE=(--exclude=/.git); fi
  run rsync -a --delete ${GIT_EXCLUDE[@]+"${GIT_EXCLUDE[@]}"} \
    --exclude='node_modules/' --exclude='dist/' --exclude='.claude/' \
    --exclude='.keys.env' --exclude='.env' --exclude='.env.local' --exclude='.env.*.local' \
    --exclude='services/paymaster/policy-service/data/' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
    --exclude='deploy/hosting/secrets/*' --exclude='deploy/hosting/policy-config/apps.json' \
    --exclude='deploy/hosting/policy-config/allowlist.json' \
    "$REPO_ROOT/" "$APP/"
  run chown -R "$PEPU_USER:$PEPU_USER" "$APP"
fi
KIT="$APP/deploy/hosting/nginx-pm2"
if [ "$DRY" -eq 0 ] && [ ! -d "$KIT" ]; then die "$KIT not found after copying"; fi

# ---- 4. pm2 (own copy, own daemon for the pepu user) --------------------------------------------------
if [ -x "$PEPU_HOME/tools/node_modules/.bin/pm2" ]; then
  log "pm2 already installed in $PEPU_HOME/tools"
else
  log "installing pm2@$PM2_VERSION into $PEPU_HOME/tools"
  run env PATH="$POLICY_NODE_DIR:$PATH" npm install --prefix "$PEPU_HOME/tools" --no-audit --no-fund --no-save "pm2@$PM2_VERSION"
fi

WRAPPER=/usr/local/bin/pepu-pm2
if [ "$DRY" -eq 1 ]; then
  log "(dry-run) write $WRAPPER"
elif [ -f "$WRAPPER" ] && grep -q 'pepu-pm2 wrapper' "$WRAPPER"; then
  log "$WRAPPER already present"
else
  [ ! -e "$WRAPPER" ] || die "$WRAPPER exists and is not ours: move it away"
  cat > "$WRAPPER" <<EOF
#!/bin/sh
# pepu-pm2 wrapper (written by deploy/hosting/nginx-pm2/install.sh): runs pm2 as $PEPU_USER against $PEPU_USER's own daemon.
exec sudo -u $PEPU_USER -H env PM2_HOME=$STATE/.pm2 PATH=$POLICY_NODE_DIR:/usr/local/bin:/usr/bin:/bin \\
  $PEPU_HOME/tools/node_modules/.bin/pm2 "\$@"
EOF
  chmod 0755 "$WRAPPER"
  log "wrote $WRAPPER"
fi

# ---- 5. config templates (never overwrite) ---------------------------------------------------------------
put_template() { # source dest
  if [ -e "$2" ]; then log "keeping existing $2"; return; fi
  if [ "$DRY" -eq 0 ] && [ ! -f "$1" ]; then die "template $1 not found"; fi
  log "creating $2 from template (EDIT IT)"
  run install -m 0640 -o root -g "$PEPU_USER" "$1" "$2"
}
put_template "$KIT/etc-pepu/policy-service.env.example" "$ETC/policy-service.env"
put_template "$KIT/etc-pepu/monitor.env.example" "$ETC/monitor.env"
put_template "$APP/deploy/hosting/policy-config/apps.example.json" "$ETC/apps.json"
put_template "$APP/deploy/hosting/policy-config/allowlist.example.json" "$ETC/allowlist.json"

# ---- 6. dependencies and build (as pepu) ------------------------------------------------------------------
log "installing dependencies and building (deploy.sh --build-only)"
run env PEPU_HOME="$PEPU_HOME" PEPU_APP_DIR="$APP" POLICY_NODE_VERSION="$POLICY_NODE_VERSION" \
  ALTO_NODE_VERSION="$ALTO_NODE_VERSION" PEPU_STATE_DIR="$STATE" "$KIT/deploy.sh" --build-only

# ---- 7. pm2-logrotate (pepu's daemon) ----------------------------------------------------------------------
PEPU_PM2=("$WRAPPER")
if [ "$DRY" -eq 1 ]; then
  log "(dry-run) pm2 install pm2-logrotate@$PM2_LOGROTATE_VERSION and set rotation (20M, keep 14, compress)"
elif "${PEPU_PM2[@]}" ls 2>/dev/null | grep -q 'pm2-logrotate'; then
  log "pm2-logrotate already installed"
else
  log "installing pm2-logrotate (rotates the pm2 logs in $LOGS)"
  "${PEPU_PM2[@]}" install "pm2-logrotate@$PM2_LOGROTATE_VERSION"
  "${PEPU_PM2[@]}" set pm2-logrotate:max_size 20M
  "${PEPU_PM2[@]}" set pm2-logrotate:retain 14
  "${PEPU_PM2[@]}" set pm2-logrotate:compress true
  "${PEPU_PM2[@]}" set pm2-logrotate:rotateInterval '0 0 * * *'
fi

cat <<EOF

[install] done$( [ "$DRY" -eq 1 ] && printf ' (dry run: nothing was changed)').
Next (RUNBOOK-nginx-pm2.md): edit /etc/pepu/*.json and *.env, generate the keys (section 5), register them on-chain
from the admin machine, fund the executor, set up nginx + TLS (sections 6-7), THEN start the services:
  sudo pepu-pm2 startOrReload $KIT/ecosystem.config.cjs --update-env
EOF
