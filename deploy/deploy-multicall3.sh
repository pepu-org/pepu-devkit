#!/usr/bin/env bash
# Deploy Multicall3 to PEPU mainnet via the deterministic CREATE2 deployer.
#
# Run from WSL, from anywhere inside the repo:  bash deploy/deploy-multicall3.sh
#
# Uses upstream Foundry (NOT foundry-zksync, which shadows `forge` on PATH here).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE=~/.foundry/versions/stable/forge
CAST=~/.foundry/versions/stable/cast
DEPLOYER_C2=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT=0000000000000000000000000000000000000000000000000000000000000000

# strip CR in case a file was saved with Windows line endings
set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "chain id      : $($CAST chain-id --rpc-url "$RPC")"
echo "deployer      : ${DEPLOYER_ADDRESS}"
echo "balance       : $($CAST balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether) PEPU"

cd "$ROOT/contracts/multicall3"
INIT="$(sed 's/^0x//' initcode.hex)"
PREDICTED="$(cat predicted.txt)"
echo "predicted addr: $PREDICTED"

EXISTING="$($CAST code "$PREDICTED" --rpc-url "$RPC")"
if [ "$EXISTING" != "0x" ]; then
  echo "ALREADY DEPLOYED at $PREDICTED — nothing to do."
  exit 0
fi

echo
echo "--- broadcasting CREATE2 deploy ---"
$CAST send "$DEPLOYER_C2" "0x${SALT}${INIT}" \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json | tee "$ROOT/deploy/multicall3-receipt.json" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print("status       :", r.get("status")); print("tx           :", r.get("transactionHash")); print("block        :", r.get("blockNumber")); print("gasUsed      :", r.get("gasUsed"))'

echo
echo "--- verifying deployed code ---"
CODE="$($CAST code "$PREDICTED" --rpc-url "$RPC")"
echo "code length   : $(( (${#CODE} - 2) / 2 )) bytes"
echo "aggregate3    : $($CAST call "$PREDICTED" 'aggregate3((address,bool,bytes)[])' '[]' --rpc-url "$RPC" >/dev/null 2>&1 && echo PRESENT || echo ABSENT)"
echo "getBasefee    : $($CAST call "$PREDICTED" 'getBasefee()(uint256)' --rpc-url "$RPC" 2>/dev/null || echo failed)"
echo
echo "DEPLOYED: $PREDICTED"
