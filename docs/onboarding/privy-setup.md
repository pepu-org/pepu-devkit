# Privy Setup

This page is the short first-time walkthrough for [Privy](https://privy.io). The complete table of every dashboard field, with exact values and failure symptoms, is [Dashboard Settings, Field by Field](../privy/dashboard-settings.md); authorization keys are in [Authorization Keys and Key Quorums](../privy/authorization-keys.md); verification is in [Privy Env Vars and Verification](../privy/env-and-checks.md). This page is the setup guide for using [Privy](https://privy.io) with Pepe Unchained V2: the Dashboard settings that decide whether login works, the code configuration, and the failures you are most likely to hit. Most of it was learned the hard way during live testing on mainnet, so it is more specific than Privy's own docs.

If you used `create-pepu-app`, the code configuration is already done. The Dashboard settings below are not: they live in your Privy app, not in your repository.

## What is proven

All three onboarding pillars have been exercised live on PEPU mainnet:

| Pillar | State |
|---|---|
| Google login and an embedded wallet | Proven. You can use it today. |
| Session signers for popup-free transactions | Proven. You can use it today. See [Session Keys](session-keys.md). |
| Gas sponsorship | Proven end to end through the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`); the v2 paymaster is a canary, external audit pending. You need a funded project. See [Sponsored Transactions](sponsored-transactions.md). |
| Kernel session plus sponsorship (the combination) | Proven live in a browser on mainnet (2026-10-14). See [End to End](google-session-sponsored.md). |

## 1. Create the app and set the environment

1. Go to [dashboard.privy.io](https://dashboard.privy.io), sign up and create an app.
2. Copy the **App ID** and the **App Secret** from the app's settings.
3. Put them in `.env.local`:

```
NEXT_PUBLIC_PRIVY_APP_ID=your-app-id-here
PRIVY_APP_SECRET=your-app-secret-here
```

The App ID is public by design (it is bundled into client JavaScript). The App Secret is server-only: never give it a `NEXT_PUBLIC_` prefix and never commit it. The templates use it in `POST /api/wallet/ensure` to verify the caller's access token and create their embedded wallet after login.

## 2. Dashboard settings that matter

### Allowed origins must include the exact port

Privy matches the full origin: scheme, host **and port**. For local development that means:

```
http://localhost:3000
```

`http://localhost` with no port is a different origin (an unspecified `http` port means 80), so it will not match.

The trap: if port 3000 is already in use, Next.js does not stop. It silently starts on 3001 instead, and login then fails with errors that do not mention the port (the login iframe is blocked by a CSP `frame-ancestors` rule, and OAuth init returns a 403). Free port 3000 rather than working around it with `-p 3001`. If you deliberately use another port, add that exact origin to **Allowed origins** first. Add your production origin the same way before you deploy.

### Automatically create embedded wallets on login

Turn on **Automatically create embedded wallets on login** in the Dashboard. The `createOnLogin` value you pass to `<PrivyProvider>` does not override the Dashboard: the Dashboard wins.

The templates also provision the wallet server-side right after login, through their own `POST /api/wallet/ensure` route (Privy's documented "pregenerate wallets" pattern, using `@privy-io/node` and your App Secret). That is a fallback for apps where the Dashboard setting is off or Privy's client-side creation screen stalls: without it, the user would sit on "Creating your wallet..." indefinitely. It creates a wallet owned by the signed-in user only if they do not already have one, and it gives your backend no authority to sign for that wallet.

You want both: the Dashboard setting on, and the server-side fallback left in place.

### Wallet execution mode: TEE

The live tests ran with Privy's **TEE execution** mode (`user-controlled-server-wallets-only` in Privy's SDK types). Wallets are reassembled inside a secure enclave that only Privy can invoke, gated by the user's authenticated session. Neither Privy nor your server sees the full private key. The older `legacy-embedded-wallets-only` mode reassembles keys on the user's device. Both are self-custodial; the difference is the mechanism. Use TEE mode unless you have a reason not to, and know which one your app is in, because it changes how wallet creation behaves.

### Smart Wallets (required only for `sponsored-demo`)

Smart Wallets is a separate Dashboard section. It is **required** for `sponsored-demo` (Privy Smart Wallets). It is **not** required for `sponsored-session-app` or the other templates: the SDK builds the ZeroDev Kernel account itself, and leaving it enabled is harmless (users then also get a Privy smart wallet linked, which the paymaster also accepts as owned). For `sponsored-demo` it needs:

- provider **Kernel** (ZeroDev) v3.1,
- custom chain **PEPU**, chain id **97741**, RPC `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`,
- bundler URL `https://bundler.pepeunchained.com`,
- paymaster URL `https://paymaster.pepeunchained.com/v2/paymaster/<project client token ppt_...>`.

You need a claimed and funded project first (see [Sponsorship Tiers](sponsorship-tiers.md)). Use the **client token** with your app's origins allowed, because Privy calls the URL from the browser; never use the server key (`ppk_`) there. A static URL carries no per-user token, so the free tier is not reachable here and a funded project is required. Old dashboards may still hold temporary development bundler or paymaster URLs (such as tunnels); replace them with the hosted ones. Details are on [Sponsored Transactions](sponsored-transactions.md). If Smart Wallets is off for `sponsored-demo`, the page spins forever on "Setting up your smart wallet...".

Per-template requirements, including the game template's authorization key and quorum and the paymaster credentials of each sponsored template, are in [Dashboard Settings](../privy/dashboard-settings.md#per-template-requirements).

### Coinbase smart wallet: set `eoaOnly`

Coinbase's smart wallet does not support chain 97741. If you offer external-wallet login, restrict the Coinbase connector:

```tsx
externalWallets: {
  coinbaseWallet: { config: { preference: { options: "eoaOnly" } } },
},
```

Without it, the browser console fills with "The configured chains are not supported by Coinbase Smart Wallet: 97741". `eoaOnly` keeps the Coinbase extension and mobile paths working and drops the one that cannot work here.

## 3. Code configuration

Privy does not ship PEPU as a built-in chain, so give it a chain object. With the SDK:

```tsx
import { PrivyProvider } from "@privy-io/react-auth";
import { pepuMainnet } from "@pepu-chain/sdk";

<PrivyProvider
  appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
  config={{
    loginMethods: ["email", "google"],
    defaultChain: pepuMainnet,
    supportedChains: [pepuMainnet],
    externalWallets: {
      coinbaseWallet: { config: { preference: { options: "eoaOnly" } } },
    },
  }}
>
  {/* your app */}
</PrivyProvider>;
```

`loginMethods` is a starting point, not the source of truth: the methods users actually see are the intersection of this list and what is enabled in the Dashboard. Enable them in both places or Privy hides them silently. Without `@pepu-chain/sdk` (`npm i @pepu-chain/sdk`; see [Quickstart](../get-started/quickstart-app.md)), define the chain yourself with viem's `defineChain` using the values on [Network Reference](../get-started/network-reference.md).

Privy's SDK options change between versions. If something here does not match your installed version, check [docs.privy.io](https://docs.privy.io); the chain object is the stable part.

## Troubleshooting

**Login fails, the iframe is blocked, or OAuth returns 403.** Almost always the origin. Check which port your dev server actually started on, then check **Allowed origins** for that exact `scheme://host:port`.

**"Creating your wallet..." never finishes.** Check that **Automatically create embedded wallets on login** is on, that `PRIVY_APP_SECRET` is set in `.env.local`, and that the dev server was restarted afterwards: Next.js reads `.env.local` once at startup, and a stale process keeps failing no matter how correct the file is. If `POST /api/wallet/ensure` returns 401 for a logged-in user, look for a leftover `next dev` still bound to the port.

**Wallet created but `useWallets()` is empty at first.** The client picks up the server-created wallet after a user refresh. The templates call `refreshUser()` and wait a bounded time for it to appear. If you build your own flow, do the same.

**"Setting up your smart wallet..." never clears.** Smart Wallets is not enabled for chain 97741 in the Dashboard, or the bundler and paymaster URLs are missing. See [Sponsored Transactions](sponsored-transactions.md).

**Console error: "The configured chains are not supported by Coinbase Smart Wallet: 97741".** Set the Coinbase connector to `eoaOnly` as above.

**Console error: "Unable to fetch token price".** Harmless. Privy cannot fetch a fiat price for PEPU, and the message does not affect login, wallets or transactions.

**A transfer is refused in Privy's confirmation modal even though the wallet can afford it.** Privy's own pre-flight gas estimate is conservative, and PEPU's base fee is around 12,500 gwei, so the estimate can exceed the real cost by enough to block a transfer the wallet could pay for. The check happens inside Privy's modal, so you cannot fix it in your own code. This is why the `consumer-app` template has no "Max" button. If your app sends transactions itself rather than through Privy's modal, `maxSendableAmount` in [`@pepu-chain/sdk`](../sdk/core.md#gas-and-fees) sizes a transfer correctly. See also [Troubleshooting](../troubleshooting.md).

**Server-side `eth_sendTransaction` fails with "Unsupported chain with id 97741".** Expected. See [Sign with Privy, Broadcast Yourself](../recipes/sign-with-privy-broadcast-yourself.md).

**The embedded wallet's address is not the address I see on pepuscan.** If you are using sponsorship, the account that transacts is a Kernel smart account at a different address. See [The Two-Address Model](two-address-model.md).

## Next

- [Session Keys: No Popup Per Transaction](session-keys.md)
- [Sponsored Transactions](sponsored-transactions.md)
- [The Two-Address Model](two-address-model.md)

