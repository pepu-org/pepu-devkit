#!/usr/bin/env bash
# Deploy PepuVerifyingPaymasterV7 to PEPU mainnet (chain 97741).
#
# Run from WSL, from anywhere inside the repo:
#   bash services/paymaster/contracts/deploy-paymaster.sh
#   bash services/paymaster/contracts/deploy-paymaster.sh --broadcast
#
# SAFETY MODEL (read this before running):
#   - With NO arguments, this script only PLANS: it rebuilds the contract
#     from source, verifies the creation bytecode hasn't drifted, prints
#     every value and amount it WOULD use (deployer, owner, manager, signer,
#     initial EntryPoint deposit, initial stake), checks whether it's
#     already deployed, and then EXITS without sending a single transaction.
#   - Only `--broadcast` actually sends transactions (deploy + deposit +
#     optional stake + on-chain verification). Real PEPU moves at that point.
#   - There is no third mode. If you are not sure, run it with no arguments
#     first and read the PLAN section carefully -- in particular the OWNER
#     and MANAGER addresses, which get DEFAULT_ADMIN_ROLE / MANAGER_ROLE and
#     can withdraw the entire EntryPoint deposit at any time (see
#     BasePaymaster.withdrawTo / MultiSigner.addSigner/removeSigner).
#
# WHAT THIS SCRIPT DOES NOT DO:
#   - It does not add any on-chain spending cap. This contract has none --
#     see PepuVerifyingPaymasterV7.sol's top-level NatSpec and
#     services/paymaster/README.md's threat model. Every safeguard against
#     drain/griefing/abuse lives in the off-chain policy service, not here.
#   - It does not fund the policy service's signer key. PAYMASTER_SIGNER_*
#     never needs PEPU -- it only ever signs off-chain approvals (see
#     policy-service/README.md); this script registers its ADDRESS as an
#     authorized signer on-chain, nothing more.
#
# Uses upstream Foundry (NOT foundry-zksync, which may shadow `forge`/`cast`
# on PATH) -- this script always calls the binaries under
# ~/.foundry/versions/stable/ explicitly, matching every other deploy script
# in this repo (contracts/permit2/deploy-permit2.sh, deploy/deploy-multicall3.sh,
# deploy/deploy-tapscore.sh).
set -euo pipefail

BROADCAST=false
for arg in "$@"; do
  case "$arg" in
    --broadcast) BROADCAST=true ;;
    *)
      echo "Unknown argument: $arg (only --broadcast is accepted)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FORGE=~/.foundry/versions/stable/forge
CAST=~/.foundry/versions/stable/cast
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PEPU_CHAIN_ID=97741
ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032
DEPLOYED_ADDRESS_FILE="$DIR/deployed-address.txt"
RECEIPT_FILE="$DIR/deploy-receipt.json"

# The creation-code hash of PepuVerifyingPaymasterV7 as of this script being
# written (`cast keccak "$(forge inspect PepuVerifyingPaymasterV7 bytecode)"`
# against a clean `forge build --force`, forge 1.5.1-stable, solc 0.8.26,
# evm_version=london, optimizer_runs=1000000 per foundry.toml). This is the
# CREATE-deployment analog of contracts/permit2/deploy-permit2.sh's
# initcode.hex comparison: since this contract's constructor takes args (so
# there's no single fixed "initcode.hex" the way Permit2's CREATE2 deploy
# has), we instead pin the hash of the *contract's own* creation bytecode
# (before constructor args are appended) and refuse to broadcast if a fresh
# `forge build --force` right now produces anything different -- catching
# an accidental source edit, a stale/tampered artifact, or a compiler/
# settings drift before it can be deployed with real money behind it.
#
# If you intentionally changed the contract and need to update this: rebuild
# and run `cast keccak "$($FORGE inspect PepuVerifyingPaymasterV7 bytecode)"`,
# then replace the constant below. Do not do this to silence a mismatch you
# don't understand.
EXPECTED_CREATION_CODE_HASH=0xe987efab0333ca59a6ee72d235fbc05a862fb4473a11d4237b29a364ad745c15

# --- load env, strip CR in case a file was saved with Windows line endings ---
set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "FATAL: required environment variable $name is not set (check .env / deploy/.keys.env)." >&2
    exit 1
  fi
}
require_var CONDUIT_API_KEY
require_var DEPLOYER_PRIVATE_KEY
require_var DEPLOYER_ADDRESS
require_var PAYMASTER_SIGNER_ADDRESS

# --- configurable, with conservative defaults ---
# Owner/manager get DEFAULT_ADMIN_ROLE / MANAGER_ROLE (withdraw, addStake,
# addSigner/removeSigner, updateBundlerAllowlist). No dedicated admin key
# exists yet in deploy/.keys.env, so this defaults to the deployer key --
# override PAYMASTER_OWNER_ADDRESS / PAYMASTER_MANAGER_ADDRESS in your shell
# env before running if you want a different admin from day one (e.g. a
# multisig). Changing the owner later requires AccessControl role transfer
# calls, not a redeploy, so getting this right now matters less than it
# would for an immutable field.
PAYMASTER_OWNER_ADDRESS="${PAYMASTER_OWNER_ADDRESS:-$DEPLOYER_ADDRESS}"
PAYMASTER_MANAGER_ADDRESS="${PAYMASTER_MANAGER_ADDRESS:-$DEPLOYER_ADDRESS}"

