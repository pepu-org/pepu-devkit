#!/usr/bin/env bash
# Top up the paymaster's EntryPoint deposit so it can actually sponsor
# UserOperations, and add the stake EntryPoint requires for a paymaster
# to be usable under standard reputation rules.
#
# Deliberately modest: the deposit is the blast radius if the paymaster
# signer key is ever compromised (the contract has no on-chain caps --
# every policy limit lives in the off-chain policy service). Keep it
# small and top up often rather than parking a large float here.
#
# Run from WSL, from anywhere inside the repo:
#   bash deploy/fund-paymaster.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST=~/.foundry/versions/stable/cast

ENTRYPOINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032
PAYMASTER=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0

# ~2000 PEPU covers roughly 250-600 sponsored ops at 3-8 PEPU each --
# enough to prove the flow and run a demo without parking real value.
DEPOSIT_PEPU=${DEPOSIT_PEPU:-2000}
# EntryPoint requires a staked paymaster for standard reputation rules.
# 100 PEPU with a 1-day unstake delay is the minimum that behaves
# normally while staying trivially small.
STAKE_PEPU=${STAKE_PEPU:-100}
UNSTAKE_DELAY_SEC=${UNSTAKE_DELAY_SEC:-86400}

set -a
eval "$(tr -d '\r' < "$ROOT/.env" | grep -E '^[A-Z_]+=')"
eval "$(tr -d '\r' < "$ROOT/deploy/.keys.env" | grep -E '^[A-Z_]+=')"
set +a

RPC="https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}"

echo "paymaster        : $PAYMASTER"
echo "deployer balance : $($CAST balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether) PEPU"
echo "deposit before   : $($CAST call "$ENTRYPOINT" 'balanceOf(address)(uint256)' "$PAYMASTER" --rpc-url "$RPC")"
echo

echo "--- depositing ${DEPOSIT_PEPU} PEPU via EntryPoint.depositTo ---"
$CAST send "$ENTRYPOINT" 'depositTo(address)' "$PAYMASTER" \
  --value "${DEPOSIT_PEPU}ether" \
  --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json | python3 -c 'import sys,json;r=json.load(sys.stdin);print("  status:",r.get("status"),"tx:",r.get("transactionHash"))'

echo
echo "--- staking ${STAKE_PEPU} PEPU (unstake delay ${UNSTAKE_DELAY_SEC}s) ---"
echo "    Stake is added via the paymaster contract so EntryPoint credits"
echo "    the paymaster as the staking entity, not the deployer EOA."
if $CAST send "$PAYMASTER" 'addStake(uint32)' "$UNSTAKE_DELAY_SEC" \
  --value "${STAKE_PEPU}ether" \
  --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json 2>/dev/null | python3 -c 'import sys,json;r=json.load(sys.stdin);print("  status:",r.get("status"),"tx:",r.get("transactionHash"))'; then
  :
else
  echo "  addStake via paymaster failed (role or signature mismatch)."
  echo "  Not fatal: with our own bundler running safe-mode=false, an"
  echo "  unstaked paymaster still works. Revisit before exposing the"
  echo "  bundler publicly or re-enabling safe mode."
fi

echo
echo "--- final state ---"
DEP="$($CAST call "$ENTRYPOINT" 'balanceOf(address)(uint256)' "$PAYMASTER" --rpc-url "$RPC")"
echo "deposit  : $DEP wei"
python3 -c "print(f'         : {int('${DEP%% *}')/1e18:,.4f} PEPU')"
$CAST call "$ENTRYPOINT" 'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' "$PAYMASTER" --rpc-url "$RPC" \
  && echo "  (deposit, staked, stake, unstakeDelaySec, withdrawTime)"
