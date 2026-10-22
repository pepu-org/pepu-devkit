#!/usr/bin/env bash
# Deploy PepuSponsoredPaymasterV7 (tiered sponsorship: free pool + project vault) to PEPU mainnet (chain 97741).
#
# Run from WSL, from anywhere inside the repo:
#   bash services/paymaster/contracts/deploy-sponsored-paymaster.sh                 # PLAN ONLY (default)
#   bash services/paymaster/contracts/deploy-sponsored-paymaster.sh --broadcast     # sends real transactions
#
# SAFETY MODEL (same as deploy-paymaster.sh, plus one extra guard):
#   - With NO arguments this only PLANS. It rebuilds from source, verifies the creation-bytecode hash against the
#     pinned constant, prints every address/amount/limit it WOULD use, checks the RPC and the already-deployed guard,
#     and exits without sending a transaction. Its only network calls are read-only (chain-id, balance, code, call).
#   - Only `--broadcast` sends transactions.
#   - EXTRA GUARD: this script NEVER touches deployed-address.txt / deploy-receipt.json (the live v1 paymaster
#     0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0). It records v2 in deployed-address-v2.txt / deploy-receipt-v2.json.
#
# OWNERSHIP AND ROLES: the DEPLOYER is the owner by default. PAYMASTER_OWNER_ADDRESS is an OPTIONAL manual override (for
# example a multisig). The MANAGER is a separate, operational hot role (PAYMASTER_MANAGER_ADDRESS): it may pause the
# free pool, remove signers/bundlers instantly, and PROPOSE signer/bundler additions, which only take effect
# `ADMIN_CHANGE_DELAY_SECONDS` (>= 48h, immutable) later (SPONSORSHIP-SPEC.md 4.8, audit M-2). Use a DIFFERENT address for the manager than for
# the owner: if one key is both, a single compromise controls every operational lever. The script WARNS LOUDLY when
# manager == owner (and refuses to --broadcast unless you set ALLOW_SINGLE_KEY_ROLES=1 to acknowledge it).
# The contract uses two-step ownership (transferOwnership + acceptOwnership) and supports renounceOwnership, so you can
# hand it over or freeze it later without redeploying. DEPOSITS ARE ONE-WAY: nobody (owner, manager, project owner) can
# withdraw ANY sponsor-ledger funds, including the free pool; PEPU only leaves the EntryPoint deposit as gas paid for
# sponsored ops. The owner controls the free-pool tier parameters and fee cap, the manager address, the postOp overhead
# (can only LOWER it), and unlock/withdrawal of STAKE (a separate balance, never part of any ledger).
#
# Initial signers and bundler executors are set in the CONSTRUCTOR (effective immediately); every LATER addition is
# timelocked on-chain. Post-deploy configuration is only executed when the deployer actually holds the required role.
# If the owner is a different address, the exact `cast send` commands are PRINTED for the owner to run instead.
#
# Uses upstream Foundry (NOT foundry-zksync on PATH): always ~/.foundry/versions/stable/{forge,cast}.
set -euo pipefail

BROADCAST=false
for arg in "$@"; do
  case "$arg" in
    --broadcast) BROADCAST=true ;;
    *) echo "Unknown argument: $arg (accepted: --broadcast)" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FORGE=~/.foundry/versions/stable/forge
CAST=~/.foundry/versions/stable/cast
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PEPU_CHAIN_ID=97741
ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032
CONTRACT=src/PepuSponsoredPaymasterV7.sol:PepuSponsoredPaymasterV7
DEPLOYED_ADDRESS_FILE="$DIR/deployed-address-v2.txt"
RECEIPT_FILE="$DIR/deploy-receipt-v2.json"
V1_PAYMASTER=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0

