# Provision the Wallet and Pin the Active Account

Two things go wrong between "the user signed in with Google" and "the user's wallet is the account the app acts on". This recipe covers both. It is what the `consumer-app` template uses, now as SDK exports.

1. **The embedded wallet may not exist yet.** Privy's own "Creating your wallet / Please wait..." modal can hang forever for an app whose Dashboard mixes TEE execution with a stale on-device recovery setting. The fix is to create the wallet yourself, server-side.
2. **The wrong wallet can become the active account.** An installed browser extension (MetaMask, Phantom) can auto-connect and become wagmi's active account, so balance reads and sends silently go to the extension's address, not the embedded wallet the user was just shown.

The SDK ships all three pieces, ported from the `consumer-app` template: `createEnsureWalletRoute`, `WalletGate` and the active-wallet pin.

## Prerequisites

`@pepu-chain/sdk`, `@privy-io/react-auth`, `@privy-io/node` (server) and `PRIVY_APP_SECRET` plus `NEXT_PUBLIC_PRIVY_APP_ID`. For wagmi also `@privy-io/wagmi`, `wagmi` and `@tanstack/react-query`.

## Part 1: provision the wallet server-side

### The config

Set `createOnLogin: "off"` so Privy's login modal never attempts wallet creation. `createPepuPrivyConfig` does this by default, and `PepuPrivyProvider` and `PepuPrivyWagmiProvider` call it for you:

```tsx
import { createPepuPrivyConfig } from "@pepu-chain/sdk/privy";

export const privyConfig = createPepuPrivyConfig({ loginMethods: ["email", "google", "wallet"] });
```

**The Privy Dashboard setting wins.** The `createOnLogin` value in code is very likely inert at runtime: the resolved app config takes it from the Dashboard's embedded wallet settings. Keep the code value for intent, but check the Dashboard when behavior does not match. See [Privy Setup](../onboarding/privy-setup.md#automatically-create-embedded-wallets-on-login).

### The route: `POST /api/wallet/ensure`

One line from the SDK. The route:

1. Refuses with `500` (`CONFIG_MISSING_ENV`) if `PRIVY_APP_SECRET` is not set. The secret is server-only and must never be a `NEXT_PUBLIC_` variable.
2. Verifies the caller's Privy access token and takes the user id from it, never from the request body.
3. Returns `{ address, created: false }` if the user already has an Ethereum embedded wallet.
4. Otherwise creates one with `owner: { user_id }` and returns `{ address, created: true }`.
5. If the create fails, re-checks for a concurrent request that already created it, so a double submit never makes a second wallet.

**Custody.** The wallet is owned by the user. Your backend holds no signing authority over it. Do not add a session signer in this route.

```ts
// Pillar 1, server: provision the embedded wallet and authenticate requests.
// SERVER ONLY (reads PRIVY_APP_SECRET). See docs/sdk/privy-server.md
import { createEnsureWalletRoute, requireUser } from "@pepu-chain/sdk/privy/server";

// app/api/wallet/ensure/route.ts
export const { POST } = createEnsureWalletRoute();

// Any other authenticated route handler. The user id comes only from the
// verified Privy access token, never from the request body.
export async function whoAmI(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response; // ready-made JSON error with the right status
  return Response.json({ userId: auth.user.userId, address: auth.user.address });
}
```

Source: `docs/snippets/ensure-wallet-route.ts`, type-checked against the SDK.

### The component: `WalletGate`

`WalletGate` wraps the signed-in part of the app. For an authenticated user with no embedded wallet it calls your ensure route with a bounded timeout, refreshes the user so the wallet appears without a reload, and shows `loading`, `error` (with retry) or `stalled` (wallet exists but this session has not synced it; offers a reload) through render props. It gates on the **embedded** wallet, never on "any wallet": `useWallets()` can be non-empty for a user with no wallet in their Privy account, because an extension can be tracked without being linked.

## Part 2: pin the embedded wallet as the active account

An installed extension (MetaMask, Phantom) can become wagmi's active account, so balance reads and sends silently go to the extension's address. `useActiveWalletPin` from `@pepu-chain/sdk/privy/wagmi` re-asserts the embedded wallet whenever the active account drifts. `PepuPrivyWagmiProvider` already mounts it.

```tsx
// Provision the embedded wallet and keep it the active account.
// See docs/recipes/provision-and-pin-the-wallet.md
import type { ReactNode } from "react";
import { useActiveWalletPin } from "@pepu-chain/sdk/privy/wagmi";
import { WalletGate, useEmbeddedWallet, useEnsureWallet } from "@pepu-chain/sdk/privy/react";

// Inside PepuPrivyWagmiProvider the pin is already mounted. Call this yourself only when you
// built your own provider tree.
export function Pin(): null {
  useActiveWalletPin();
  return null;
}

// The hook behind WalletGate, for custom UI.
export function Custom({ children }: { children: ReactNode }) {
  const { status, address, error, retry } = useEnsureWallet({ endpoint: "/api/wallet/ensure" });
  const { external } = useEmbeddedWallet();

  if (status === "error") return <button onClick={retry}>{error?.message}</button>;
  if (status !== "ready") return <p>{status}</p>;
  return (
    <div>
      <p>Embedded wallet {address}. External wallets tracked by Privy: {external.length}</p>
      {children}
    </div>
  );
}

// Or the finished component.
export const Gated = ({ children }: { children: ReactNode }) => <WalletGate>{children}</WalletGate>;
```

Source: `docs/snippets/provision-and-pin.tsx`, type-checked against the SDK.

Details that matter:

- **The guard prevents a render loop.** `shouldPinEmbeddedWallet` only says yes when the active address differs from the embedded one.
- **It runs continuously, not once.** An extension can auto-connect or switch accounts well after first render.
- **No embedded wallet means no action.** A user who signed in with an external wallet keeps it.
- **Opt out deliberately** with `pinEmbeddedWallet={false}` or `useActiveWalletPin({ enabled: false })`.

Never label wagmi's `useAccount()` address "your embedded wallet" without comparing it to `useEmbeddedWallet().address`.

## What to expect

After sign-in a new user sees a short "setting up" state, then the app with `useEmbeddedWallet().address` set. Returning users skip straight through.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Privy's "Creating your wallet" modal hangs | Dashboard creation setting is on or stale, and Privy's client-side creation hangs | Keep `createOnLogin: "off"` and turn automatic creation off in the Dashboard; provision server-side |
| `AUTH_INVALID_TOKEN` from the ensure route | `PRIVY_APP_SECRET` is for a different app | Use the secret from the same app as the app id |
| Balance or sends use the wrong address | An extension became the active account | Keep the pin on |
| `WalletGate` stays on the reload prompt | The wallet exists but this session has not synced | Reload |

## Related

- [/privy/react](../sdk/privy-react.md), [/privy/wagmi](../sdk/privy-wagmi.md), [/privy/server](../sdk/privy-server.md)
- [Privy Setup](../onboarding/privy-setup.md)
- [Social Login & Embedded Wallets (Privy)](../onboarding/privy-embedded-wallets.md)
- [Troubleshooting](../troubleshooting.md): "Creating your wallet..." never finishes
