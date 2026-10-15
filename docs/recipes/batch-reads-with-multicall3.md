# Recipe: Batch Reads with Multicall3

Read many values in one request. PEPU has Multicall3, but not at the canonical address, so this recipe uses the SDK to pin the right one.

> Status: proven on mainnet. PEPU's Multicall3 is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`. The canonical `0xcA11bde05977b3631167028862bE2a173976CA11` has no code on PEPU.

Read [The Multicall3 Trap](../contracts/multicall3.md) first if you have not.

## Prerequisites

`@pepu-chain/sdk` and `viem`.

## Steps

`pepuMulticall(client, calls, { allowFailure?, blockNumber? })` is viem's `multicall` pinned to PEPU's address. It goes through `getMulticall3`, which throws `MULTICALL3_CANONICAL_ADDRESS` rather than ever use the canonical one.

```ts
// Batch reads through PEPU's own Multicall3. See docs/recipes/batch-reads-with-multicall3.md
import { erc20Abi, getAddress } from "viem";
import { getPublicClient, pepuMainnet, pepuMulticall, pepuTokenList } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);

export async function readTokens(holder: `0x${string}`) {
  const tokens = pepuTokenList.tokens.map((t) => getAddress(t.address));

  // pepuMulticall pins the Multicall3 address; the canonical one has no code on PEPU.
  const results = await pepuMulticall(
    client,
    tokens.flatMap(
      (address) =>
        [
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
        ] as const,
    ),
    { allowFailure: true },
  );

  return results.map((r) => (r.status === "success" ? r.result : null));
}
```

Source: `docs/snippets/multicall-batch-reads.ts`, type-checked against the SDK.

Plain viem works too, because `pepuMainnet.contracts.multicall3` already holds PEPU's address: `client.multicall({ contracts })` on a client from `getPublicClient(pepuMainnet)` batches correctly. Use `pepuMulticall` when you want the guard.

In React with wagmi see [Batch Reads with Multicall3 in React](multicall-in-react.md).

### Calling `aggregate3` yourself

For per-call failure control, `encodeAggregate3(calls)` and `decodeAggregate3Result(data)` wrap the `aggregate3` ABI. The contract is a normal Multicall3 deployment; only the address differs from other chains.

### Without the SDK

Set `contracts.multicall3` explicitly in your chain definition, with `address: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd"` and `blockCreated: 10521048`. Never substitute the canonical address.

## What to expect

- One RPC round trip for all calls. Results are in order, each with a `status`.
- With `allowFailure: false` a failing call rejects the whole batch.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Every batched call fails | Routed through the canonical address | Use `pepuMainnet` or `pepuMulticall` |
| `MULTICALL3_CANONICAL_ADDRESS` | The canonical address reached `getMulticall3` | Use the registry entry, never a literal |
| `UNKNOWN` "Multicall3 is not deployed" | A non-mainnet chain ID | Use chain 97741 |

## Related

- [The Multicall3 Trap](../contracts/multicall3.md)
- [Batch Reads with Multicall3 in React](multicall-in-react.md)
- [Gate Content by Token Balance](gate-content-by-token-balance.md)
- [Core](../sdk/core.md#multicall3-and-permit2)