# Creation-code hash of PepuSponsoredPaymasterV7 (`cast keccak "$(forge inspect PepuSponsoredPaymasterV7 bytecode)"`
# after `forge build --force`; forge 1.5.1-stable, solc 0.8.26, evm london, optimizer 8,000 runs for THIS contract via
# foundry.toml compilation_restrictions, 1,000,000 for everything else). The script
# refuses to broadcast if a fresh build differs (stale/tampered artifact, source edit, compiler drift). If you changed
# the contract on purpose, recompute and replace; do not edit this to silence a mismatch you do not understand.
# The hash covers the source text (solc metadata), so it only reproduces from LF-line-ending sources, which the root .gitattributes now enforces on every checkout (before that, a
# Windows checkout with core.autocrlf=true converted the sources to CRLF and yielded a DIFFERENT hash). If you see a mismatch, check
# that the working tree is LF (re-checkout after pulling .gitattributes). Runtime size is 23,722 bytes
# (EIP-170 limit 24,576, margin 854, and only because of the 8,000-run build: 25,115 bytes at 1,000,000 runs): the contract
# is near the limit, so any addition needs a size check (`forge build --sizes`). This hash (internal review 3 fixes) was
# verified from a `git archive HEAD` extraction of the commit that introduced it.
EXPECTED_CREATION_CODE_HASH=0x86153ab5c7faa3a83ea9949b2a44ebba196ce367227d376b9a28290e3a468164

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"   # contains a secret: never echoed

require_var() {
  if [ -z "${!1:-}" ]; then echo "FATAL: required environment variable $1 is not set (check .env / deploy/.keys.env)." >&2; exit 1; fi
}
require_var CONDUIT_API_KEY
require_var DEPLOYER_PRIVATE_KEY
require_var DEPLOYER_ADDRESS
require_var PAYMASTER_SIGNER_ADDRESS

# ---- configuration (all overridable from the shell) ----
# Owner defaults to the deployer. PAYMASTER_OWNER_ADDRESS is an optional manual override.
OWNER_OVERRIDDEN=false; [ -n "${PAYMASTER_OWNER_ADDRESS:-}" ] && OWNER_OVERRIDDEN=true
PAYMASTER_OWNER_ADDRESS="${PAYMASTER_OWNER_ADDRESS:-$DEPLOYER_ADDRESS}"
MANAGER_DEFAULTED=false; [ -z "${PAYMASTER_MANAGER_ADDRESS:-}" ] && MANAGER_DEFAULTED=true
PAYMASTER_MANAGER_ADDRESS="${PAYMASTER_MANAGER_ADDRESS:-$DEPLOYER_ADDRESS}"   # SHOULD be a different address than the owner
ADMIN_CHANGE_DELAY_SECONDS="${ADMIN_CHANGE_DELAY_SECONDS:-172800}"   # immutable on-chain timelock for signer/bundler additions and project re-claims; contract floor 172800 (48h). Projects cannot withdraw: pausing is their exit during this window.
case "$ADMIN_CHANGE_DELAY_SECONDS" in (*[!0-9]*|"") echo "FATAL: ADMIN_CHANGE_DELAY_SECONDS must be an integer"; exit 1;; esac
if [ "$ADMIN_CHANGE_DELAY_SECONDS" -lt 172800 ] || [ "$ADMIN_CHANGE_DELAY_SECONDS" -gt 2592000 ]; then echo "FATAL: ADMIN_CHANGE_DELAY_SECONDS must be within [172800 (48h), 2592000 (30 days)] (contract bounds)"; exit 1; fi
POSTOP_OVERHEAD_GAS="${POSTOP_OVERHEAD_GAS:-20000}"                  # initial AND maximum (owner can only lower); bounds [18000, 30000]; worst postOp measured on the real EntryPoint 13.9k incl. dispatch (overhead snapshotted at validation)
# Default on-chain cap on an op's maxFeePerGas (immutable). Measured PEPU base fee is ~12,500 gwei, so 40,000 gwei is ~3x.
# Projects may set their own cap (setMaxFeePerGas) and the owner the free pool's (setFreeMaxFeePerGas). The policy
# service's SPONSORSHIP_V2_MAX_FEE_PER_GAS_CAP_WEI must be <= this.
DEFAULT_MAX_FEE_PER_GAS_GWEI="${DEFAULT_MAX_FEE_PER_GAS_GWEI:-40000}"
ALLOW_SINGLE_KEY_ROLES="${ALLOW_SINGLE_KEY_ROLES:-0}"
FREE_MAX_OP_COST_PEPU="${FREE_MAX_OP_COST_PEPU:-40}"                 # per-op cap for the free pool
FREE_SENDER_DAILY_LIMIT_PEPU="${FREE_SENDER_DAILY_LIMIT_PEPU:-100}"  # on-chain per-smart-account backstop (service enforces 50 per Privy user); 0 = off
# There is NO chain-wide free-tier daily ceiling (removed by decision): the free pool is bounded by its balance.
# Free-tier destination allowlist (TapScore demo). Space-separated.
FREE_TARGETS="${FREE_TARGETS:-0x261eA5971B93237a56990206A46Bc80318e4d078}"
# Bundler executor(s) allowed to spend, set in the constructor. address(0) is allowlisted so gas estimation (which
# simulates with tx.origin == 0) works: a mined tx never has tx.origin == 0, so this only permits simulation. The gate
# uses ORIGIN, which ERC-7562 bans in validation: run ONLY a self-hosted bundler with that rule off (Alto safe-mode
# false), and treat the gate as defence in depth, not as the sponsor-safety boundary (the signer, fee cap, limits and
# allowlists are). Later additions need a ~48h on-chain timelock: list every executor you need NOW.
BUNDLER_ADDRESSES="${BUNDLER_ADDRESSES:-0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e 0x0000000000000000000000000000000000000000}"
FREE_POOL_INITIAL_FUNDING_ETH="${FREE_POOL_INITIAL_FUNDING_ETH:-0}"  # default 0: you decide how much the chain seeds
PAYMASTER_INITIAL_STAKE_ETH="${PAYMASTER_INITIAL_STAKE_ETH:-100}"    # mirrors the live v1 (100 PEPU / 86400 s); 0 to skip
PAYMASTER_UNSTAKE_DELAY_SEC="${PAYMASTER_UNSTAKE_DELAY_SEC:-86400}"