# Deliberately small initial EntryPoint deposit -- see
# services/paymaster/README.md "Deposit management" and the deposit-monitor
# script in this same directory tree: the intended operational model is a
# small float topped up incrementally, not a large deposit funded once,
# specifically to bound the damage from a signer-key compromise (the
# contract enforces NO on-chain spending caps -- see this contract's
# top-level NatSpec).
PAYMASTER_INITIAL_DEPOSIT_ETH="${PAYMASTER_INITIAL_DEPOSIT_ETH:-0.05}"

# Stake is OPTIONAL and OFF by default. Per ERC-4337 (EIP-7562)'s storage-
# access rules, a paymaster may always read/write its OWN storage during
# validation regardless of stake -- and validatePaymasterUserOp here never
# writes storage at all (see PepuVerifyingPaymasterV7.sol's NatSpec on
# _validateVerifyingMode). Staking is therefore not required for correctness
# against this chain's bundler (Alto, safe-mode per services/bundler/
# alto.config.json); it exists as an escape hatch if a specific bundler
# operator later requires it. Staked funds are locked behind an unstake
# delay (unlockStake + wait + withdrawStake), which is itself a blast-radius
# consideration, so this defaults to 0 (skip).
PAYMASTER_INITIAL_STAKE_ETH="${PAYMASTER_INITIAL_STAKE_ETH:-0}"
PAYMASTER_UNSTAKE_DELAY_SEC="${PAYMASTER_UNSTAKE_DELAY_SEC:-86400}"

echo "=================================================================="
echo " PLAN -- PepuVerifyingPaymasterV7 deploy to PEPU mainnet ($PEPU_CHAIN_ID)"
echo "=================================================================="
echo "mode                      : $([ "$BROADCAST" = true ] && echo 'BROADCAST (real transactions)' || echo 'DRY RUN (no transactions will be sent)')"
echo "rpc chain id (live)       : $($CAST chain-id --rpc-url "$RPC")"
echo "deployer                  : $DEPLOYER_ADDRESS"
echo "deployer balance          : $($CAST balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether) PEPU"
echo "entryPoint (v0.7, fixed)  : $ENTRY_POINT"
echo "owner (DEFAULT_ADMIN_ROLE): $PAYMASTER_OWNER_ADDRESS"
echo "manager (MANAGER_ROLE)    : $PAYMASTER_MANAGER_ADDRESS"
echo "initial signer            : $PAYMASTER_SIGNER_ADDRESS"
echo "initial EntryPoint deposit: $PAYMASTER_INITIAL_DEPOSIT_ETH PEPU"
if [ "$PAYMASTER_INITIAL_STAKE_ETH" != "0" ]; then
  echo "initial stake             : $PAYMASTER_INITIAL_STAKE_ETH PEPU (unstake delay ${PAYMASTER_UNSTAKE_DELAY_SEC}s)"
else
  echo "initial stake             : SKIPPED (PAYMASTER_INITIAL_STAKE_ETH=0)"
fi
echo "verifier                  : blockscout @ https://pepuscan.com/api"
echo

echo "--- rebuilding from source to reconfirm creation bytecode before broadcast ---"
if ! BUILD_LOG="$("$FORGE" build --force 2>&1)"; then
  echo "$BUILD_LOG"
  echo "FATAL: forge build failed -- refusing to deploy."
  exit 1
fi
FRESH_BYTECODE="$("$FORGE" inspect PepuVerifyingPaymasterV7 bytecode)"
FRESH_HASH="$("$CAST" keccak "$FRESH_BYTECODE")"
if [ "${FRESH_HASH,,}" != "${EXPECTED_CREATION_CODE_HASH,,}" ]; then
  echo "FATAL: freshly-built creation bytecode hash does not match EXPECTED_CREATION_CODE_HASH."
  echo "  expected: $EXPECTED_CREATION_CODE_HASH"
  echo "  got     : $FRESH_HASH"
  echo "  Refusing to broadcast with possibly-stale, tampered, or unintentionally-changed code."
  echo "  If this change was intentional, see this script's comment above EXPECTED_CREATION_CODE_HASH."
  exit 1
fi
echo "creation bytecode hash reconfirmed: $FRESH_HASH"

