# The Three Pillars and How They Combine

The PEPU dev kit is built around three capabilities that make an app feel like a normal consumer app: Google login to a wallet, session keys, and sponsored transactions. This page defines each pillar, says what is proven, and gives the decision table for choosing a combination. Read it first; every other page in Onboarding, Privy and the SDK section hangs off it.

> Status: Pillars 1 and 2 (Privy mode) are proven on mainnet and usable today. Pillar 3 and the combination are proven on mainnet (the combination live in a browser on 2026-10-14, against the hosted bundler and v2 paymaster), through the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`), which you use with a funded project. The v2 tiered paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches.

Terms used on this page: [UserOperation](../reference/glossary.md), [bundler](../reference/glossary.md), [paymaster](../reference/glossary.md), [EntryPoint](../reference/glossary.md), [Kernel](../reference/glossary.md), [session key](../reference/glossary.md), [project](../reference/glossary.md), [free tier](../reference/glossary.md). All are defined in the [Glossary](../reference/glossary.md).

## Prerequisites

- Mainnet only: chain ID `97741`. Testnet `97740` is out of scope.
- A Privy app (App ID and App Secret). See [Privy Configuration Overview](../privy/index.md).
- For pillar 3 and the combination: a bundler and a paymaster. Write them as `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL`. Local development defaults are `http://localhost:4337` and `http://localhost:8788`. See [Infrastructure Map](../infra/overview.md).

## The pillars

### Pillar 1: Google login to an embedded wallet

| | |
|---|---|
| What it gives | A user clicks "Sign in with Google" and gets a self-custodial Privy embedded wallet on chain 97741. No seed phrase, no extension. |
| What it needs | A Privy app with Google enabled, the exact origin (with port) in Allowed origins, embedded wallets on for Ethereum, and `PRIVY_APP_SECRET` on the server for the ensure-wallet route. No bundler, no paymaster. |
| SDK | `/privy` (config, requirements), `/privy/react` (`PepuPrivyProvider`, `WalletGate`, `useEmbeddedWallet`), `/privy/wagmi` (`PepuPrivyWagmiProvider`), `/privy/server` (`createEnsureWalletRoute`, `requireUser`) |
| Template | `consumer-app` |
| Status | **Proven.** A real Google login on a real Privy app created an embedded wallet through the server-side ensure route, on mainnet. |
| Page | [Social Login and Embedded Wallets (Privy)](../onboarding/privy-embedded-wallets.md) |

### Pillar 2: Session keys, with no popup per transaction

There are two modes. They differ in who enforces the limits and in who pays gas.

| | Privy session signers | Kernel on-chain session keys |
|---|---|---|
| Account | The plain embedded EOA | A ZeroDev Kernel v3.1 smart account owned by the embedded wallet |
| Who signs actions | Privy, on your server's request (`eth_signTransaction`), then your server broadcasts | A session key your server holds, signing UserOperations |
| Where the scope is enforced | Privy's backend policy engine (off-chain) | Call policy and timestamp policy contracts, during UserOperation validation (on-chain) |
| What you trust | Privy's policy engine and your policy configuration | The chain. A compromised server can only do what the permission allows until it expires |
| Who pays gas | The user, from the embedded wallet | Whoever sponsors it: pair it with a paymaster (the combination) |
| Needs | An authorization key and a key quorum in the Privy dashboard | A bundler, a paymaster and a session store. No authorization key |
| SDK | `/session` (policy), `/session/server` (routes), `/session/react` (hooks) | `/session/kernel` (policies, approve, load), plus `/combo` for the routes |
| Template | `game-app` | `sponsored-session-app` |
| Status | **Proven** end to end on mainnet with a real Privy app. | **Proven** on mainnet by script (with scope refusals proven) and live in a browser (2026-10-14). Uses the hosted bundler and a funded project. |
| Page | [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md) | [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md), [Sponsored Session](../onboarding/sponsored-session.md) |

### Pillar 3: Sponsored transactions

