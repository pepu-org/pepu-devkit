#!/bin/sh
# Cron wrapper for healthcheck-alert.mjs: runs it in a throwaway, locked-down Node container so
# the VM needs only Docker (no Node install). Parameterised entirely through monitor.env.
#
#   */5 * * * * /opt/pepu/deploy/hosting/scripts/healthcheck-alert.sh >> /var/log/pepu-monitor.log 2>&1
#
# Environment overrides (all optional):
#   MONITOR_ENV_FILE   default <hosting dir>/monitor.env
#   MONITOR_STATE_DIR  default /var/lib/pepu-hosting (must be writable by RUN_AS)
#   RPC_SECRET_FILE    default <hosting dir>/secrets/rpc_url (mounted at /run/secrets/rpc_url)
#   NODE_IMAGE         default node:22.21.1-bookworm-slim
#   RUN_AS             default 1000:1000 (the owner of secrets/*, see RUNBOOK)
#   USE_HOST_NODE=1    run with the host's `node` (>= 18) instead of Docker; then set RPC_URL_FILE
#                      in monitor.env to the real path of the rpc_url secret file.
# Exit code: 0 all checks passed, 1 a check failed, 2 the checker itself crashed.
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${MONITOR_ENV_FILE:-$HERE/monitor.env}"
STATE_DIR="${MONITOR_STATE_DIR:-/var/lib/pepu-hosting}"
RPC_SECRET_FILE="${RPC_SECRET_FILE:-$HERE/secrets/rpc_url}"
NODE_IMAGE="${NODE_IMAGE:-node:22.21.1-bookworm-slim}"
RUN_AS="${RUN_AS:-1000:1000}"

if [ ! -r "$ENV_FILE" ]; then
  echo "healthcheck-alert: cannot read $ENV_FILE (copy monitor.env.example)" >&2
  exit 2
fi
mkdir -p "$STATE_DIR"

if [ "${USE_HOST_NODE:-0}" = "1" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  STATE_FILE="${STATE_FILE:-$STATE_DIR/alert-state.json}" exec node "$HERE/scripts/healthcheck-alert.mjs"
fi

exec docker run --rm \
  --network host \
  --user "$RUN_AS" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 128m \
  --env-file "$ENV_FILE" \
  -v "$HERE/scripts:/scripts:ro" \
  -v "$STATE_DIR:/state" \
  -v "$RPC_SECRET_FILE:/run/secrets/rpc_url:ro" \
  "$NODE_IMAGE" node /scripts/healthcheck-alert.mjs
