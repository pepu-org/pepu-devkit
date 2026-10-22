# /privy/wagmi

`@pepu-chain/sdk/privy/wagmi` is the wagmi layer: a wagmi config for PEPU built with `@privy-io/wagmi`, one provider that mounts Privy, react-query and wagmi in the order Privy requires, and the active-wallet pin. Use it when your app reads and writes with wagmi hooks.

This entry is ESM-only because `@privy-io/wagmi` ships no CommonJS build.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/privy/wagmi` |
| Server or client | Client only (React) |
| Peer dependencies | `react`, `@privy-io/react-auth`, `@privy-io/wagmi` `^4.0.0`, `wagmi` `^3.0.0`, `@tanstack/react-query` `^5.0.0` |
| Module format | ESM only. There is no `require` condition |
| Pillar | Google to wallet |

## Exports

| Export | Signature | What it abstracts |
|---|---|---|
| `PepuPrivyWagmiProvider` | `(p: PepuPrivyWagmiProviderProps) => ReactElement` | `PepuPrivyProvider` plus react-query plus `@privy-io/wagmi`'s `WagmiProvider`, with the pin mounted. Props: everything on `PepuPrivyProvider` except `wrapper`, plus `wagmiConfig?`, `queryClient?`, `pinEmbeddedWallet?` |
| `pepuWagmiConfig` | `(o?: { chain?: PepuChain; rpcUrl?: string }) => Config` | A wagmi config for PEPU built with `@privy-io/wagmi`'s `createConfig`. Plain wagmi's `createConfig` is a footgun with Privy: the embedded wallet would not appear as a connector |
| `useActiveWalletPin` | `(o?: { enabled?: boolean }) => void` | Keeps wagmi's active account pinned to the embedded wallet, so an extension such as Phantom cannot silently become the account |
| `EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT` | `true` | Default policy for the pin |

`pepuMainnet` carries `contracts.multicall3` at PEPU's own address, so `useReadContracts` batches with no extra configuration.

## Errors

None thrown. A missing `appId` renders the provider's `fallback` instead of throwing.

## Example

```tsx
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()}
      config={{ loginMethods: ["email", "google", "wallet"] }}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}
```

The same provider is compiled in `docs/snippets/login-providers.tsx` (see [/privy/react](privy-react.md)), and a wagmi read is in `docs/snippets/multicall-in-react.tsx` (see [Batch Reads with Multicall3 in React](../recipes/multicall-in-react.md)).

To opt out of the pin for an external-wallet-first app, pass `pinEmbeddedWallet={false}` to the provider or `{ enabled: false }` to the hook.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The embedded wallet is not a connector | Plain `wagmi` `createConfig` or `WagmiProvider` was used | Use `pepuWagmiConfig` and this provider |
| Balance reads show another address | An extension became the active account | Keep the pin on, and compare `useAccount().address` with `useEmbeddedWallet().address` before labeling it "your wallet" |
| `Cannot find module` for `require("@pepu-chain/sdk/privy/wagmi")` | The entry is ESM only | `import` it, or use dynamic `import()` from CommonJS |

## Related

- [/privy/react](privy-react.md), [/privy](privy.md)
- [Provision the Wallet and Pin the Active Account](../recipes/provision-and-pin-the-wallet.md)
- [Batch Reads with Multicall3 in React](../recipes/multicall-in-react.md)