echo
echo "--- already-deployed guard ---"
if [ -f "$DEPLOYED_ADDRESS_FILE" ]; then
  EXISTING_ADDR="$(cat "$DEPLOYED_ADDRESS_FILE")"
  EXISTING_CODE="$($CAST code "$EXISTING_ADDR" --rpc-url "$RPC")"
  if [ "$EXISTING_CODE" != "0x" ]; then
    echo "ALREADY DEPLOYED at $EXISTING_ADDR (recorded in $DEPLOYED_ADDRESS_FILE, code present on-chain) -- nothing to do."
    echo "Delete $DEPLOYED_ADDRESS_FILE only if you deliberately intend to deploy a SECOND, SEPARATE paymaster."
    exit 0
  fi
  echo "note: $DEPLOYED_ADDRESS_FILE exists but recorded address $EXISTING_ADDR has no code on-chain -- proceeding."
else
  echo "no prior deployment recorded at $DEPLOYED_ADDRESS_FILE."
fi

if [ "$BROADCAST" != true ]; then
  echo
  echo "=================================================================="
  echo " DRY RUN COMPLETE -- no transaction was sent."
  echo " Re-run with --broadcast once you have reviewed the PLAN above."
  echo "=================================================================="
  exit 0
fi

echo
echo "--- broadcasting deployment ---"
CREATE_OUTPUT="$("$FORGE" create src/PepuVerifyingPaymasterV7.sol:PepuVerifyingPaymasterV7 \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --json \
  --constructor-args "$ENTRY_POINT" "$PAYMASTER_OWNER_ADDRESS" "$PAYMASTER_MANAGER_ADDRESS" "[$PAYMASTER_SIGNER_ADDRESS]")"
echo "$CREATE_OUTPUT"

ADDR="$(echo "$CREATE_OUTPUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["deployedTo"])')"
TX_HASH="$(echo "$CREATE_OUTPUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["transactionHash"])')"
[ -z "$ADDR" ] && { echo "FATAL: could not parse deployed address from forge create output."; exit 1; }

echo "$ADDR" > "$DEPLOYED_ADDRESS_FILE"
echo "$CREATE_OUTPUT" > "$RECEIPT_FILE"

echo
echo "--- verifying deployed code ---"
CODE="$($CAST code "$ADDR" --rpc-url "$RPC")"
echo "deployed to   : $ADDR"
echo "tx hash       : $TX_HASH"
echo "code length   : $(( (${#CODE} - 2) / 2 )) bytes"

echo
echo "--- confirming the initial signer was registered ---"
IS_SIGNER="$($CAST call "$ADDR" 'signers(address)(bool)' "$PAYMASTER_SIGNER_ADDRESS" --rpc-url "$RPC")"
echo "signers($PAYMASTER_SIGNER_ADDRESS) = $IS_SIGNER"
if [ "$IS_SIGNER" != "true" ]; then
  echo "WARNING: the deployed contract does not report the expected signer as authorized. Investigate before relying on this deployment."
fi

if [ "$PAYMASTER_INITIAL_DEPOSIT_ETH" != "0" ]; then
  echo
  echo "--- depositing initial EntryPoint balance ---"
  $CAST send "$ADDR" 'deposit()' \
    --value "${PAYMASTER_INITIAL_DEPOSIT_ETH}ether" \
    --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json \
    | python3 -c 'import sys,json; r=json.load(sys.stdin); print("status :", r.get("status")); print("tx     :", r.get("transactionHash"))'
  DEPOSIT="$($CAST call "$ADDR" 'getDeposit()(uint256)' --rpc-url "$RPC")"
  echo "getDeposit()  : $DEPOSIT wei"
else
  echo
  echo "--- skipping initial deposit (PAYMASTER_INITIAL_DEPOSIT_ETH=0) ---"
fi

if [ "$PAYMASTER_INITIAL_STAKE_ETH" != "0" ]; then
  echo
  echo "--- adding initial stake ---"
  $CAST send "$ADDR" 'addStake(uint32)' "$PAYMASTER_UNSTAKE_DELAY_SEC" \
    --value "${PAYMASTER_INITIAL_STAKE_ETH}ether" \
    --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json \
    | python3 -c 'import sys,json; r=json.load(sys.stdin); print("status :", r.get("status")); print("tx     :", r.get("transactionHash"))'
else
  echo
  echo "--- skipping initial stake (PAYMASTER_INITIAL_STAKE_ETH=0) ---"
fi

echo
echo "--- verifying on pepuscan ---"
ENCODED_CTOR_ARGS="$($CAST abi-encode 'constructor(address,address,address,address[])' \
  "$ENTRY_POINT" "$PAYMASTER_OWNER_ADDRESS" "$PAYMASTER_MANAGER_ADDRESS" "[$PAYMASTER_SIGNER_ADDRESS]")"
$FORGE verify-contract "$ADDR" src/PepuVerifyingPaymasterV7.sol:PepuVerifyingPaymasterV7 \
  --chain-id "$PEPU_CHAIN_ID" \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --constructor-args "$ENCODED_CTOR_ARGS" \
  --rpc-url "$RPC" 2>&1 | tail -10

echo
echo "=================================================================="
echo " DEPLOYED: $ADDR"
echo " Set this in services/paymaster/policy-service/.env :"
echo "   PAYMASTER_CONTRACT_ADDRESS=$ADDR"
echo "=================================================================="