lower() { echo "$1" | tr 'A-F' 'a-f'; }
IS_OWNER=false;   [ "$(lower "$DEPLOYER_ADDRESS")" = "$(lower "$PAYMASTER_OWNER_ADDRESS")" ] && IS_OWNER=true
IS_MANAGER=false; [ "$(lower "$DEPLOYER_ADDRESS")" = "$(lower "$PAYMASTER_MANAGER_ADDRESS")" ] && IS_MANAGER=true
SAME_OWNER_MANAGER=false; [ "$(lower "$PAYMASTER_OWNER_ADDRESS")" = "$(lower "$PAYMASTER_MANAGER_ADDRESS")" ] && SAME_OWNER_MANAGER=true
DEFAULT_MAX_FEE_WEI="$($CAST --to-wei "$DEFAULT_MAX_FEE_PER_GAS_GWEI" gwei)"
if [ "$IS_OWNER" = true ] || [ "$IS_MANAGER" = true ]; then OWNER_OR_MANAGER=true; else OWNER_OR_MANAGER=false; fi

echo "=================================================================="
echo " PLAN -- PepuSponsoredPaymasterV7 deploy to PEPU mainnet ($PEPU_CHAIN_ID)"
echo "=================================================================="
echo "mode                       : $([ "$BROADCAST" = true ] && echo 'BROADCAST (real transactions)' || echo 'DRY RUN (no transactions will be sent)')"
echo "rpc chain id (live)        : $($CAST chain-id --rpc-url "$RPC")"
echo "deployer                   : $DEPLOYER_ADDRESS"
echo "deployer balance           : $($CAST balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether) PEPU"
echo "entryPoint (v0.7, fixed)   : $ENTRY_POINT"
echo "owner (Ownable2Step)       : $PAYMASTER_OWNER_ADDRESS$([ "$OWNER_OVERRIDDEN" = false ] && echo '   (defaults to the deployer; set PAYMASTER_OWNER_ADDRESS only to override)' || echo '   (manual override)')"
echo "manager                    : $PAYMASTER_MANAGER_ADDRESS$([ "$MANAGER_DEFAULTED" = true ] && echo '   (DEFAULTED to the deployer: set PAYMASTER_MANAGER_ADDRESS to a separate address)')"
echo "initial signer             : $PAYMASTER_SIGNER_ADDRESS"
echo "admin change delay (immut.): ${ADMIN_CHANGE_DELAY_SECONDS}s   (signer/bundler additions and project re-claims wait this long; contract bounds 172800 = 48h to 2592000 = 30 days)"
echo "default max fee per gas    : ${DEFAULT_MAX_FEE_PER_GAS_GWEI} gwei (immutable on-chain cap on an op's maxFeePerGas)"
echo "deposits                   : one-way (anyone deposits, NO withdrawal by anyone); project settings need a signer-attested claim (EIP-712)"
echo "postOp overhead gas        : $POSTOP_OVERHEAD_GAS (initial and ceiling; owner can only lower; floor 18000)"
echo "free tier op cap / sender  : $FREE_MAX_OP_COST_PEPU PEPU per op  /  $FREE_SENDER_DAILY_LIMIT_PEPU PEPU per smart account per day (0 = off); NO chain-wide ceiling"
echo "free-tier allowlist        : $FREE_TARGETS"
echo "bundler allowlist (ctor)   : $BUNDLER_ADDRESSES"
echo "free pool seed funding     : $FREE_POOL_INITIAL_FUNDING_ETH PEPU$([ "$FREE_POOL_INITIAL_FUNDING_ETH" = "0" ] && echo '   (NOT FUNDED: the free tier will deny until the pool is funded)')"
echo "stake                      : $([ "$PAYMASTER_INITIAL_STAKE_ETH" != "0" ] && echo "$PAYMASTER_INITIAL_STAKE_ETH PEPU, unstake delay ${PAYMASTER_UNSTAKE_DELAY_SEC}s" || echo SKIPPED)"
echo "deployer holds roles       : owner=$IS_OWNER manager=$IS_MANAGER  (config txs needing a role the deployer lacks are PRINTED, not sent)"
echo "live v1 paymaster          : $V1_PAYMASTER (untouched; this script never writes deployed-address.txt)"
echo

