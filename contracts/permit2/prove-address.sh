#!/usr/bin/env bash
# Independent, from-scratch computation of the CREATE2 address for the compiled
# Permit2 init code, using upstream Foundry's `cast`. Read-only / no broadcast.
set -euo pipefail

CAST=~/.foundry/versions/stable/cast
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

DEPLOYER="0x4e59b44847b379578588920cA78FbF26c0B4956C"
SALT="0x0000000000000000000000000000000000000000d3af2663da51c10215000000"
CANONICAL="0x000000000022D473030F116dDEE9F6B43aC78BA3"

INIT="$(cat initcode.hex)"
echo "initcode bytes: $(( (${#INIT} - 2) / 2 ))"

echo "--- cast create2 (built-in CREATE2 address computation) ---"
"$CAST" create2 --deployer "$DEPLOYER" --salt "$SALT" --init-code "$INIT"

echo
echo "--- manual computation (independent of the above) ---"
INITHASH="$("$CAST" keccak "$INIT")"
echo "keccak256(initcode)     = $INITHASH"

PACKED="$("$CAST" concat-hex 0xff "$DEPLOYER" "$SALT" "$INITHASH")"
echo "packed preimage          = $PACKED"

FINALHASH="$("$CAST" keccak "$PACKED")"
echo "keccak256(preimage)      = $FINALHASH"

TAIL="${FINALHASH: -40}"
COMPUTED="$("$CAST" to-checksum "0x$TAIL")"
echo "computed address         = $COMPUTED"
echo "canonical Permit2 address= $CANONICAL"

if [ "$(echo "$COMPUTED" | tr '[:upper:]' '[:lower:]')" = "$(echo "$CANONICAL" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "RESULT: MATCH"
else
  echo "RESULT: MISMATCH"
fi
