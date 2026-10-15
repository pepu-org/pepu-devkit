# Smart Account Paths: Plain Wallet, ZeroDev-Native or Privy Smart Wallets

PEPU gives you three ways to send transactions for a user, and two of them involve a smart account. This page explains what a smart account is, what each of ZeroDev, Privy and the PEPU paymaster does, and how the two smart-account paths differ: **Path 1, ZeroDev-native** (the SDK builds the Kernel account) and **Path 2, Privy Smart Wallets** (Privy builds it from dashboard settings). Path 0, the plain embedded wallet, is the baseline for contrast. Read it before you pick a template; it answers "which one do I start from?" in one table.

> Status: proven. Every claim below is taken from `packages/sdk/src` (`aa`, `aa/kernel`, `aa/react`, `aa/react-direct`, `session/kernel`, `combo`) and the `sponsored-demo` and `sponsored-session-app` templates. Path 1 (the combination: Google sign-in, one session signature, sponsored taps, revoke) ran live in a browser on mainnet on 2026-10-14. Path 2 is proven through the hosted bundler and paymaster URLs, but the `sponsored-demo` page has not been clicked through by a person in a browser. The v2 paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches.

## The short answer

| If you want | Use | Start from |
|---|---|---|
| Login and a wallet, users pay their own gas | Path 0: plain embedded wallet | `consumer-app` |
| A game or app with many actions, no popup and no user gas, limits enforced on-chain | Path 1 with the combination | `sponsored-session-app` |
| One gasless button in a client-only app, on your own project budget | Path 2: Privy Smart Wallets | `sponsored-demo` |
| A bot or backend that sends sponsored transactions | Path 1 with a server key as owner | a script (below) |

If you are unsure, take Path 1. It does everything Path 2 does, adds sessions and the free tier, and needs no Privy dashboard setting beyond the usual login ones. Path 2 is the shortcut for a client-only gasless button.

## What a smart account is, and why it needs an owner key

A normal wallet (an EOA) is one key. Whoever holds the key can send a transaction, and the sender pays gas in PEPU. A **smart account** is a contract that acts as the sender. Because it is code, it can do things a key cannot: let someone else pay the gas, accept a limited session key, or batch several calls into one operation. It sends [UserOperations](../reference/glossary.md) (ERC-4337) instead of ordinary transactions.

A contract cannot sign. Every smart account therefore has an **owner key**: an ordinary signer whose signature the contract accepts as proof that the owner approved an action. Without an owner key nothing could authorize the account. The owner can be a Privy embedded wallet, an EOA, or a server key. The smart account's address is derived from the owner (and an index), so it is a different address from the owner's; see [The Two-Address Model](../onboarding/two-address-model.md).

Three parties do three different jobs:

| Party | Job | What it is in PEPU |
|---|---|---|
| **ZeroDev Kernel v3.1** | The smart account contract logic. It validates UserOperations, runs the calls and enforces on-chain session policies (call policy, timestamp policy). | The factory, implementation and validators are deployed on chain 97741; see [Entrypoints and Kernel](../contracts/entrypoints-and-kernel.md). The SDK pins `KERNEL_VERSION` to v3.1 and [EntryPoint](../reference/glossary.md) v0.7. |
| **Privy** | Login, key custody and user identity. The embedded wallet is the owner key. Privy also verifies who the user is (an access token the paymaster can check). | `PepuPrivyProvider`, `WalletGate`, `useEmbeddedWallet`. |
| **Our paymaster** | Pays the gas. A [bundler](../reference/glossary.md) submits the UserOperation and the [paymaster](../reference/glossary.md) covers the cost from a project's balance or the free tier. | Hosted: bundler `https://bundler.pepeunchained.com`, paymaster `https://paymaster.pepeunchained.com`; contract `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (v2 canary). |

The two smart-account paths differ in exactly one thing: **who builds and drives the Kernel account**. Privy does it in Path 2, the PEPU SDK does it in Path 1. The contract is the same Kernel v3.1 either way.

## Path 0 (for contrast): plain embedded wallet, no smart account

The user's Privy embedded wallet is the account. It signs and sends directly, and it pays gas in PEPU (a fraction of a cent per transaction). There is one address, no bundler, no paymaster, no ZeroDev.

