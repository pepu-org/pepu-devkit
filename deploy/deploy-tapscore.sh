#!/usr/bin/env bash
# Deploy the game template's TapScore contract to PEPU mainnet.
# Run from WSL, from anywhere inside the repo:  bash deploy/deploy-tapscore.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE=~/.foundry/versions/stable/forge
CAST=~/.foundry/versions/stable/cast

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"
cd "$ROOT/templates/game-app/contracts/foundry"

echo "building..."
$FORGE build 2>&1 | tail -3

echo
echo "deploying TapScore from ${DEPLOYER_ADDRESS}"
OUT="$($FORGE create src/TapScore.sol:TapScore \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast 2>&1)"
echo "$OUT" | grep -Ei "Deployed to|Transaction hash|Error" || echo "$OUT" | tail -10

ADDR="$(echo "$OUT" | grep -i 'Deployed to' | awk '{print $3}')"
[ -z "$ADDR" ] && { echo "could not parse address"; exit 1; }
echo "$ADDR" > "$ROOT/deploy/tapscore-address.txt"

echo
echo "--- sanity check ---"
echo "code size : $(( ( ${#-} ))) "
CODE="$($CAST code "$ADDR" --rpc-url "$RPC")"
echo "bytecode  : $(( (${#CODE} - 2) / 2 )) bytes"
echo "scores(0) : $($CAST call "$ADDR" 'scores(address)(uint256)' 0x0000000000000000000000000000000000000000 --rpc-url "$RPC")"

echo
echo "--- verifying on pepuscan ---"
$FORGE verify-contract "$ADDR" src/TapScore.sol:TapScore \
  --chain-id 97741 \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --rpc-url "$RPC" 2>&1 | tail -5

echo
echo "TAPSCORE=$ADDR"
