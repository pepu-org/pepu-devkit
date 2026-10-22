#!/bin/sh
# Daily consistent backup of the policy service's SQLite database on the nginx + pm2 host.
#
#   17 3 * * * BACKUP_KEEP_DAYS=14 /opt/pepu/app/deploy/hosting/nginx-pm2/scripts/backup-sqlite-host.sh >> /var/log/pepu/backup.log 2>&1
#
# Same mechanism as deploy/hosting/scripts/backup-sqlite.sh, without Docker: it runs the service's own
# dist/cli/backup-db.js (VACUUM INTO, online and transactionally consistent while the service keeps running, then
# PRAGMA integrity_check), gzips the snapshot, prunes old ones and optionally uploads. Run it as the pepu user.
#
# Environment (all optional):
#   DB_PATH             default /var/lib/pepu/db/policy.db
#   BACKUP_DIR          default /var/lib/pepu/backups
#   BACKUP_KEEP_DAYS    default 14 (local retention)
#   PEPU_POLICY_NODE    default /opt/pepu/node/22.21.1/bin/node
#   PEPU_APP_DIR        default /opt/pepu/app
#   BACKUP_UPLOAD_CMD   shell command run per new backup with $BACKUP_FILE set, e.g.
#                         rclone copyto "$BACKUP_FILE" remote:pepu-backups/$(basename "$BACKUP_FILE")
#                         scp -i ~/.ssh/backup_key "$BACKUP_FILE" backup@other-host:pepu/
#                       A non-zero exit makes this script fail (cron mail / your monitor notices).
# Restore: see RUNBOOK-nginx-pm2.md ("Backups and restore").
set -eu

DB_PATH="${DB_PATH:-/var/lib/pepu/db/policy.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/pepu/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
NODE="${PEPU_POLICY_NODE:-/opt/pepu/node/22.21.1/bin/node}"
APP="${PEPU_APP_DIR:-/opt/pepu/app}"
CLI="$APP/services/paymaster/policy-service/dist/cli/backup-db.js"

[ -f "$DB_PATH" ] || { echo "backup-sqlite-host: no database at $DB_PATH yet (service never started?)" >&2; exit 1; }
[ -f "$CLI" ] || { echo "backup-sqlite-host: $CLI missing (run deploy.sh to build)" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
out="$(DB_PATH="$DB_PATH" "$NODE" "$CLI" "$BACKUP_DIR" | tail -n 1)"
snap="$BACKUP_DIR/$(basename "$out")"
if [ ! -s "$snap" ]; then
  echo "backup-sqlite-host: snapshot $snap missing or empty" >&2
  exit 1
fi
gzip -9 "$snap"
BACKUP_FILE="$snap.gz"
export BACKUP_FILE
echo "backup-sqlite-host: wrote $BACKUP_FILE ($(wc -c < "$BACKUP_FILE") bytes)"

find "$BACKUP_DIR" -name 'policy-*.db.gz' -mtime "+$KEEP_DAYS" -delete

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  sh -c "$BACKUP_UPLOAD_CMD"
  echo "backup-sqlite-host: uploaded"
fi
