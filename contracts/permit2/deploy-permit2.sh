#!/usr/bin/env bash
# Deploy Uniswap Permit2 to PEPU mainnet at its canonical address via the
# deterministic CREATE2 deployer (0x4e59b448...), using the exact upstream
# creation bytecode and salt. See README.md in this directory for the full
# derivation and verification evidence.
#
# Run from WSL, from anywhere inside the repo:  bash contracts/permit2/deploy-permit2.sh
#
# Uses upstream Foundry (NOT foundry-zksync, which may shadow `forge`/`cast`
# on PATH) — this script always calls the binaries under
# ~/.foundry/versions/stable/ explicitly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FORGE=~/.foundry/versions/stable/forge
CAST=~/.foundry/versions/stable/cast
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

DEPLOYER_C2=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT="0000000000000000000000000000000000000000d3af2663da51c10215000000"
PEPU_CHAIN_ID=97741
PERMIT2_NAME='Permit2'

# strip CR in case a file was saved with Windows line endings
set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "chain id      : $($CAST chain-id --rpc-url "$RPC")"
echo "deployer      : ${DEPLOYER_ADDRESS}"
echo "balance       : $($CAST balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether) PEPU"

echo
echo "--- rebuilding from source to reconfirm creation bytecode before broadcast ---"
if ! BUILD_LOG="$("$FORGE" build --force 2>&1)"; then
  echo "$BUILD_LOG"
  echo "FATAL: forge build failed — refusing to deploy."
  exit 1
fi
FRESH_INIT="$(python3 -c "import json; print(json.load(open('out/Permit2.sol/Permit2.json'))['bytecode']['object'])")"
STORED_INIT="$(cat initcode.hex)"
if [ "${FRESH_INIT,,}" != "${STORED_INIT,,}" ]; then
  echo "FATAL: freshly-built creation bytecode does not match the committed initcode.hex."
  echo "  Refusing to broadcast with possibly-stale or tampered init code."
  exit 1
fi
echo "creation bytecode reconfirmed (bytes: $(( (${#STORED_INIT} - 2) / 2 )))"

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
  --json | tee "$DIR/permit2-receipt.json" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print("status       :", r.get("status")); print("tx           :", r.get("transactionHash")); print("block        :", r.get("blockNumber")); print("gasUsed      :", r.get("gasUsed"))'

echo
echo "--- verifying deployed code ---"
CODE="$($CAST code "$PREDICTED" --rpc-url "$RPC")"
echo "code length   : $(( (${#CODE} - 2) / 2 )) bytes"

echo
echo "--- verifying Permit2 view call (DOMAIN_SEPARATOR) ---"
LIVE_DS="$($CAST call "$PREDICTED" 'DOMAIN_SEPARATOR()(bytes32)' --rpc-url "$RPC" 2>/dev/null || echo FAILED)"
echo "DOMAIN_SEPARATOR() = $LIVE_DS"

TYPE_HASH="$($CAST keccak 'EIP712Domain(string name,uint256 chainId,address verifyingContract)')"
NAME_HASH="$($CAST keccak "$PERMIT2_NAME")"
ENC="$($CAST abi-encode 'f(bytes32,bytes32,uint256,address)' "$TYPE_HASH" "$NAME_HASH" "$PEPU_CHAIN_ID" "$PREDICTED")"
EXPECTED_DS="$($CAST keccak "$ENC")"
echo "expected            = $EXPECTED_DS"

if [ "${LIVE_DS,,}" = "${EXPECTED_DS,,}" ]; then
  echo "DOMAIN_SEPARATOR MATCH — contract is live and correctly initialized for chain $PEPU_CHAIN_ID at $PREDICTED"
else
  echo "WARNING: DOMAIN_SEPARATOR MISMATCH — investigate before relying on this deployment."
fi

echo
echo "DEPLOYED: $PREDICTED"
