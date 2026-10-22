# Recipe: Batch Reads with Multicall3 in React

Read many values in one request from a React component with wagmi, using PEPU's own Multicall3. No Multicall3 configuration is needed when you use the SDK's chain.

The token-gated template batches balance reads this way.

## Prerequisites

- A wagmi config that uses `pepuMainnet`, ideally `PepuPrivyWagmiProvider` from [/privy/wagmi](../sdk/privy-wagmi.md) or `pepuWagmiConfig`.
- Read [The Multicall3 Trap](../contracts/multicall3.md): the canonical Multicall3 address has no code on PEPU. PEPU's is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`.

## Steps

1. Use `pepuMainnet` as the chain. It carries `contracts.multicall3` at PEPU's address, so wagmi's `useReadContracts` batches into one `aggregate3` call automatically.
2. Build the contract list. Pass `chainId: pepuMainnet.id` on each item.
3. Read the native PEPU balance separately with `usePepuBalance`, because a native balance is not a contract call.

```tsx
// Batched reads in React with wagmi. See docs/recipes/multicall-in-react.md
import { useReadContracts } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { pepuMainnet, pepuTokenList } from "@pepu-chain/sdk";
import { usePepuBalance } from "@pepu-chain/sdk/react";
import { getPublicClient } from "@pepu-chain/sdk";

const publicClient = getPublicClient(pepuMainnet);

export function Balances({ holder }: { holder: `0x${string}` }) {
  // pepuMainnet carries contracts.multicall3 at PEPU's own address, so wagmi batches these into one call
  // with no extra configuration.
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: pepuTokenList.tokens.flatMap(
      (t) =>
        [
          { chainId: pepuMainnet.id, address: t.address as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
          {
            chainId: pepuMainnet.id,
            address: t.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [holder],
          },
        ] as const,
    ),
  });

  // The native balance is not a contract call; usePepuBalance polls it.
  const native = usePepuBalance(publicClient, { address: holder, pollingInterval: 15_000 });

  if (isLoading) return <p>Loading</p>;
  return (
    <ul>
      <li>PEPU {native.data !== undefined ? formatUnits(native.data, 18) : "..."}</li>
      {pepuTokenList.tokens.map((t, i) => {
        const symbol = data?.[i * 2];
        const balance = data?.[i * 2 + 1];
        return (
          <li key={t.address}>
            {symbol?.status === "success" ? String(symbol.result) : t.symbol}{" "}
            {balance?.status === "success" ? formatUnits(balance.result as bigint, t.decimals) : "..."}
          </li>
        );
      })}
    </ul>
  );
}
```

Source: `docs/snippets/multicall-in-react.tsx`, type-checked against the SDK.

Outside React, use `pepuMulticall(client, calls)`. See [Batch Reads with Multicall3](batch-reads-with-multicall3.md).

## What to expect

- One RPC request for all contract reads. Results come back in order, each `{ status, result }` or `{ status, error }` when `allowFailure` is true.
- A failing token (not an ERC-20, for example) returns a failure entry for that call and does not fail the batch.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Reads return nothing or the batch errors | A hand-written chain definition uses the canonical address | Use `pepuMainnet` from the SDK |
| The embedded wallet's balance is not shown | Wagmi's active account is an extension | Keep the active-wallet pin on ([Provision the Wallet and Pin the Active Account](provision-and-pin-the-wallet.md)) |

## Related

- [Batch Reads with Multicall3](batch-reads-with-multicall3.md)
- [The Multicall3 Trap](../contracts/multicall3.md)
- [Core](../sdk/core.md#multicall3-and-permit2)
