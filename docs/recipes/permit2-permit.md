# Recipe: Sign a Permit2 Permit

Sign an EIP-712 Permit2 `PermitSingle` so a spender can pull a token without a separate `approve` transaction per spender, using the SDK's typed-data builders and the canonical Permit2 deployed on PEPU.

> Status: proven for the pieces the SDK covers: canonical Permit2 has code on mainnet (`eth_getCode` checked), and the SDK's domain and typed data are covered by tests. Submitting the permit to a spender contract depends on that contract and is not covered here.

## Prerequisites

- A token that is an ordinary ERC-20. A one-time ordinary `approve(permit2, amount)` from the owner to Permit2 is still required once per token, because Permit2 pulls through the token's allowance.
- A connected wallet client that can `signTypedData` (a wagmi `useWalletClient`, or a viem `WalletClient`).
- The canonical Permit2 address `0x000000000022D473030F116dDEE9F6B43aC78BA3`. Use `getPermit2()` rather than typing it.

PepuSwap also ships its own, separate Permit2 (`pepuSwapContracts` name `permit2NonCanonical`). It is a different contract with a different domain and does not interoperate with the canonical one. `buildPermitSingleTypedData` always targets the canonical one.

## Steps

1. Read the current allowance and nonce with `readPermit2Allowance`. The nonce lives in Permit2, so do not guess it.
2. Build the typed data with `buildPermitSingleTypedData`. It sets the domain (`name: "Permit2"`, no version, chain 97741, the canonical address) and the `PermitSingle` and `PermitDetails` types.
3. Sign with `walletClient.signTypedData`.
4. Hand the signature to the spender contract, which calls `permit` on Permit2 and then `transferFrom`.

```ts
// Sign a Permit2 AllowanceTransfer permit. See docs/recipes/permit2-permit.md
import {
  buildPermitSingleTypedData,
  getPermit2,
  getPublicClient,
  pepuMainnet,
  readPermit2Allowance,
} from "@pepu-chain/sdk";
import type { WalletClient } from "viem";

const client = getPublicClient(pepuMainnet);

export async function signPermit(
  walletClient: WalletClient,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
): Promise<{ signature: `0x${string}`; permit2: `0x${string}` }> {
  const owner = walletClient.account?.address;
  if (!owner) throw new Error("Connect a wallet first");

  // The nonce lives in Permit2; read it rather than guessing.
  const current = await readPermit2Allowance(client, { owner, token, spender });

  const now = Math.floor(Date.now() / 1000);
  const typed = buildPermitSingleTypedData({
    token,
    amount,
    expiration: now + 60 * 60, // allowance lifetime
    nonce: current.nonce,
    spender,
    sigDeadline: BigInt(now + 30 * 60), // how long this signature may be submitted
  });

  const signature = await walletClient.signTypedData({
    account: owner,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  return { signature, permit2: getPermit2().address };
}
```

Source: `docs/snippets/permit2-permit.ts`, type-checked against the SDK.

For signature-based one-off transfers use `buildPermitTransferFromTypedData` (SignatureTransfer `PermitTransferFrom`) the same way, with `nonce` and `deadline` as `bigint` and an unordered nonce of your choosing.

## What to expect

- The wallet shows a typed-data signing prompt with no gas. With a Privy embedded wallet and the active-wallet pin, the prompt belongs to the embedded wallet.
- `expiration` is when the allowance lapses. `sigDeadline` is how long the signature may be submitted. Keep both short.
- `amount` is a `uint160`. Do not use `maxUint256`.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `getPermit2` throws `UNKNOWN` | The chain is not mainnet | Use chain 97741 |
| The spender reverts with an invalid signer | Wrong nonce, expired `sigDeadline`, or the wrong Permit2 | Re-read the nonce; check you did not sign for PepuSwap's own Permit2 |
| `TransferFrom` fails with insufficient allowance | The token was never approved to Permit2 | Send an ordinary `approve(permit2, amount)` once |
| `amount` rejected | Above `uint160` | Use a bounded amount |

## Related

- [Permit2](../contracts/permit2.md)
- [Core](../sdk/core.md#multicall3-and-permit2)
- [Deployed Contracts Reference](../contracts/deployed-contracts.md)
