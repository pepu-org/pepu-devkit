# Recipe: Explorer Links

Build pepuscan links for transactions, addresses, tokens and blocks, and link a sponsored UserOperation correctly.

> Status: proven. pepuscan is PEPU mainnet's Blockscout explorer at `https://pepuscan.com`.

## Prerequisites

`@pepu-chain/sdk` and `pepuMainnet`. No React, no network call: link building is pure.

## Steps

Use the shorthand for the resource you have: `txUrl`, `addressUrl`, `tokenUrl`, `blockUrl`, or `explorerUrl(chain, type, value)` for the generic form. For a bundle of links at once use `explorerLinks`.

A UserOperation has no page of its own on pepuscan. Link its bundle transaction (`result.transactionHash`) and its sender (the smart account address). `SponsoredResult.explorerUrl` and the combo `act` response already carry the bundle transaction URL.

```ts
// Build pepuscan links. See docs/recipes/explorer-links.md
import { addressUrl, blockUrl, explorerLinks, explorerUrl, pepuMainnet, tokenUrl, txUrl } from "@pepu-chain/sdk";
import type { SponsoredResult } from "@pepu-chain/sdk/aa";

export const single = {
  tx: (hash: string) => txUrl(pepuMainnet, hash),
  address: (a: string) => addressUrl(pepuMainnet, a),
  token: (a: string) => tokenUrl(pepuMainnet, a),
  block: (n: number) => blockUrl(pepuMainnet, n),
  generic: (hash: string) => explorerUrl(pepuMainnet, "tx", hash),
};

// A UserOperation has no page of its own on pepuscan: link its bundle transaction
// and its sender (the smart account).
export function userOpLinks(result: SponsoredResult, smartAccount: string) {
  return explorerLinks({ tx: result.transactionHash, sender: smartAccount });
}
```

Source: `docs/snippets/explorer-links.ts`, type-checked against the SDK.

## What to expect

- `txUrl(pepuMainnet, hash)` gives `https://pepuscan.com/tx/<hash>`.
- `explorerLinks({ tx, sender })` returns only the keys you passed.
- `explorerUrl` throws for a chain with no explorer (`pepuTestnet`). Wrap the call if you need a soft failure.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `explorerUrl: no block explorer is configured` | You passed `pepuTestnet` | Use `pepuMainnet` |
| A link to `/userop/...` 404s | Blockscout on PEPU has no UserOperation page | Link the transaction and sender instead |
| Block link by hash fails | Hash passed as a number | Pass the hash as a string |

## Related

- [Core](../sdk/core.md#explorer-links)
- [Send a Sponsored Transaction](sponsored-send.md)
- [Send a Transaction](send-a-transaction.md)