| | |
|---|---|
| What it gives | The user pays no gas. A Kernel smart account holding 0 PEPU sends a transaction and a paymaster pays. |
| Who pays | The paymaster contract, from its own EntryPoint deposit, after an off-chain policy service approves the UserOperation. Today that is the v2 paymaster `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (a canary), paid from your project's deposit or, for PEPU's own apps, the free tier. The v1 paymaster is retired. |
| What it needs | A bundler (ERC-4337, EntryPoint v0.7), a paymaster (ERC-7677), and your contract on the paymaster's allowlist. |
| SDK | `/aa` (probes, errors), `/aa/kernel` (`toPepuKernelAccount`, `createPepuSponsoredClient`, `sendSponsored`), `/aa/react` (`useSponsoredSend`, `usePepuSmartAccount`, `usePepuSponsorship`), `/aa/react-direct` (`useDirectSponsoredSend`, `useDirectSmartAccount`), `/paymaster` (v2 project helpers) |
| Template | `sponsored-demo` |
| Status | **Proven** end to end on mainnet through the hosted bundler and paymaster (a project-sponsored operation from a fresh 0 PEPU account). The v2 tiered paymaster is **proven on mainnet (canary, external audit pending)**. |
| Page | [Sponsored Transactions](../onboarding/sponsored-transactions.md) |

### The combination: Google login, one signature, no popups, no user gas

Sign in with Google (pillar 1), approve one scoped session with one owner signature (the Kernel mode of pillar 2), and every later action is a sponsored UserOperation (pillar 3). The limits live on-chain in the user's smart account.

| | |
|---|---|
| SDK | `/combo` (`createSponsoredSessionRoutes`), `/combo/react` (`useSponsoredSession`), on top of `/session/kernel`, `/aa/kernel`, `/privy/*` |
| Template | `sponsored-session-app` |
| Status | **Proven** on mainnet live in a browser (2026-10-14, against the hosted bundler and v2 paymaster: Google sign-in, one Privy signature, sponsored taps with no popup, revoke) and by script (`npm run prove-session`, and the SDK's own `prove-session`): one owner signature, then two sponsored UserOperations signed by the session key, from an account holding 0 PEPU. A different function on the allowed contract, and an expired grant, are refused. |
| Page | [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md) |

## Decision table

| I want | Choose | Dashboard needs | Template |
|---|---|---|---|
| Login and a wallet, user pays gas, user approves each send | Pillar 1 only | Allowed origins, login methods, embedded wallets | `consumer-app` |
| Popup-free actions, user pays gas, simplest setup, no bundler | Privy session signers | Pillar 1 plus an authorization key and key quorum | `game-app` |
| Gasless sends, user still signs each one | Sponsored transactions, `privy-smart-wallets` transport | Pillar 1 plus Smart Wallets: Kernel, chain 97741, bundler URL, paymaster URL | `sponsored-demo` |
| Gasless sends, URLs kept in your env, no Privy Smart Wallets | Sponsored transactions, `direct` transport | Pillar 1 only | none (use `useDirectSponsoredSend` from `/aa/react-direct`) |
| No popup and no gas, limits enforced on-chain | The combination | Pillar 1 only. Smart Wallets and authorization keys are not needed | `sponsored-session-app` |

Not sure which smart-account setup you need? [Smart Account Paths](../concepts/smart-account-paths.md) compares the plain wallet, the ZeroDev-native path (the SDK builds the Kernel account) and Privy Smart Wallets (Privy builds it) side by side, with a "pick this if" list.

Two choices inside the sponsorship rows:

- **`privy-smart-wallets` versus `direct`.** With `privy-smart-wallets`, Privy's smart-wallet client calls the bundler and paymaster URLs you entered in the dashboard (`https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com/v2/paymaster/<project token>`). A paymaster URL embeds a token, so entering it in the dashboard stores a credential there, and the free tier is not reachable from it. With `direct`, the SDK builds the Kernel account itself and your env supplies the URLs. `direct` is what the combination uses. See [Sponsored Transactions](../onboarding/sponsored-transactions.md).
- **Privy session versus Kernel session.** Choose Privy mode when users pay their own gas and you accept that Privy's policy engine enforces the scope. Choose Kernel mode when you want the chain to enforce it, which in practice means you also sponsor gas. A Kernel session does not use Privy session signers, so no authorization key is involved.

## What to expect

- Pillar 1 works today with nothing but a Privy app.
- Pillar 2 in Privy mode works today. The user pays gas, a fraction of a cent.
- Gas sponsorship needs a claimed and funded project (the free tier is only for PEPU's own Privy app). Do not tell users a transaction is "gasless" until you have configured and tested one. Use `usePepuSponsorship` or the `pepu_sponsorship_status` MCP tool to check live.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Login fails or the iframe is blocked | The origin, including the port, is not in Allowed origins | [Dashboard Settings](../privy/dashboard-settings.md) |
| "Creating your wallet..." never ends | Privy's client-side creation hangs when the dashboard setting is off | Use `WalletGate` and `createEnsureWalletRoute`; see Pillar 1 page |
| Session grant returns 401 "No valid authorization keys" | Key quorum mismatch (Privy mode) | [Authorization Keys and Key Quorums](../privy/authorization-keys.md) |
| Sponsored send denied | Destination not allowlisted, cap hit, or no deposit | [Sponsored Transactions](../onboarding/sponsored-transactions.md) |
| A page spins on "Setting up your smart wallet..." | Smart Wallets not configured for chain 97741 (Privy transport only) | [Dashboard Settings](../privy/dashboard-settings.md) |

## Related

- [Smart Account Paths: which one to use](../concepts/smart-account-paths.md)
- [Architecture: Who Calls What](../concepts/architecture.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
- [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](quickstart-app.md)
- [Template Gallery](../templates/index.md)
- [SDK Overview and Reference](../sdk/reference.md)
