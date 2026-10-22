#!/bin/sh
# Launcher for the Alto bundler under pm2 (the non-Docker twin of services/bundler/docker-entrypoint.sh).
#
# What it does:
#   1. Reads the RPC URL and executor private key(s) from secret FILES named by
#      ALTO_RPC_URL_FILE / ALTO_EXECUTOR_PRIVATE_KEYS_FILE (optionally ALTO_UTILITY_PRIVATE_KEY_FILE),
#      so no secret appears in ecosystem.config.cjs, `pm2 env`, `pm2 jlist`, or `ps`.
#      A variable that is already set directly wins, exactly like the Docker entrypoint.
#   2. Unsets the *_FILE variables (Alto maps every ALTO_* env var onto a CLI flag and rejects unknown ones).
#   3. exec's Node with the loopback-bind preload, so Alto (which hard-codes 0.0.0.0) listens on 127.0.0.1 only.
#
# It never prints a secret. Required environment (set by ecosystem.config.cjs):
#   PEPU_ALTO_NODE         absolute path to the node binary (default /opt/pepu/node/24.4.1/bin/node)
#   PEPU_BUNDLER_DIR       services/bundler checkout with node_modules (default /opt/pepu/app/services/bundler)
#   ALTO_RPC_URL_FILE, ALTO_EXECUTOR_PRIVATE_KEYS_FILE
set -eu

NODE="${PEPU_ALTO_NODE:-/opt/pepu/node/24.4.1/bin/node}"
BUNDLER_DIR="${PEPU_BUNDLER_DIR:-/opt/pepu/app/services/bundler}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${PEPU_ALTO_CONFIG:-$BUNDLER_DIR/alto.config.prod.json}"

load_secret() {
  name="$1"
  eval "file=\${${name}_FILE:-}"
  eval "current=\${${name}:-}"
  if [ -n "$file" ] && [ -z "$current" ]; then
    if [ ! -r "$file" ]; then
      echo "run-alto: ${name}_FILE is set but the file is not readable" >&2
      exit 1
    fi
    value="$(cat "$file")"
    if [ -z "$value" ]; then
      echo "run-alto: ${name}_FILE is empty" >&2
      exit 1
    fi
    export "$name=$value"
  fi
  unset "${name}_FILE" 2>/dev/null || true
}

load_secret ALTO_RPC_URL
load_secret ALTO_EXECUTOR_PRIVATE_KEYS
load_secret ALTO_UTILITY_PRIVATE_KEY

if [ -z "${ALTO_RPC_URL:-}" ] || [ -z "${ALTO_EXECUTOR_PRIVATE_KEYS:-}" ]; then
  echo "run-alto: ALTO_RPC_URL and ALTO_EXECUTOR_PRIVATE_KEYS (or their *_FILE variants) are required" >&2
  exit 1
fi
if [ ! -x "$NODE" ]; then
  echo "run-alto: node not found at $NODE (run install.sh, or set PEPU_ALTO_NODE)" >&2
  exit 1
fi
if [ ! -f "$BUNDLER_DIR/node_modules/@pimlico/alto/esm/cli/alto.js" ]; then
  echo "run-alto: Alto is not installed in $BUNDLER_DIR (run install.sh / deploy.sh)" >&2
  exit 1
fi

# Our own variables must not leak into Alto's ALTO_* flag mapping (they are not ALTO_-prefixed, but be tidy).
unset PEPU_ALTO_NODE PEPU_BUNDLER_DIR PEPU_ALTO_CONFIG

cd "$BUNDLER_DIR"
exec "$NODE" --import "$HERE/loopback-bind.mjs" \
  node_modules/@pimlico/alto/esm/cli/alto.js run --config "$CONFIG"
