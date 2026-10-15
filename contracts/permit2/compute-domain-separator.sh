#!/usr/bin/env bash
# Independently precompute the expected DOMAIN_SEPARATOR() Permit2 will report
# once deployed at the canonical address on PEPU (chain id 97741), so the
# deploy script can assert the live on-chain value against it.
set -euo pipefail

CAST=~/.foundry/versions/stable/cast

TYPE_HASH="$("$CAST" keccak 'EIP712Domain(string name,uint256 chainId,address verifyingContract)')"
NAME_HASH="$("$CAST" keccak 'Permit2')"
CHAINID=97741
ADDR="0x000000000022D473030F116dDEE9F6B43aC78BA3"

ENC="$("$CAST" abi-encode 'f(bytes32,bytes32,uint256,address)' "$TYPE_HASH" "$NAME_HASH" "$CHAINID" "$ADDR")"
EXPECTED="$("$CAST" keccak "$ENC")"

echo "TYPE_HASH        = $TYPE_HASH"
echo "NAME_HASH         = $NAME_HASH"
echo "chainid           = $CHAINID"
echo "verifyingContract = $ADDR"
echo "expected DOMAIN_SEPARATOR() = $EXPECTED"