| | |
|---|---|
| Templates | `consumer-app`, `token-gated-app`, `nft-mint` (user approves each send), `game-app` (popup-free play) |
| Popup-free play | `game-app` uses **Privy session signers**: you register an authorization key and a key quorum, the user grants a session once, and your server asks Privy to sign each action (`eth_signTransaction`) and then broadcasts it. The limits are Privy policies, enforced by Privy's backend (off-chain). The user still pays gas. See [Session Keys](../onboarding/session-keys.md). |
| SDK | `/privy/*`, and for game sessions `/session`, `/session/server`, `/session/react` |
| Needs | A Privy app. For game sessions also an authorization key and a key quorum |
| Does not need | A bundler, a paymaster, a project, ZeroDev packages |

Choose it when users pay their own gas and you want the smallest setup. Everything below is about removing that gas cost.

## Path 1: ZeroDev-native, built by the SDK

The SDK creates the Kernel account directly with `toPepuKernelAccount` (`@pepu-chain/sdk/aa/kernel`). The owner is whatever signer you pass: a Privy embedded wallet, an EOA, or a server key (`KernelOwner` is a viem local account, a Privy or ZeroDev signer, or a wallet client). Privy is only login and key custody; the account itself is not a Privy object.

| | |
|---|---|
| Used by | `sponsored-session-app`, and the SDK entries `/aa/kernel`, `/aa/react-direct`, `/session/kernel`, `/combo`, `/combo/react` |
| Sponsored sends | `createPepuSponsoredClient` and `sendSponsored` send through our bundler with gas paid by our paymaster. Fees come from the chain with 20% headroom because Alto does not implement ZeroDev's gas price method. In React: `useDirectSponsoredSend`, `useDirectSmartAccount` |
| On-chain session keys | `buildKernelSessionPolicies` (call policy v0.0.4 plus timestamp policy), `approveKernelSession` (one owner signature in the browser), `loadKernelSessionAccount` (server, with the session key). The scope is enforced by the account during validation, so a compromised server can only do what the permission allows until it expires. `/combo` wraps this into five route handlers and one hook |
| Free tier and budgets | The paymaster context carries the user's Privy access token (`useDirectSponsoredSend` and the combo routes forward it by default). That unlocks the [free tier](../reference/glossary.md) **for PEPU's own Privy app only**. Your app pays from your [project](../reference/glossary.md) budget; the project is tried first and the free tier is the fallback. See [Sponsorship Tiers](../onboarding/sponsorship-tiers.md) |
| Control | You choose the owner, the `index`, the validators, the session scope and expiry, and where the session key lives |
| Privy dashboard | **Smart Wallets not required.** Only the usual settings: Allowed origins, login methods, embedded wallets. Leaving Smart Wallets on is harmless |
| Paymaster credential | From a server (combo routes, scripts, bots): the project **server key** (`ppk_`) in `PEPU_PAYMASTER_URL` or as `paymasterToken`. A secret. From a browser: a project **client token** (`ppt_`) with allowed origins, never the server key |
| Extra packages | `@zerodev/sdk`, `@zerodev/ecdsa-validator`, plus `@zerodev/permissions` for sessions. Not `permissionless` |

### Browser, owner signs each send

```tsx
// Path 1 (ZeroDev-native), browser: the SDK builds the Kernel account for the Privy embedded wallet.
// No Privy Smart Wallets setting is needed. The owner signs each send (no session here).
// NEXT_PUBLIC_ values are visible to every visitor: use a project CLIENT token (ppt_) with allowed origins, never a server key (ppk_).
// See docs/concepts/smart-account-paths.md
import { useDirectSmartAccount, useDirectSponsoredSend } from "@pepu-chain/sdk/aa/react-direct";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export function NativeTap() {
  const { owner, smartAccount } = useDirectSmartAccount(); // two addresses: the EOA signs, the Kernel account sends
  // Next.js only inlines literal process.env.NEXT_PUBLIC_X reads, so pass the URLs explicitly.
  const { send, status, result, error } = useDirectSponsoredSend({
    ...(process.env["NEXT_PUBLIC_PEPU_BUNDLER_URL"] ? { bundlerUrl: process.env["NEXT_PUBLIC_PEPU_BUNDLER_URL"] } : {}),
    ...(process.env["NEXT_PUBLIC_PEPU_PAYMASTER_URL"] ? { paymasterUrl: process.env["NEXT_PUBLIC_PEPU_PAYMASTER_URL"] } : {}),
  });

  return (
    <div>
      <p>Owner (signs): {owner}</p>
      <p>Smart account (sends): {smartAccount}</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }])}
      >
        Tap, no gas
      </button>
      {status === "confirmed" && result ? <a href={result.explorerUrl}>Paid by {result.paymaster}</a> : null}
      {error ? <p>{error.code}: {error.hint}</p> : null}
    </div>
  );
}
```

