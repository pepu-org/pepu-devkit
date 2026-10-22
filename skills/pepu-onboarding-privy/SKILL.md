---
name: pepu-onboarding-privy
description: Google login (and email) with a server-provisioned Privy embedded wallet on Pepe Unchained (PEPU) V2 mainnet (chain 97741), built entirely from @pepu-chain/sdk: PepuPrivyWagmiProvider or PepuPrivyProvider, WalletGate, createEnsureWalletRoute, requireUser, usePepuAuthFetch, useEmbeddedWallet. Gives complete working code, the Privy dashboard settings field by field (allowed origin with exact port, Google, embedded wallets, secrets), and the troubleshooting for login hangs, a wallet that never appears, and the wrong active account. Use whenever adding sign-in or wallets to a PEPU app, debugging Privy login or wallet creation, or protecting an API route by user. For popup-free actions see pepu-session-keys, for gasless see pepu-sponsored-transactions.
---

# Google login to a wallet on PEPU

Pillar 1 of the PEPU dev kit: a user signs in with Google and gets a self-custodial Privy embedded wallet on chain 97741,
with no wallet extension. Everything below is SDK code; do not hand-write Privy config, wallet creation or token checks.

## When to use

- A new or existing Next.js (App Router) app needs sign-in and a wallet. Scaffold first if the app does not exist
  (`pepu-build-dapp`): every template already contains this wiring.
- Login hangs, "Creating your wallet" spins forever, the wallet never shows up, or balances belong to MetaMask.
- An API route must know which user is calling.

The user pays their own gas here. For popup-free actions use `pepu-session-keys`;
for gas paid by a paymaster use `pepu-sponsored-transactions`.

## Chain facts

Chain 97741, mainnet only, native PEPU (18 decimals), explorer pepuscan.com, PEPU Multicall3 (not the canonical one).
The full table, generated from the SDK, is in [reference/chain-facts.md](reference/chain-facts.md). The rules for working
with the SDK are in [reference/rules.md](reference/rules.md).

## SDK functions to use

```tsx
// client
import { PepuPrivyProvider, WalletGate, useEmbeddedWallet, usePepuAuthFetch } from "@pepu-chain/sdk/privy/react";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi"; // ESM only; use instead of PepuPrivyProvider when you use wagmi
import { createPepuPrivyConfig, PRIVY_ENV, PEPU_PRIVY_REQUIREMENTS } from "@pepu-chain/sdk/privy";
// server
import { createEnsureWalletRoute, requireUser, verifyRequestUser } from "@pepu-chain/sdk/privy/server";
// checks
import { checkPepuEnv } from "@pepu-chain/sdk/doctor";
```

Peers to install: `@privy-io/react-auth`, `@privy-io/node`; with wagmi also `@privy-io/wagmi`, `wagmi`, `@tanstack/react-query`.

## MCP tools to call first

1. `pepu_list_templates` then `pepu_scaffold_app` when starting from nothing (`consumer-app` is this pillar).
2. `pepu_sdk_snippet` with `task: "privy-provider"`, `"ensure-wallet-route"` or `"wagmi-privy"` for the canonical files.
3. `pepu_check_env` with `projectDir` and `template: "consumer-app"`: reports `ok/missing/placeholder/malformed` per key, never values.
4. `pepu_check_privy_config` with `appId`, `origin` (with the port) and `pillars: ["login"]`: allowed origin, login methods, embedded wallets.

## Steps

The agent does all of these; only the Privy dashboard and the two secrets need the user.

### 1. Install and set the environment

```bash
pnpm add @pepu-chain/sdk @privy-io/react-auth @privy-io/node
# with wagmi:  pnpm add @privy-io/wagmi wagmi @tanstack/react-query viem
```

`.env.local` (ask the user for the two values; see "Privy dashboard" below):

```
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
```

