#!/bin/sh
# Daily consistent backup of the policy service's SQLite database (event log, audit trail,
# circuit-breaker state, reconciler cursor).
#
#   17 3 * * * /opt/pepu/deploy/hosting/scripts/backup-sqlite.sh >> /var/log/pepu-backup.log 2>&1
#
# How: `VACUUM INTO` inside the running container (online, transactionally consistent, verified
# with PRAGMA integrity_check) into ./backups, then gzip, prune, and optionally upload.
#
# Environment (all optional):
#   BACKUP_KEEP_DAYS    default 14   local retention
#   BACKUP_UPLOAD_CMD   shell command run per new backup with $BACKUP_FILE set, e.g.
#                         rclone copyto "$BACKUP_FILE" remote:pepu-backups/$(basename "$BACKUP_FILE")
#                         aws s3 cp "$BACKUP_FILE" s3://my-bucket/pepu/
#                       A non-zero exit makes this script fail (so cron mail / your monitor notices).
# ./backups must be writable by uid 1000 (the container user): sudo chown 1000:1000 backups
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
cd "$HERE"

out="$(docker compose exec -T policy-service node dist/cli/backup-db.js /backups | tail -n 1)"
snap="$HERE/backups/$(basename "$out")"
if [ ! -s "$snap" ]; then
  echo "backup-sqlite: snapshot $snap missing or empty" >&2
  exit 1
fi
gzip -9 "$snap"
BACKUP_FILE="$snap.gz"
export BACKUP_FILE
echo "backup-sqlite: wrote $BACKUP_FILE ($(wc -c < "$BACKUP_FILE") bytes)"

find "$HERE/backups" -name 'policy-*.db.gz' -mtime "+$KEEP_DAYS" -delete

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  sh -c "$BACKUP_UPLOAD_CMD"
  echo "backup-sqlite: uploaded"
fi