if [ "$SAME_OWNER_MANAGER" = true ]; then
  echo "##################################################################"
  echo "# WARNING: MANAGER == OWNER ($PAYMASTER_OWNER_ADDRESS)"
  if [ "$IS_OWNER" = true ]; then
    echo "# ... and that address is also the DEPLOYER: ONE hot key holds every role."
  fi
  echo "# A single compromise of that key controls the free pool, every signer/bundler"
  echo "# proposal and the whole operational surface. Use a SEPARATE manager address"
  echo "# (PAYMASTER_MANAGER_ADDRESS) and ideally a multisig owner. Signer/bundler additions"
  echo "# are timelocked on-chain (adminChangeDelay >= 48h) so projects can pause, but that"
  echo "# protects projects, not the free pool, from a key that is also the owner."
  echo "##################################################################"
  if [ "$BROADCAST" = true ] && [ "$ALLOW_SINGLE_KEY_ROLES" != "1" ]; then
    echo "FATAL: refusing to --broadcast with manager == owner. Set PAYMASTER_MANAGER_ADDRESS to a different address," >&2
    echo "       or set ALLOW_SINGLE_KEY_ROLES=1 to acknowledge the risk explicitly." >&2
    exit 1
  fi
  echo
fi

echo "--- rebuilding from source to reconfirm creation bytecode ---"
if ! BUILD_LOG="$("$FORGE" build --force 2>&1)"; then echo "$BUILD_LOG"; echo "FATAL: forge build failed -- refusing to deploy."; exit 1; fi
FRESH_HASH="$("$CAST" keccak "$("$FORGE" inspect PepuSponsoredPaymasterV7 bytecode)")"
if [ "$(lower "$FRESH_HASH")" != "$(lower "$EXPECTED_CREATION_CODE_HASH")" ]; then
  echo "FATAL: freshly-built creation bytecode hash does not match EXPECTED_CREATION_CODE_HASH."
  echo "  expected: $EXPECTED_CREATION_CODE_HASH"; echo "  got     : $FRESH_HASH"
  echo "  Refusing to continue. See the comment above EXPECTED_CREATION_CODE_HASH."
  exit 1
fi
echo "creation bytecode hash reconfirmed: $FRESH_HASH"
V1_HASH="$("$CAST" keccak "$("$FORGE" inspect PepuVerifyingPaymasterV7 bytecode)")"
echo "v1 creation hash (must be e987efab...): $V1_HASH"