### Browser plus server, one signature then no popups: the combination

Google login, one scoped on-chain session, then every action is a sponsored UserOperation signed by a server-held session key. This is `sponsored-session-app`; the server routes and the hook are in [/combo](../sdk/combo.md) and the full walkthrough is [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md).

### Server or bot: the owner is a server key

```ts
// Path 1 (ZeroDev-native), server or bot: the owner is a plain server key, the paymaster credential is the project SERVER key.
// SERVER ONLY: both secrets stay in the environment and are never printed or sent to a browser.
// See docs/concepts/smart-account-paths.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "@pepu-chain/sdk/aa/kernel";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export async function botTap() {
  const publicClient = getPublicClient(pepuMainnet);
  // The Kernel account is owned by this key. Its address is a pure function of the owner (and index).
  const owner = privateKeyToAccount(process.env["BOT_OWNER_PRIVATE_KEY"] as Hex);
  const account = await toPepuKernelAccount({ publicClient, owner });
  // paymasterToken is your project's server key (ppk_); the SDK builds https://paymaster.pepeunchained.com/v2/paymaster/<token>.
  const client = createPepuSponsoredClient({ account, paymasterToken: process.env["PEPU_PAYMASTER_SERVER_KEY"] as string });
  return sendSponsored({ client, calls: [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }] });
}
```

## Path 2: Privy Smart Wallets

Privy builds and manages the Kernel account. You describe it once in the Privy dashboard (provider Kernel v3.1, chain 97741, bundler URL, a static paymaster URL), and Privy's smart-wallet client sends the UserOperations from the browser. The SDK wraps that client: `useSponsoredSend({ transport: "privy-smart-wallets" })` and `usePepuSmartAccount` from `@pepu-chain/sdk/aa/react`, with the app wrapped in Privy's `SmartWalletsProvider` (`composeProviders` from `/privy/react` builds the nesting).

