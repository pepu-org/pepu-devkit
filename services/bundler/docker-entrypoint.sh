#!/bin/sh
# Entrypoint for the Alto image.
#
# Secrets convention: for each secret VAR below, if VAR_FILE points at a file
# (e.g. a Docker secret mounted at /run/secrets/<name>) and VAR itself is not
# set, VAR is read from that file. This keeps the RPC URL (embeds a provider
# API key) and the executor private keys out of `docker inspect`, `ps` and the
# compose file. A directly set VAR always wins (handy for local .env use).
#
# The *_FILE variables are unset before exec: Alto maps every ALTO_* env var
# onto a CLI flag (yargs .env("ALTO")) and must not see unknown ones.
# Nothing here ever prints a secret value.
set -eu

load_secret() {
  name="$1"
  eval "file=\${${name}_FILE:-}"
  eval "current=\${${name}:-}"
  if [ -n "$file" ] && [ -z "$current" ]; then
    if [ ! -r "$file" ]; then
      echo "entrypoint: ${name}_FILE is set but the file is not readable" >&2
      exit 1
    fi
    value="$(cat "$file")"
    if [ -z "$value" ]; then
      echo "entrypoint: ${name}_FILE is empty" >&2
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
  echo "entrypoint: ALTO_RPC_URL and ALTO_EXECUTOR_PRIVATE_KEYS (or their *_FILE variants) are required" >&2
  exit 1
fi

exec node node_modules/@pimlico/alto/esm/cli/alto.js run "$@"
