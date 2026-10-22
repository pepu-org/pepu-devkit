#!/usr/bin/env bash
# Verify the deployed Multicall3 on PEPU. Tries Sourcify (via Conduit's
# service) first, then Blockscout (pepuscan) as a fallback — the two
# verifiers index differently and pepuscan is the one developers read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE=~/.foundry/versions/stable/forge

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"
ADDR="$(cat "$ROOT/contracts/multicall3/predicted.txt")"
cd "$ROOT/contracts/multicall3"

echo "verifying $ADDR"
echo

echo "=== attempt 1: Sourcify via contracts.conduit.xyz ==="
$FORGE verify-contract "$ADDR" src/Multicall3.sol:Multicall3 \
  --chain-id 97741 \
  --verifier sourcify \
  --verifier-url https://contracts.conduit.xyz \
  --rpc-url "$RPC" 2>&1 | tail -8

echo
echo "=== attempt 2: Blockscout via pepuscan ==="
$FORGE verify-contract "$ADDR" src/Multicall3.sol:Multicall3 \
  --chain-id 97741 \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --rpc-url "$RPC" 2>&1 | tail -8

echo
echo "=== current status on pepuscan ==="
curl -s -m 20 "https://pepuscan.com/api/v2/smart-contracts/${ADDR}" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print("  is_verified :", d.get("is_verified"))
    print("  name        :", d.get("name"))
    print("  compiler    :", d.get("compiler_version"))
except Exception as e:
    print("  (no verified contract record yet)")'
