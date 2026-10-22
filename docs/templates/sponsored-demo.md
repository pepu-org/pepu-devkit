# Template: Sponsored Demo

The `sponsored-demo` template is a minimal browser demo of gas sponsorship end to end on PEPU. A user signs in with Privy, gets a Kernel smart account holding zero PEPU, clicks one button to send a sponsored `TapScore.tap()` UserOperation, and watches the paymaster's own EntryPoint deposit drop. The drop, not the transaction alone, is the evidence of who paid.

To make this demo sponsor with your own Privy app you must bring a project: claim it, set targets and limits, deposit, and use its token (below). It uses the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`). The free tier is not reachable from this demo: it needs a verified Privy token from PEPU's own Privy app, and the Privy Smart Wallets dashboard URL is static and cannot attach a token.

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes: the embedded wallet is the owner (signer) of the smart account |
| Session keys | No |
| Sponsored transactions | Yes, over the Privy Smart Wallets transport |

It is a demo, not a production starter: no wagmi, no external-wallet connect, one screen, no retry or backoff. A failed tap shows a typed error and lets you press again.

## Two addresses

Sign-in produces two addresses and the demo shows the second:

- The embedded wallet is an EOA that only acts as the signer (owner) of the smart account.
- The Kernel smart account is a separate contract account with its own address. It holds `0 PEPU`, sends the UserOperation and appears as the sender on pepuscan.

Do not expect them to match and do not send funds to one expecting them in the other. See [The Two-Address Model](../onboarding/two-address-model.md).

## Scaffold

```bash
npx create-pepu-app@latest my-app --template sponsored-demo
```

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| Privy provider with Smart Wallets nested inside | `PepuPrivyProvider`, `composeProviders` (`/privy/react`) | `app/providers.tsx` |
| Provision the owner wallet | `createEnsureWalletRoute` (`/privy/server`), `useEnsureWallet` (`/privy/react`) | `app/api/wallet/ensure/route.ts`, `WalletGate` |
| The sponsored send | `useSponsoredSend({ transport: "privy-smart-wallets" })` (`/aa/react`), no ZeroDev packages (needs `permissionless`, which Privy's smart-wallets module requires) | `components/sponsored-tap-demo.tsx` |
| The Kernel smart account address | `usePepuSmartAccount` (`/aa/react`) | same |
| The paymaster deposit before and after | `getPaymasterDeposit` (`/aa`) | same |
| Readable failures | `describeUserOpFailure` (`/aa`, applied inside `useSponsoredSend`) | same |
| Is a bundler and paymaster configured | `usePepuSponsorship` (`/aa/react`), wrapping `checkSponsorship` | same |
| Chain facts, explorer links | `getContract`, `isDeployed`, `pepuMainnet`, `explorerLinks` (core) | components |

`lib/tapscore.ts` is the only template-specific code: the hardcoded target (`TapScore` at `0x261eA5971B93237a56990206A46Bc80318e4d078`) and its ABI.

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public. |
| `PRIVY_APP_SECRET` | Yes | Server only. Used to provision the owner wallet. |
| `NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS` | No | Public on-chain address. Defaults to the deployed v2 paymaster `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (the v1 paymaster is retired). The demo reads its EntryPoint deposit to show the before and after. |

Sponsorship is configured entirely in the Privy dashboard, not in the app. Settings, Wallet infrastructure, Smart wallets:

| Setting | Value |
|---|---|
| Chain | `97741` |
| Provider | Kernel |
| Bundler URL | `https://bundler.pepeunchained.com` (local default for your own: `http://localhost:4337`) |
| Paymaster URL | `https://paymaster.pepeunchained.com/v2/paymaster/<project token>` (local default for your own: `http://localhost:8788`; the token is a credential) |

Use your project's client token (`ppt_`) with your app's origins set as the project's allowed origins, because Privy calls the paymaster from the browser. Never use the server key (`ppk_`) in the dashboard.

Also required (doctor requirements `login-methods`, `allowed-origins`, `embedded-wallets`, `smart-wallets`):

- Env: `NEXT_PUBLIC_PRIVY_APP_ID` (public) and `PRIVY_APP_SECRET` (secret, server only), both under Settings, Basics.
- Allowed origins: `http://localhost:3000` (exact port) plus your production domain.
- Login methods: Google and email, matching `loginMethods` in `app/providers.tsx`.
- Embedded wallets: Ethereum, create on login. `WalletGate` and `/api/wallet/ensure` provision the owner wallet server-side as a fallback. TEE (user-controlled) mode is what the live tests used.
- Smart Wallets: **required**, with provider Kernel (ZeroDev) v3.1 and the custom chain PEPU, chain id `97741`, RPC `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`. If it is off, the page spins forever on "Setting up your smart wallet..." and the app cannot work around it. Old dashboards may still hold temporary development bundler or paymaster URLs (tunnels): replace them with the hosted ones in the table above.
- Paymaster credential: the project **client token** (`ppt_`) inside the dashboard paymaster URL, with your app's origins allowed. Never use the server key (`ppk_`) there. The free tier cannot be used on this path (a static URL carries no per-user Privy token), so a funded project is required.