| | |
|---|---|
| Used by | `sponsored-demo`, and the SDK entry `/aa/react` |
| Where it runs | Client side, through `useSmartWallets`. No server code is needed for sending (only the ensure-wallet route for login) |
| Quick to enable | One dashboard form and one hook. The bundler and paymaster URLs live in the dashboard, not your env |
| Privy dashboard | **Smart Wallets required**: provider Kernel (ZeroDev) v3.1, custom chain `97741` with RPC `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`, bundler `https://bundler.pepeunchained.com`, paymaster `https://paymaster.pepeunchained.com/v2/paymaster/<project client token>`. Field detail: [Dashboard Settings](../privy/dashboard-settings.md) |
| Paymaster credential | The project **client token** (`ppt_`) inside the dashboard URL. Never the server key |
| Extra packages | `permissionless` (required by Privy's smart-wallets module). Never needs `@zerodev/*` |

```tsx
// Pillar 3, client: send with gas sponsored from a component.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { usePepuSmartAccount, usePepuSponsorship, useSponsoredSend } from "@pepu-chain/sdk/aa/react";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export function SponsoredTap() {
  const { smartAccount } = usePepuSmartAccount();
  // "privy-smart-wallets" uses the bundler and paymaster URLs from the Privy dashboard.
  // For your own bundler and paymaster, use useDirectSponsoredSend from "@pepu-chain/sdk/aa/react-direct".
  const { send, status, result, error } = useSponsoredSend({ transport: "privy-smart-wallets" });
  const sponsorship = usePepuSponsorship({ pollMs: 0 });

  return (
    <div>
      <p>Smart account: {smartAccount}</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }])}
      >
        Tap, no gas
      </button>
      {status === "confirmed" && result ? <a href={result.explorerUrl}>Paid by {result.paymaster}</a> : null}
      {error ? (
        <p>
          {error.code}: {error.hint}
        </p>
      ) : null}
      {!sponsorship.loading && !sponsorship.available ? <p>{sponsorship.reason}</p> : null}
    </div>
  );
}
```

### Limits of Path 2

- **The free tier cannot be reached.** The dashboard URL is static, so it carries no per-user Privy access token, and the free tier needs one.
- **It needs a funded project of your own** (claim, deposit, register) and a **client token with allowed origins**, because Privy calls the URL from the browser. Without allowed origins the paymaster answers `project_origin_not_allowed`. The paymaster URL is stored in Privy's dashboard, so it is a credential that lives there.
- **No on-chain session keys through our SDK.** Privy's smart-wallet client cannot install a scoped session validator, so `/session/kernel` and `/combo` build their own Kernel account instead.
- **Less control over account config.** Owner, index, validators and fee handling are Privy's. The result also has `userOpHash: null`, because only the bundle transaction is exposed.
- **A page that spins on "Setting up your smart wallet..."** means Smart Wallets is not configured for chain 97741. That is a dashboard fix, not a code fix.

## Decision table

| | Path 0: plain EOA | Path 0: Privy session signers | Path 1: ZeroDev-native | Path 2: Privy Smart Wallets |
|---|---|---|---|---|
| Login | Privy | Privy | Privy (or any signer) | Privy |
| Account that sends | The embedded wallet | The embedded wallet | A Kernel v3.1 account built by the SDK | A Kernel v3.1 account built by Privy |
| Who pays gas | The user | The user | Your project, or the free tier for PEPU's own app | Your project |
| Sessions, no popup per action | None: user approves each send | Privy off-chain policies, enforced by Privy's backend | On-chain call and timestamp policies, enforced by the account | None through our SDK |
| Free tier | No | No | Yes, PEPU's own Privy app only (user's Privy token forwarded) | No (static URL carries no token) |
| Project budgets | No | No | Yes (server key, or client token from a browser) | Yes (client token in the dashboard) |
| Server needed | No (only the ensure-wallet route) | Yes (authorization key, session routes) | Yes for sessions and bots; no for a browser-only owner-signed send | No |
| Privy dashboard settings | Origins, login methods, embedded wallets | Those plus authorization key and key quorum | Origins, login methods, embedded wallets. **Not** Smart Wallets | Those plus **Smart Wallets**: Kernel, 97741, bundler and paymaster URLs |
| Start from | `consumer-app` (also `token-gated-app`, `nft-mint`) | `game-app` | `sponsored-session-app` | `sponsored-demo` |
| SDK entries | `/privy/*` | `/session`, `/session/server`, `/session/react` | `/aa/kernel`, `/aa/react-direct`, `/session/kernel`, `/combo` | `/aa/react` |

## Pick this if