`NEXT_PUBLIC_PRIVY_APP_ID` is public. `PRIVY_APP_SECRET` is server-only: never prefix it with `NEXT_PUBLIC_`, never print it.

### 2. Provider, with the wallet gate (`app/providers.tsx`)

```tsx
"use client";
import type { ReactNode } from "react";
import { PepuPrivyProvider, WalletGate } from "@pepu-chain/sdk/privy/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{ loginMethods: ["google", "email"] }}
    >
      {/* Provisions the embedded wallet through /api/wallet/ensure, then renders children. */}
      <WalletGate>{children}</WalletGate>
    </PepuPrivyProvider>
  );
}
```

With wagmi (hooks like `useBalance`, `useSendTransaction`), swap the provider. It mounts Privy, react-query and wagmi in
the order Privy requires and pins the embedded wallet as wagmi's active account:

```tsx
"use client";
import type { ReactNode } from "react";
import { WalletGate } from "@pepu-chain/sdk/privy/react";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{ loginMethods: ["google", "email", "wallet"] }}
    >
      <WalletGate>{children}</WalletGate>
    </PepuPrivyWagmiProvider>
  );
}
```

Both render a notice instead of crashing when the app id is unset. `PepuPrivyProvider` pins mainnet only, Coinbase to `eoaOnly`
(Coinbase Smart Wallet does not support 97741) and `createOnLogin: "off"`. Render `<Providers>` in `app/layout.tsx`.
`WalletGate` accepts `loading`, `error={(e, retry) => ...}` and `endpoint` props to restyle it.

### 3. The ensure-wallet route (`app/api/wallet/ensure/route.ts`)

```ts
import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";

export const { POST } = createEnsureWalletRoute();
```

It verifies the caller's access token, creates an Ethereum wallet owned by the user (`owner: { user_id }`, so your backend holds
no signing authority over it) only if none exists, and survives double submits. `onCreated` is an optional hook.

### 4. Know who is calling, in any route

```ts
// app/api/me/route.ts
import { requireUser } from "@pepu-chain/sdk/privy/server";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response; // ready JSON error: 401, 500 or 502
  return Response.json({ userId: auth.user.userId, address: auth.user.address });
}
```

The user id comes only from the verified token, never from the body. Use `verifyRequestUser(request)` when you only need the id.

### 5. Use the wallet in the browser

```tsx
"use client";
import { useEffect, useState } from "react";
import { useEmbeddedWallet, usePepuAuthFetch } from "@pepu-chain/sdk/privy/react";
import { explorerLinks } from "@pepu-chain/sdk";

export function Account() {
  const { address } = useEmbeddedWallet();       // the embedded wallet, never an extension
  const authFetch = usePepuAuthFetch();          // adds Authorization: Bearer <Privy access token>
  const [me, setMe] = useState<{ userId: string } | null>(null);

  useEffect(() => {
    void authFetch("/api/me").then((r) => r.json()).then(setMe);
  }, [authFetch]);

  if (!address) return null;
  return (
    <p>
      {me?.userId} <a href={explorerLinks({ address }).address}>{address}</a>
    </p>
  );
}
```

Login itself is Privy's `usePrivy().login()` (import `usePrivy` from `@privy-io/react-auth`).

## Privy dashboard settings, field by field