### What you must configure to sponsor with your own project

The demo does not sponsor out of the box for a third-party app. In order:

1. Sign in with Ethereum to the policy service (`/v2/auth/nonce`, `/v2/auth/login`).
2. Verify your Privy app: `POST /v2/projects/verify` with the Privy app id and secret (used for one request, never stored).
3. Claim the project (`claimProject`): immediate if the project is empty, pending 48 hours if someone already funded it.
4. Set the targets and limits: `setTargets` (include `TapScore`), `setDailyLimit`, `setSenderDailyLimit`.
5. Deposit PEPU (`depositFor`). Deposits are one-way, so deposit only what your project needs.
6. Register the project to get the client token and the server key, then set allowed origins for the client token.
7. Enter the token in the Privy dashboard paymaster URL above.

The steps are in [Sponsorship Tiers](../onboarding/sponsorship-tiers.md) and [Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md).

The paymaster only sponsors allowlisted destinations. `TapScore` must be in the project's targets. See [Paymaster Overview](../infra/paymaster/overview.md) and [Bundler Overview](../infra/bundler/overview.md).

## Run and check

```bash
cd my-app
npm install
npm run doctor
npm run dev        # http://localhost:3000 only
```

Run on port 3000 only. Privy's allowed origins match the exact origin including the port, and Next.js silently falls back to 3001 when 3000 is taken.

What you see: sign in, wait for the wallet and then the smart wallet to be set up, see the Kernel address with `0 PEPU`, click Sponsor a tap, then a transaction link and a before, after and drop panel for the paymaster deposit. A nonzero drop from a wallet that paid nothing shows the paymaster paid.

## Project structure

```text
app/            layout, providers (PepuPrivyProvider plus SmartWalletsProvider), page, api/wallet/ensure
components/     signed-in-view (WalletGate), sponsored-tap-demo (the whole sponsored path)
lib/            tapscore.ts (target and ABI), env.ts
scripts/doctor.mjs
```

## Limitations

- Using this demo with your own Privy app needs your own claimed and funded project and its token, plus the dashboard setup above.
- The free tier is not reachable from this demo.
- Each tap spends real paymaster deposit.

Idempotency: one tap is one UserOperation, a retry builds a fresh operation with the next nonce and never replays, and wallet provisioning looks for an existing wallet first.

## Customizing it

- Change the target in `lib/tapscore.ts` and add the new contract to the paymaster's allowlist and your app's allowed destinations.
- For a browser flow with a session key and no popups, use [`sponsored-session-app`](sponsored-session-app.md). This template keeps the Privy Smart Wallets transport: `/aa/react` never resolves `@zerodev/*`, and `permissionless` (required by Privy's smart-wallets module) is the only extra package it needs.
- Treat the paymaster URL as a secret and keep it out of the browser where you can.

## Common failures

| `code` or symptom | Meaning | Fix |
|---|---|---|
| Spinner on "Setting up your smart wallet" | Smart Wallets is off, or the bundler or paymaster URL is missing in the dashboard | Set chain `97741`, provider Kernel, both URLs. |
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The call targets a contract not on the allowlist | Add `TapScore` to the global allowlist and your app's allowed destinations. |
| `PAYMASTER_ORIGIN_NOT_ALLOWED` | The page origin is not allowed | Allow the exact origin including the port. |
| `PAYMASTER_DENIED` (also `AA32` to `AA34`) | The credential or sender was rejected, or the policy signer does not match the paymaster contract | Check the app key in the paymaster URL and that the smart account belongs to the signed-in user. |
| `PAYMASTER_NO_BALANCE` (also `AA31`) | The paymaster's EntryPoint deposit cannot cover the operation | Deposit PEPU to the paymaster contract. |
| `PAYMASTER_CAP` | A daily, per-sender or per-operation cap was hit | Wait for the window to reset, or raise the limits. |
| `BUNDLER_AA_FAILED` (`AA25`) | Invalid nonce: another operation from this account is pending | Wait for it to confirm, then retry. |
| `BUNDLER_UNREACHABLE` | The bundler or paymaster URL is unset or wrong | Fix the dashboard values. |
| The failure box says "not configured" but the dashboard is right | With this transport the working URLs live in Privy, not env | Treat that line as a hint. Export the env vars too if you want the probe to agree. |

## Related

- [Template Gallery](index.md)
- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [Send a Sponsored Transaction](../recipes/sponsored-send.md)
- [Smart Accounts](../onboarding/smart-accounts.md)