- **A game with many actions, or any app where a popup per action would kill the experience.** Path 1 with the combination (`sponsored-session-app`). One signature, then taps with no popup and no user gas, with limits enforced on-chain. Size per-user caps above the worst-case reservation (about 20.5 PEPU for a session's first operation, 6.9 PEPU after).
- **A simple gasless button in a client-only app with its own budget.** Path 2 (`sponsored-demo`). One dashboard form, one hook, no server. Accept that every send needs the user's confirmation and that you cannot use the free tier.
- **A standard dapp where users pay gas.** Path 0 with the plain embedded wallet (`consumer-app`). Do not add a smart account for nothing. If you want popup-free play and the user paying a fraction of a cent is fine, use the Privy session signers in `game-app`.
- **A bot or backend.** Path 1 with a server key as the owner (`botTap` above): the account is owned by a key you hold, and the project server key pays. Nothing in a browser.
- **You are not sure.** Path 1. It can do everything Path 2 can, and it is the only one with sessions and the free tier.

## Mixing paths

Yes, one user can have both. The two accounts are separate contracts and usually separate addresses:

- The Privy smart wallet address comes from Privy (`usePepuSmartAccount`, `useSmartWallets().client.account.address`). The SDK Kernel address comes from `getKernelAddress` or `useDirectSmartAccount`. Both are Kernel v3.1 accounts owned by the same embedded wallet, but the address depends on the owner, the `index` and the account configuration. **Do not assume the two addresses are equal**; they match only if Privy's index and configuration match the SDK's, and you should read each address from the API that created it. Show the user the address that actually sends.
- Assets live at one address. PEPU or tokens held by the Privy smart wallet are not at the SDK Kernel account and the reverse. Pick one account per app and keep to it, unless you have a reason to run both.
- The paymaster accepts both as owned by the user. For the identity check, the sender must be either a Privy smart wallet the user owns, or the Kernel v3.1 account (index 0) derived from one of the user's own Privy embedded wallets. An SDK account built with a non-default `index` is not recognized by that identity check.
- Leaving Smart Wallets switched on while using Path 1 is harmless: users then also get a Privy smart wallet linked to their account, which you simply do not use.

## Migrating between paths

The owner key never changes, so users keep their login and their embedded wallet. The smart account can change, and with it the address that holds assets. Move any balances out of the old account before you cut over.

| Move | What changes in the code |
|---|---|
| Path 0 to Path 1 | Install `@zerodev/sdk` and `@zerodev/ecdsa-validator`. Replace `sendTransaction` with `useDirectSponsoredSend` (browser) or `createPepuSponsoredClient` plus `sendSponsored` (server). Show `useDirectSmartAccount().smartAccount` instead of the EOA. Add a paymaster credential. Allowlist your contract. Existing assets at the EOA stay there |
| Path 0 to Path 2 | Enable Smart Wallets in the dashboard, wrap the app in `SmartWalletsProvider`, install `permissionless`, replace sends with `useSponsoredSend`. Show `usePepuSmartAccount().smartAccount` |
| Path 2 to Path 1 | Replace `useSponsoredSend` with `useDirectSponsoredSend` and `usePepuSmartAccount` with `useDirectSmartAccount`. Remove `SmartWalletsProvider`; the dashboard Smart Wallets form can be turned off. Install the `@zerodev/*` peers. Move the bundler URL and the paymaster credential into your env (or into the combo routes). Remove `permissionless` if nothing else uses it. For sessions, add `/combo` and `/combo/react`. The address may change, so move assets from the old Privy smart wallet first |
| Path 1 to Path 2 | The reverse, and you lose sessions and the free tier. Put the client token URL in the Privy dashboard. Rarely a good idea |
| Path 0 session signers to Path 1 sessions | Drop the authorization key and quorum. `createSponsoredSessionRoutes` replaces the session routes. Scope moves from a Privy policy to `KernelSessionCall`s enforced on-chain. The user now signs one EIP-712 message to grant, and no longer pays gas |

The core of a Path 2 to Path 1 browser change is two imports:

```diff
-import { usePepuSmartAccount, useSponsoredSend } from "@pepu-chain/sdk/aa/react";
+import { useDirectSmartAccount, useDirectSponsoredSend } from "@pepu-chain/sdk/aa/react-direct";
-const { smartAccount } = usePepuSmartAccount();
-const { send } = useSponsoredSend({ transport: "privy-smart-wallets" });
+const { smartAccount } = useDirectSmartAccount();
+const { send } = useDirectSponsoredSend({ bundlerUrl, paymasterUrl });
```

`send(calls)` and its `SponsoredResult` have the same shape on both paths.

## What to expect

- A new Path 1 or Path 2 user holds 0 PEPU at their smart account and still sends. Prove sponsorship by the paymaster's EntryPoint deposit dropping, not by the transaction hash (the result's `paymaster` field also names who paid).
- The first operation deploys the account, so it reserves more gas than later ones.
- Run `npm run doctor` in the app (or the `pepu_check_privy_config` and `pepu_sponsorship_status` MCP tools) to see which dashboard rows and credentials are missing for your path.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| "Setting up your smart wallet..." never ends | Path 2 with Smart Wallets not configured for chain 97741 | Fill the dashboard form, or switch to Path 1 |
| `project_origin_not_allowed` | A client token (`ppt_`) with no allowed origins, or used from a server | Set the project's allowed origins, or use the server key from a backend |
| Balance "missing" after switching paths | Assets are at the other path's smart account | Look up the old address and send from it |
| Free tier denied on a third-party app | The free tier is only for PEPU's own Privy app | Use a project of your own |
| `Cannot find module '@zerodev/sdk'` | Path 1 peers not installed | `npm i @zerodev/sdk @zerodev/ecdsa-validator` (and `@zerodev/permissions` for sessions) |
| Sponsorship denied right after the first action | Per-user caps below the first-operation reservation | Raise the caps; see [Sponsored Transactions](../onboarding/sponsored-transactions.md) |

## Related

- [The Three Pillars and How They Combine](../get-started/pillars.md)
- [The Two-Address Model](../onboarding/two-address-model.md)
- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [Sponsored Session: No Popup, No Gas](../onboarding/sponsored-session.md)
- [Dashboard Settings, Field by Field](../privy/dashboard-settings.md)
- [/aa](../sdk/aa.md), [/combo](../sdk/combo.md)
- [Glossary](../reference/glossary.md)
