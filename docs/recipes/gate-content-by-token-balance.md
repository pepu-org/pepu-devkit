# Recipe: Gate Content by Token Balance

Show or hide something based on whether the signed-in wallet holds at least some amount of a token, and enforce it on the server where it matters.

> Status: proven. The `token-gated-app` template does this on mainnet with Multicall3-batched balance reads.

## Prerequisites

`@pepu-chain/sdk`, `viem`, and for the UI a wagmi setup on `pepuMainnet` with the embedded wallet pinned as the active account. See [Provision the Wallet and Pin the Active Account](provision-and-pin-the-wallet.md).

## Steps

### Gate by native PEPU balance (UI)

```tsx
import { useAccount, useBalance } from "wagmi";
import { parseEther } from "viem";

const MINIMUM = parseEther("100");

export function GatedContent({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { data: balance, isLoading } = useBalance({ address });

  if (!address) return <p>Sign in to check access.</p>;
  if (isLoading) return <p>Checking balance</p>;
  if (balance === undefined || balance.value < MINIMUM) return <p>You need at least 100 PEPU to view this.</p>;
  return <>{children}</>;
}
```

### Gate by an ERC-20 balance (UI)

```tsx
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi, parseUnits } from "viem";
import { pepuMainnet } from "@pepu-chain/sdk";

const TOKEN = "0xYourTokenAddress" as const;
const MINIMUM = parseUnits("1000", 18);

export function GatedByToken({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { data: balance, isLoading } = useReadContract({
    chainId: pepuMainnet.id,
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (!address) return <p>Sign in to check access.</p>;
  if (isLoading) return <p>Checking balance</p>;
  if (balance === undefined || balance < MINIMUM) return <p>You need at least 1000 tokens to view this.</p>;
  return <>{children}</>;
}
```

`erc20Abi` is viem's, re-exported by `@pepu-chain/sdk` so every ABI imports from one place. Token decimals differ: WPEPU has 18, USDT has 6.

### Enforce on the server

A client check decides what to show, not what to authorize. Verify at the point of use:

```ts
// Gate access by token balance on the server. See docs/recipes/gate-content-by-token-balance.md
import { erc20Abi } from "viem";
import { formatUnitsCompact, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);

export async function holdsEnough(
  token: `0x${string}`,
  holder: `0x${string}`,
  minimum: bigint,
): Promise<{ allowed: boolean; shown: string }> {
  const [balance, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { allowed: balance >= minimum, shown: formatUnitsCompact(balance, decimals) };
}
```

Source: `docs/snippets/gate-by-balance.ts`, type-checked against the SDK.

For an NFT use `erc721Abi`: `balanceOf(address)` is a count, so `balance > 0n` is "owns one". For ERC-1155, `balanceOf(address, tokenId)` takes a token id.

## What to expect

- The UI check is fast and advisory. The server check is the real gate and must run on every privileged request.
- Take the wallet address on the server from the verified Privy token (`requireUser` from [/privy/server](../sdk/privy-server.md)), never from the request body.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The gate shows another wallet's balance | An extension is wagmi's active account | Keep the active-wallet pin on |
| Wrong threshold on USDT | Assumed 18 decimals | Read `decimals()`; USDT has 6 |
| Gate bypassed | Client-only check | Add the server check |

## Related

- [Batch Reads with Multicall3](batch-reads-with-multicall3.md) for checking many addresses at once
- [Token-Gated App template](../templates/token-gated-app.md)
- [Core](../sdk/core.md)