echo
echo "--- already-deployed guard ---"
if [ -f "$DEPLOYED_ADDRESS_FILE" ]; then
  EXISTING_ADDR="$(cat "$DEPLOYED_ADDRESS_FILE")"
  if [ "$($CAST code "$EXISTING_ADDR" --rpc-url "$RPC")" != "0x" ]; then
    echo "ALREADY DEPLOYED at $EXISTING_ADDR (recorded in $DEPLOYED_ADDRESS_FILE, code present) -- nothing to do."
    echo "Delete that file only if you deliberately intend to deploy a SECOND, SEPARATE v2 paymaster."
    exit 0
  fi
  echo "note: $DEPLOYED_ADDRESS_FILE exists but $EXISTING_ADDR has no code on-chain -- proceeding."
else
  echo "no prior v2 deployment recorded."
fi

if [ "$BROADCAST" != true ]; then
  echo
  echo "=================================================================="
  echo " DRY RUN COMPLETE -- no transaction was sent."
  echo " Re-run with --broadcast once you have reviewed the PLAN above."
  echo "=================================================================="
  exit 0
fi

BUNDLER_ARRAY="[$(echo $BUNDLER_ADDRESSES | tr ' ' ',')]"

send() { # send <label> <to> <sig> [args...] [-- extra cast flags]
  echo "--- $1"; shift
  $CAST send "$@" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json \
    | python3 -c 'import sys,json; r=json.load(sys.stdin); print("   status:", r.get("status"), " tx:", r.get("transactionHash"))'
}
print_cmd() { echo "   OWNER/MANAGER must run: cast send $PAYMASTER_ADDR $* --rpc-url <rpc> --account <role holder>"; }

echo
echo "--- broadcasting deployment ---"
CREATE_OUTPUT="$("$FORGE" create "$CONTRACT" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json \
  --constructor-args "$ENTRY_POINT" "$PAYMASTER_OWNER_ADDRESS" "$PAYMASTER_MANAGER_ADDRESS" "[$PAYMASTER_SIGNER_ADDRESS]" \
  "$BUNDLER_ARRAY" "$ADMIN_CHANGE_DELAY_SECONDS" "$POSTOP_OVERHEAD_GAS" "$DEFAULT_MAX_FEE_WEI")"
PAYMASTER_ADDR="$(echo "$CREATE_OUTPUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["deployedTo"])')"
[ -z "$PAYMASTER_ADDR" ] && { echo "FATAL: could not parse deployed address."; exit 1; }
echo "$PAYMASTER_ADDR" > "$DEPLOYED_ADDRESS_FILE"
echo "$CREATE_OUTPUT" > "$RECEIPT_FILE"
echo "deployed to: $PAYMASTER_ADDR"

echo "--- confirming constructor state ---"
echo "owner() = $($CAST call "$PAYMASTER_ADDR" 'owner()(address)' --rpc-url "$RPC")  manager() = $($CAST call "$PAYMASTER_ADDR" 'manager()(address)' --rpc-url "$RPC")"
echo "signers($PAYMASTER_SIGNER_ADDRESS) = $($CAST call "$PAYMASTER_ADDR" 'signers(address)(bool)' "$PAYMASTER_SIGNER_ADDRESS" --rpc-url "$RPC")"
echo "adminChangeDelay = $($CAST call "$PAYMASTER_ADDR" 'adminChangeDelay()(uint48)' --rpc-url "$RPC")  postOpOverheadGas = $($CAST call "$PAYMASTER_ADDR" 'postOpOverheadGas()(uint32)' --rpc-url "$RPC")"
echo "defaultMaxFeePerGas = $($CAST call "$PAYMASTER_ADDR" 'defaultMaxFeePerGas()(uint128)' --rpc-url "$RPC")"
for B in $BUNDLER_ADDRESSES; do echo "isBundlerAllowed($B) = $($CAST call "$PAYMASTER_ADDR" 'isBundlerAllowed(address)(bool)' "$B" --rpc-url "$RPC")"; done

echo
echo "--- post-deploy configuration ---"
FREE_TARGET_ARRAY="[$(echo $FREE_TARGETS | tr ' ' ',')]"
# (bundlers and signers were set in the constructor: nothing to send for them)
if [ "$OWNER_OR_MANAGER" = true ]; then
  send "free-tier allowlist" "$PAYMASTER_ADDR" 'setFreeTargets(address[],bool)' "$FREE_TARGET_ARRAY" true
