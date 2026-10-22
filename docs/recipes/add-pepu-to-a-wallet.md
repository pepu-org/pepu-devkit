# Recipe: Add PEPU to a Wallet

A one-click "Add Network" for Pepe Unchained V2 mainnet, using the SDK instead of a hand-written `wallet_addEthereumChain` payload.

`toAddEthereumChainParameter` produces the standard EIP-3085 payload (`chainId` `0x17dcd` for 97741) and `switchOrAddPepuChain` implements the EIP-3326 fallback.

## Prerequisites

`@pepu-chain/sdk` and an injected EIP-1193 wallet (MetaMask and compatible).

## Steps

`switchOrAddPepuChain(provider, chain)` tries `wallet_switchEthereumChain` and, on error `4902` (chain not recognized), adds the chain with `wallet_addEthereumChain`. viem's own `switchChain` does not add a missing chain. Any other error, such as the user rejecting the prompt, is rethrown unchanged. `toAddEthereumChainParameter(chain)` builds the payload if you want to send it yourself.

```ts
// Add PEPU to an injected wallet. See docs/recipes/add-pepu-to-a-wallet.md
import { pepuMainnet, switchOrAddPepuChain, toAddEthereumChainParameter } from "@pepu-chain/sdk";
import type { EIP1193Provider } from "viem";

export function manualParameter() {
  // The exact object wallet_addEthereumChain expects (chainId is "0x17dcd").
  return toAddEthereumChainParameter(pepuMainnet);
}

export async function addAndSwitch(): Promise<void> {
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No injected wallet found");
  await switchOrAddPepuChain(provider, pepuMainnet);
}
```

Source: `docs/snippets/add-pepu-to-wallet.ts`, type-checked against the SDK.

### React button

```tsx
import { useState } from "react";
import { addAndSwitch } from "./add-pepu-to-wallet";

export function AddPepuButton() {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        onClick={() =>
          addAndSwitch().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to add network"))
        }
      >
        Add Pepe Unchained to Wallet
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

### With wagmi

If the wallet is connected through wagmi, `useSwitchChain` adds the chain automatically when it is in your config's `chains`:

```tsx
import { useSwitchChain } from "wagmi";
import { pepuMainnet } from "@pepu-chain/sdk";

export function SwitchToPepuButton() {
  const { switchChain } = useSwitchChain();
  return <button onClick={() => switchChain({ chainId: pepuMainnet.id })}>Switch to Pepe Unchained</button>;
}
```

## Manual entry

| Field | Value |
|---|---|
| Network Name | Pepe Unchained V2 |
| RPC URL | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` |
| Chain ID | `97741` |
| Currency Symbol | PEPU |
| Block Explorer URL | `https://pepuscan.com` |

Do not offer testnet here: it is out of scope. See [Network Reference](../get-started/network-reference.md#testnet-out-of-scope-today).

## What to expect

A wallet that already has the chain switches silently. One that does not asks the user to approve adding it, then switches.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| "No injected wallet found" | No extension, or a mobile browser without one | Offer manual entry or a WalletConnect-style flow |
| The helper rethrows | The user rejected, or the wallet uses a non-standard error code | Show the message; offer manual entry |
| `switchChain` errors in wagmi | The chain is not in `createConfig`'s `chains` | Add `pepuMainnet` |

## Related

- [Network Reference](../get-started/network-reference.md)
- [Core](../sdk/core.md#chains-and-clients)
