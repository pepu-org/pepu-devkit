#!/usr/bin/env bash
# Read-only gas estimation for the Permit2 CREATE2 deploy on PEPU mainnet.
# Does NOT broadcast anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CAST=~/.foundry/versions/stable/cast
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

DEPLOYER_C2=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT="0000000000000000000000000000000000000000d3af2663da51c10215000000"

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "chain id      : $($CAST chain-id --rpc-url "$RPC")"
BASEFEE_WEI="$($CAST base-fee --rpc-url "$RPC")"
echo "base fee (wei): $BASEFEE_WEI"
echo "base fee (gwei): $($CAST from-wei "$BASEFEE_WEI" gwei)"

INIT="$(sed 's/^0x//' initcode.hex)"
echo
echo "--- eth_estimateGas for the CREATE2 deploy call ---"
GAS="$($CAST estimate "$DEPLOYER_C2" "0x${SALT}${INIT}" --rpc-url "$RPC")"
echo "estimated gas : $GAS"

# bash arithmetic overflows 64-bit signed for gas*wei-basefee, so multiply with awk instead
COST_PEPU=$(awk -v g="$GAS" -v b="$BASEFEE_WEI" 'BEGIN { printf "%.6f", (g * b) / 1e18 }')
echo "cost @ base fee only (approx, no priority fee): $COST_PEPU PEPU"
