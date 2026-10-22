# /privy/react

`@pepu-chain/sdk/privy/react` is the React layer for Google to wallet: a PEPU-configured Privy provider, the embedded-wallet hook, the server-provisioning gate, the active-wallet pin and an authenticated `fetch`. Use it when you do not need wagmi. With wagmi use [/privy/wagmi](privy-wagmi.md), which builds on this entry.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/privy/react` |
| Server or client | Client only (React) |
| Peer dependencies | `react`, `@privy-io/react-auth` `^3.44.0` |
| Pillar | Google to wallet |

## Exports

| Export | Signature | What it abstracts |
|---|---|---|
| `PepuPrivyProvider` | `(props: PepuPrivyProviderProps) => ReactElement` | `<PrivyProvider>` with PEPU mainnet only, Coinbase `eoaOnly`, wallet creation off. Renders `fallback` instead of crashing when `appId` is empty. Props: `appId`, `config?`, `fallback?`, `wrapper?`, `children` |
| `useEmbeddedWallet` | `() => { ready: boolean; wallet: ConnectedWallet \| null; address?: Address; external: ConnectedWallet[] }` | The user's embedded wallet, separated from an installed extension Privy tracks. Uses Privy's own `getEmbeddedConnectedWallet` |
| `useEnsureWallet` | `(o?: { endpoint?; requestTimeoutMs?; appearTimeoutMs? }) => { status: EnsureWalletStatus; address?; error?: PepuError; retry() }` | Provisions the wallet through your ensure route, not Privy's client-side creation, which hangs when the dashboard creation setting is off. `status`: `idle`, `checking`, `creating`, `ready`, `stalled`, `error` |
| `WalletGate` | `(p: { endpoint?; loading?: ReactNode; error?: (e, retry) => ReactNode; stalled?: (address, reload) => ReactNode; children }) => ReactElement` | Renders children once the embedded wallet exists, with a render prop for each of the three non-ready states |
| `requestEnsureWallet` | `(o: { getAccessToken; endpoint?; timeoutMs?; fetch?; signal? }) => Promise<{ address: Address; created: boolean }>` | The bare POST used by the hook. Bounded by a timeout, never leaks the token |
| `usePepuAuthFetch` | `() => (input, init?) => Promise<Response>` | A `fetch` that adds `Authorization: Bearer <Privy access token>` |
| `usePinEmbeddedWallet` | `(o: { enabled; activeAddress; setActiveWallet }) => void` | Generic half of the active-wallet pin |
| `shouldPinEmbeddedWallet` | `(o: { enabled; ready; embeddedAddress; activeAddress }) => boolean` | The pure decision, so the pin cannot loop |
| `composeProviders` | `(layers, leaves?) => ComponentType` | Building block used by `/privy/wagmi` |
| Types | `PepuPrivyProviderProps`, `EnsureWalletStatus` | |

## Errors

| Code | Where |
|---|---|
| `AUTH_INVALID_TOKEN` | `usePepuAuthFetch` and `requestEnsureWallet` when there is no access token (signed out or expired) |
| `WALLET_NOT_PROVISIONED` | The ensure route answered but returned no wallet |
| `CONFIG_MISSING_ENV` | Surfaced from the ensure route when `PRIVY_APP_SECRET` is unset |

## Example

```tsx
// Pillar 1, client: Google sign-in and an embedded wallet.
// See docs/sdk/privy-react.md and docs/onboarding/privy-embedded-wallets.md
import type { ReactNode } from "react";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";
import { WalletGate, useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      // Read literally so the framework inlines it into the browser bundle.
      appId={process.env["NEXT_PUBLIC_PRIVY_APP_ID"]?.trim()}
      config={{ loginMethods: ["email", "google", "wallet"] }}
      fallback={<p>Set NEXT_PUBLIC_PRIVY_APP_ID</p>}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}

function Address() {
  const { address } = useEmbeddedWallet();
  return <code>{address}</code>;
}

// Renders children once the embedded wallet exists, provisioning it through
// the ensure-wallet route (see ensure-wallet-route.ts) if needed.
export function Gated() {
  return (
    <WalletGate
      loading={<p>Setting up your wallet</p>}
      error={(e, retry) => (
        <button onClick={retry}>
          {e.message} Retry
        </button>
      )}
      stalled={(address, reload) => <button onClick={reload}>Wallet {address} is ready, reload</button>}
    >
      <Address />
    </WalletGate>
  );
}
```

Source: `docs/snippets/login-providers.tsx`, type-checked against the SDK.

The matching server route is in [/privy/server](privy-server.md). The pin and the gate together are in [Provision the Wallet and Pin the Active Account](../recipes/provision-and-pin-the-wallet.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| A notice instead of the app | `appId` is empty, so the provider rendered `fallback` | Set `NEXT_PUBLIC_PRIVY_APP_ID` and read it as a literal `process.env.NEXT_PUBLIC_PRIVY_APP_ID` so the framework inlines it |
| `WalletGate` stays on `stalled` | The server created the wallet but this session has not synced it | Call `reload`; the gate offers it through the `stalled` render prop |
| Gate skips provisioning for a user with only an extension | Gating on `wallets.length > 0` | Gate on the embedded wallet, which is what `useEnsureWallet` does |
| `AUTH_INVALID_TOKEN` from the ensure route | `PRIVY_APP_SECRET` does not match the app, which looks identical to an expired session | Check the secret first |

## Related

- [/privy](privy.md), [/privy/wagmi](privy-wagmi.md), [/privy/server](privy-server.md)
- [Social Login and Embedded Wallets (Privy)](../onboarding/privy-embedded-wallets.md)
- [The Two-Address Model](../onboarding/two-address-model.md)