Open [dashboard.privy.io](https://dashboard.privy.io), choose the app. Menu labels move; the SDK's own table
(`PEPU_PRIVY_REQUIREMENTS`, also returned by `pepu_check_privy_config`) is the checklist of record.

| Where | Field | Value | Why |
|---|---|---|---|
| Settings, Basics | App ID | copy to `NEXT_PUBLIC_PRIVY_APP_ID` | public identifier |
| Settings, Basics | App secret | create one, copy to `PRIVY_APP_SECRET` | the ensure route and `requireUser` need it; server only |
| Configuration, App settings | Allowed origins | add the exact origin with scheme and port, for example `http://localhost:3000`, plus the production origin | a different port is a different origin. Next.js silently moves to 3001 when 3000 is taken, then the login iframe is blocked and OAuth init returns 403 |
| User management, Authentication | Login methods | enable every method you list in `loginMethods` | methods not enabled here are hidden even if listed in code |
| User management, Authentication, Socials | Google | on | the code-side `"google"` only shows if this is on |
| Wallets | Embedded wallets, Ethereum | on | the wallet is created here |
| Wallets | "Automatically create embedded wallets on login" | either value works | the dashboard wins over code. `WalletGate` plus the ensure route provision the wallet regardless; the route is idempotent |
| Wallets | Execution mode | TEE (`user-controlled-server-wallets-only`) is the recommended setting | Not checked as a requirement; other modes are not covered here |
| Wallets, Smart wallets | not needed | leave off | only the Privy Smart Wallets sponsorship transport uses it (`pepu-sponsored-transactions`) |

Coinbase is not a dashboard field: the provider pins `eoaOnly` in code.
Run `pepu_check_privy_config` after every change. Fields Privy's public config does not expose come back `unknown`, not `fail`.

## Verify

1. `pepu_check_env` (template `consumer-app`) returns no `missing` or `placeholder` for the Privy keys.
2. `pepu_check_privy_config` with the real origin passes `allowed-origins`, `login-methods` and `embedded-wallets`.
3. `npm run doctor` (every template defines it; the SDK's `checkPepuEnv` against `.env.local`; prints no values).
4. `npm run typecheck && npm run build`, then `npm run dev`, sign in, and see an address from `useEmbeddedWallet`.
5. The address on `explorerLinks({ address }).address` opens on pepuscan.

## Pitfalls

- **Login fails or loops:** the origin including the port is not in Allowed origins, or the dev server moved ports. Free the port, or add the new origin.
- **"Creating your wallet / Please wait" never ends:** Privy's modal conflicts with the dashboard's execution and recovery settings. The SDK avoids it
  (`createOnLogin: "off"`, server creation). If you see it, a custom `PrivyProvider` is in use: replace it with `PepuPrivyProvider`.
- **`WalletGate` says stalled:** the wallet exists but this session has not seen it yet. Reload; it is a client sync delay, not a lost wallet.
- **Balances or sends use the wrong address:** an extension (MetaMask, Phantom) became the active wagmi account. Use `PepuPrivyWagmiProvider`
  (it pins the embedded wallet) or call `useActiveWalletPin()` once near the root. Gate on the embedded wallet, never on "any connected wallet".
- **Console "configured chains are not supported by Coinbase Smart Wallet: 97741":** Coinbase is not on `eoaOnly`. Use the SDK provider.
- **500 from `/api/wallet/ensure`:** `PRIVY_APP_SECRET` is unset on the server. `explainError(e)` gives the cause and fix.
- **Privy's own gas pre-check refuses a send the wallet can afford:** PEPU's base fee is high in gwei. The templates therefore have no "Max" button; for other UIs size it with `maxSendableAmount()` from `@pepu-chain/sdk` and expect Privy's modal to have the final say.
- **"Unable to fetch token price" in the console:** harmless.
- **`/privy/wagmi` fails in a CommonJS build:** it is ESM only.
- For any error text, call `pepu_explain_error` (SDK `explainError`).

## Never hand-roll

Do not write a `PrivyProvider` config, a `defineChain` for PEPU, a wallet-creation call after login, a "wait for wallet" loop, bearer-token verification,
a manual `Authorization` header, or a wagmi active-account effect. Use `PepuPrivyProvider` or `PepuPrivyWagmiProvider`, `createEnsureWalletRoute`,
`WalletGate`, `requireUser`, `usePepuAuthFetch`. The full list is in [reference/rules.md](reference/rules.md).

The runnable reference for this skill is `templates/consumer-app`. Next: `pepu-session-keys`, `pepu-sponsored-transactions`, `pepu-sponsored-session`.
