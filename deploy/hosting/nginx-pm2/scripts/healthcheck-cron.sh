#!/bin/sh
# Cron wrapper for deploy/hosting/scripts/healthcheck-alert.mjs on the nginx + pm2 host (no Docker).
#
#   */5 * * * * /opt/pepu/app/deploy/hosting/nginx-pm2/scripts/healthcheck-cron.sh >> /var/log/pepu/monitor.log 2>&1
#
# Runs the checker with the policy service's Node (>= 18 is enough) and loads /etc/pepu/monitor.env with Node's
# --env-file, so no shell ever parses the file (webhook URLs with & or ? are safe) and secrets stay out of `ps`.
# Environment overrides (all optional): MONITOR_ENV_FILE, PEPU_MONITOR_NODE.
# Exit code: 0 all checks passed, 1 a check failed, 2 the checker itself could not start.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$HERE/../../scripts/healthcheck-alert.mjs"
ENV_FILE="${MONITOR_ENV_FILE:-/etc/pepu/monitor.env}"
NODE="${PEPU_MONITOR_NODE:-/opt/pepu/node/22.21.1/bin/node}"

if [ ! -r "$ENV_FILE" ]; then
  echo "healthcheck-cron: cannot read $ENV_FILE (copy etc-pepu/monitor.env.example)" >&2
  exit 2
fi
if [ ! -x "$NODE" ]; then
  echo "healthcheck-cron: node not found at $NODE" >&2
  exit 2
fi
if [ ! -f "$CHECKER" ]; then
  echo "healthcheck-cron: $CHECKER not found" >&2
  exit 2
fi

exec "$NODE" --env-file="$ENV_FILE" "$CHECKER"
