#!/usr/bin/env bash
# Allowlist address(0) on the paymaster's bundler allowlist.
#
# WHY: during eth_estimateUserOperationGas the bundler simulates the
# UserOperation with tx.origin = address(0). PepuVerifyingPaymasterV7
# checks isBundlerAllowed[tx.origin] (unless the paymasterData mode byte
# sets allowAllBundlers, which our policy service deliberately never
# does), so estimation fails with BundlerNotAllowed(0x0) before the gate
# ever sees the real executor EOA.
#
# WHY IT IS SAFE: tx.origin in a MINED transaction is always the
# ECDSA-recovered sender of the outer transaction and can never be the
# zero address. Allowlisting address(0) therefore permits simulation
# only — it cannot authorise a real, gas-spending bundle. The actual
# executor EOA still has to be allowlisted separately (see
# allow-bundler.sh), which is what constrains real spending.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST=~/.foundry/versions/stable/cast
PAYMASTER=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0
ZERO=0x0000000000000000000000000000000000000000

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "before : isBundlerAllowed(address(0)) = $($CAST call "$PAYMASTER" 'isBundlerAllowed(address)(bool)' "$ZERO" --rpc-url "$RPC")"

$CAST send "$PAYMASTER" 'updateBundlerAllowlist(address[],bool)' "[$ZERO]" true \
  --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json | python3 -c 'import sys,json;r=json.load(sys.stdin);print("  status:",r.get("status"),"tx:",r.get("transactionHash"))'

echo "after  : isBundlerAllowed(address(0)) = $($CAST call "$PAYMASTER" 'isBundlerAllowed(address)(bool)' "$ZERO" --rpc-url "$RPC")"
echo "         isBundlerAllowed(executor)   = $($CAST call "$PAYMASTER" 'isBundlerAllowed(address)(bool)' "$BUNDLER_ADDRESS" --rpc-url "$RPC")"