else
  print_cmd "'setFreeTargets(address[],bool)' '$FREE_TARGET_ARRAY' true"
fi
OPMAX_WEI="$($CAST --to-wei "$FREE_MAX_OP_COST_PEPU" ether)"; SENDER_WEI="$($CAST --to-wei "$FREE_SENDER_DAILY_LIMIT_PEPU" ether)"
if [ "$IS_OWNER" = true ]; then
  send "free tier parameters (enabled)" "$PAYMASTER_ADDR" 'setFreeTier(uint128,uint112,bool)' "$OPMAX_WEI" "$SENDER_WEI" true
else
  print_cmd "'setFreeTier(uint128,uint112,bool)' $OPMAX_WEI $SENDER_WEI true   # OWNER only"
fi
if [ "$FREE_POOL_INITIAL_FUNDING_ETH" != "0" ]; then
  send "fund free pool" "$PAYMASTER_ADDR" 'fundFreePool()' --value "${FREE_POOL_INITIAL_FUNDING_ETH}ether"
fi
if [ "$PAYMASTER_INITIAL_STAKE_ETH" != "0" ]; then
  # addStake is OWNER only (review 3, L-2) and the unstake delay is capped at 30 days on-chain
  if [ "$PAYMASTER_UNSTAKE_DELAY_SEC" -gt 2592000 ]; then echo "FATAL: PAYMASTER_UNSTAKE_DELAY_SEC must be <= 2592000 (30 days, contract cap)"; exit 1; fi
  if [ "$IS_OWNER" = true ]; then
    send "stake" "$PAYMASTER_ADDR" 'addStake(uint32)' "$PAYMASTER_UNSTAKE_DELAY_SEC" --value "${PAYMASTER_INITIAL_STAKE_ETH}ether"
  else
    print_cmd "'addStake(uint32)' $PAYMASTER_UNSTAKE_DELAY_SEC --value ${PAYMASTER_INITIAL_STAKE_ETH}ether   # OWNER only"
  fi
fi

echo
echo "--- verifying on pepuscan ---"
ENCODED="$($CAST abi-encode 'constructor(address,address,address,address[],address[],uint32,uint32,uint128)' \
  "$ENTRY_POINT" "$PAYMASTER_OWNER_ADDRESS" "$PAYMASTER_MANAGER_ADDRESS" "[$PAYMASTER_SIGNER_ADDRESS]" "$BUNDLER_ARRAY" "$ADMIN_CHANGE_DELAY_SECONDS" "$POSTOP_OVERHEAD_GAS" "$DEFAULT_MAX_FEE_WEI")"
$FORGE verify-contract "$PAYMASTER_ADDR" "$CONTRACT" --chain-id "$PEPU_CHAIN_ID" --verifier blockscout --verifier-url https://pepuscan.com/api \
  --constructor-args "$ENCODED" --rpc-url "$RPC" 2>&1 | tail -10

echo
echo "=================================================================="
echo " DEPLOYED: $PAYMASTER_ADDR   (owner: $PAYMASTER_OWNER_ADDRESS)"
echo " Later, when you want to hand over or freeze (see SPONSORSHIP-SPEC.md 4.8):"
echo "   transfer : cast send $PAYMASTER_ADDR 'transferOwnership(address)' <new owner>   then the new owner runs 'acceptOwnership()'"
echo "   rotate a signer/bundler: propose*(addr), wait adminChangeDelay (>= 48h), then execute*(addr); removals are instant"
echo "   freeze   : cast send $PAYMASTER_ADDR 'setManager(address)' 0x0000000000000000000000000000000000000000  (optional, total freeze)"
echo "              cast send $PAYMASTER_ADDR 'renounceOwnership()'   # IRREVERSIBLE"
echo " Policy service v2 env (services/paymaster/policy-service/.env):"
echo "   SPONSORSHIP_V2_ENABLED=true"
echo "   SPONSORSHIP_V2_PAYMASTER_ADDRESS=$PAYMASTER_ADDR"
echo "   SPONSORSHIP_V2_DEPLOY_BLOCK=<block of the deploy tx>"
echo "   (project claims need the policy service's signer to be a current signer: it is, if PAYMASTER_SIGNER_ADDRESS is the service's key)"
echo "=================================================================="
