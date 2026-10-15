#!/usr/bin/env bash
# Allowlist our Alto executor EOA on the paymaster.
#
# WHY THIS IS NEEDED: PepuVerifyingPaymasterV7._validatePaymasterUserOp
# rejects with BundlerNotAllowed(address) unless either the paymasterData
# mode byte sets allowAllBundlers, or isBundlerAllowed[tx.origin] is true.
# The policy service deliberately always signs allowAllBundlers=0, so the
# executor EOA must be explicitly allowlisted.
#
# WHY THAT DESIGN IS GOOD: the check is on tx.origin, so the paymaster
# only ever pays for bundles submitted by OUR bundler. Even if the
# bundler's RPC were reachable by someone else, they could not spend the
# paymaster's deposit through a bundler we don't control. That is real
# defence-in-depth, and it partly offsets running Alto with
# safe-mode=false (forced by a bug in Alto 0.0.21 — see
# services/bundler/README.md).
#
# Run from WSL, from anywhere inside the repo:
#   bash deploy/allow-bundler.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST=~/.foundry/versions/stable/cast
PAYMASTER=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "paymaster    : $PAYMASTER"
echo "bundler EOA  : $BUNDLER_ADDRESS"
echo "caller       : $DEPLOYER_ADDRESS (holds DEFAULT_ADMIN_ROLE + MANAGER_ROLE)"
echo
echo "before : isBundlerAllowed = $($CAST call "$PAYMASTER" 'isBundlerAllowed(address)(bool)' "$BUNDLER_ADDRESS" --rpc-url "$RPC")"

echo
echo "--- updateBundlerAllowlist([bundler], true) ---"
$CAST send "$PAYMASTER" 'updateBundlerAllowlist(address[],bool)' "[$BUNDLER_ADDRESS]" true \
  --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json | python3 -c 'import sys,json;r=json.load(sys.stdin);print("  status:",r.get("status"),"tx:",r.get("transactionHash"))'

echo
echo "after  : isBundlerAllowed = $($CAST call "$PAYMASTER" 'isBundlerAllowed(address)(bool)' "$BUNDLER_ADDRESS" --rpc-url "$RPC")"
