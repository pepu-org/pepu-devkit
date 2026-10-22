# Google Login, Session and Sponsorship End to End

The headline flow of the dev kit: the user signs in with Google, signs once to approve a limited session, and from then on every action runs with no wallet popup and no gas from the user. This page is the full walkthrough: the architecture, every step with the SDK calls and the failure modes, what the chain enforces versus what the server only checks, and the checks that catch problems before a user does.

![Sponsored session flow: sign in with Google, wallet ready, approve one session with one signature, taps with no popup and no gas, revoke](../.gitbook/assets/sponsored-session-flow.png)

*One signature, then no popups and no gas.*

`npm run prove-session` (and the SDK's `pnpm --filter @pepu-chain/sdk prove-session`) runs the mechanism from a script: a throwaway owner signs one grant, then a throwaway session key sends two sponsored UserOperations that deploy the account and call `tap()`. The smart account balance stays 0 and `TapScore.scores(account)` reads 2. A different function on the allowed contract and an expired grant are refused. The browser flow is Google sign-in, one Privy `eth_signTypedData_v4` signature on chain 97741, sponsored taps with no popup, and revoke. It uses the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`) and needs a claimed and funded project.

## Prerequisites

- A Privy app with Google enabled, `http://localhost:3000` in Allowed origins and embedded wallets on. Smart Wallets, authorization keys and key quorums are NOT needed. See [Dashboard Settings](../privy/dashboard-settings.md).
- A bundler and a paymaster for chain 97741 (EntryPoint v0.7, ERC-7677). PEPU hosts them: the bundler at `https://bundler.pepeunchained.com` (the SDK default) and the paymaster at `https://paymaster.pepeunchained.com/v2/paymaster/<project server key>`. Treat the paymaster URL as a secret. You need your own project (claim, deposit, server key); see [Sponsorship Tiers](sponsorship-tiers.md). The free tier needs a verified Privy token from PEPU's own Privy app and is not available to third-party apps; the session routes forward the signed-in user's Privy token as ERC-7677 context, which a project ignores for billing. Local defaults for self-run services: `http://localhost:4337` and `http://localhost:8788/paymaster/<your-app-key>`.
- Your target contract on the paymaster's destination allowlist, and per-user spend caps above the first-operation reservation.
- Node 18.17 or newer. `npx create-pepu-app@latest my-app --template sponsored-session-app` scaffolds everything below.

## Architecture

```
browser                          your server                           services / chain
-------                          -----------                           ----------------
Google sign-in (Privy)
embedded wallet = OWNER
WalletGate ─ POST /api/wallet/ensure ─► createEnsureWalletRoute()  ──► Privy (create wallet)

useSponsoredSession.grant()
  ─ POST /api/session/prepare ───────► routes.prepare
                                       generateSessionKey()  (private key stays here)
                                       expectedPermissionId(), getKernelAddress()
                                       store.set(record)
  ◄─ { sessionKeyAddress, validUntil, scope, kernelAddress }
  approveKernelSession(): owner signs ONE EIP-712 message (no gas)
  ─ POST /api/session/activate {approval} ─► routes.activate
                                       checkApproval(): this account, this permission id
                                       store.set({ ...record, approval })

useSponsoredSession.act()
  ─ POST /api/session/act ───────────► routes.act
                                       assertCallsInScope()  (fail fast)
                                       loadKernelSessionAccount(approval, sessionPrivateKey)
                                       createPepuSponsoredClient() + sendSponsored()
                                         ─ bundler ─► EntryPoint v0.7 ─► Kernel account
                                         ─ paymaster pays gas             call policy + timestamp
                                                                          policy validate
  ◄─ { transactionHash, userOpHash, paymaster, actualGasCostWei, explorerUrl, actions }

useSponsoredSession.revoke()
  ─ POST /api/session/revoke ────────► routes.revoke  (delete key and approval)
```

| Hop | Package and subpath |
|---|---|
| Provider, wallet gate, token-bearing fetch | `@pepu-chain/sdk/privy/react` |
| Ensure-wallet route, `requireUser` | `@pepu-chain/sdk/privy/server` |
| Five session routes | `@pepu-chain/sdk/combo` (`createSponsoredSessionRoutes`) |
| Browser flow | `@pepu-chain/sdk/combo/react` (`useSponsoredSession`) |
| Policies, owner approval, session account | `@pepu-chain/sdk/session/kernel` |
| Kernel account and sponsored client | `@pepu-chain/sdk/aa/kernel` |
| Endpoint resolution | `@pepu-chain/sdk` (`resolvePepuEndpoints`) |

## Step by step

### 1. Configure Privy and the environment

```
NEXT_PUBLIC_PRIVY_APP_ID=<app id>
PRIVY_APP_SECRET=<app secret, server only>
PEPU_BUNDLER_URL=https://bundler.pepeunchained.com   # server only; the SDK default, so optional
PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<project server key>   # server only; a credential
SESSION_DURATION_MINUTES=15                  # optional; 1 to 1440
PEPU_RPC_URL=                                # optional authenticated RPC for server chain reads
```

Failure modes: login fails or loops (origin, including port); the page shows a setup screen listing what is missing (an env var is empty); `/api/session/*` answers `CONFIG_MISSING_ENV` (a call target or a URL is unset). Caught by: `npm run doctor`, `pepu_check_env`, `pepu_check_privy_config`.

### 2. Ensure the wallet

```tsx
// app/providers.tsx  ("use client")
import { PepuPrivyProvider } from "@pepu-chain/sdk/privy/react";
<PepuPrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID} config={{ loginMethods: ["google", "email"] }}>{children}</PepuPrivyProvider>
```

```ts
// app/api/wallet/ensure/route.ts
import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";
export const { POST } = createEnsureWalletRoute();
```

Wrap the signed-in view in `WalletGate` from `/privy/react`. The owner of the Kernel account is the embedded wallet, so it must exist before a session can start. Failure modes: "Creating your wallet..." hangs (a custom provider is in use), ensure route 401 or 500 (secret), `WalletGate` stalled (reload). See [Social Login and Embedded Wallets](privy-embedded-wallets.md).

### 3. Define one scope and mount the routes

The scope is one shared object imported by both the server routes and the browser, so the policy the user signs and the one the server issued cannot drift.

```ts
// lib/scope.ts
import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import type { KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { tapScoreAbi } from "./tapscore";

const entry = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(entry)) throw new Error("TapScore is not deployed in the SDK registry.");
export const TAPSCORE_ADDRESS = entry.address;
export const scope: { calls: readonly KernelSessionCall[] } = {
  calls: [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
};
```

```ts
// lib/session-routes.ts
import "server-only";
import { createMemoryStore, createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import { scope, TAPSCORE_ADDRESS } from "./scope";
import { tapScoreAbi } from "./tapscore";

export const routes = createSponsoredSessionRoutes({
  scope,
  store: createMemoryStore(), // DEV ONLY: lost on restart, holds session keys in plaintext
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  },
});
```

Each route file is a one-line mount: `app/api/session/prepare/route.ts` exports `routes.prepare.POST`, and likewise `activate` (POST), `status` (GET), `act` (POST) and `revoke` (POST). Defaults match what `useSponsoredSession` calls. Options worth knowing: `endpoints` (explicit bundler and paymaster URLs), `minutes`, `authenticate` (custom auth), `publicClient`, `privy`.

Failure modes: a malformed scope throws at startup; an empty call target makes every route answer `CONFIG_MISSING_ENV` instead.

### 4. Start the session in the browser

```tsx
"use client";
import { useSponsoredSession, type SponsoredActResult } from "@pepu-chain/sdk/combo/react";
import { describeKernelSessionScope } from "@pepu-chain/sdk/session/kernel";
import { scope } from "@/lib/scope";

export function SessionFlow() {
  const { phase, statusLoading, smartAccount, owner, expiresAt, actions, grant, act, revoke, error } =
    useSponsoredSession<undefined, SponsoredActResult>({ scope });

  if (statusLoading) return <p>Checking session...</p>;
  if (phase === "ready" || phase === "expired") {
    const preview = describeKernelSessionScope({ calls: scope.calls, validUntil: Math.floor(Date.now() / 1000) + 900 });
    // Render preview.calls as the consent screen, then:
    return <button onClick={grant}>Approve one session</button>;
  }
  if (phase === "active") {
    return (
      <>
        <button onClick={() => act()}>Tap (no popup, no gas)</button>
        <button onClick={revoke}>Revoke</button>
      </>
    );
  }
  return <p>{error?.message ?? phase}</p>;
}
```

`grant()` runs prepare, the one owner signature and activate. `phase` is one of `signed-out`, `provisioning`, `ready`, `granting`, `active`, `expired`, `error`. `smartAccount` (the Kernel address) is a read and is known before any session exists; show it, not the owner address, as the account that transacts. Failure modes: Privy's signature prompt for `eth_signTypedData_v4` on chain 97741 does not appear or errors (not exercised by a person yet; check the Privy dashboard and the console); the scope on the browser differs from the server's (400 `SESSION_APPROVAL_MISMATCH`); the offer expired before the user approved (410 `SESSION_EXPIRED`, call grant again).

### 5. Act

`act(input)` posts to the act route. The server re-checks the calls against the scope (`assertCallsInScope`, fail fast), takes a per-user lock, loads the session account, sends one UserOperation and waits up to 90 seconds for the receipt. The first action of a session also deploys the Kernel account and enables the permission on-chain, so it costs more. The result tells you who paid: `paymaster` is the sponsoring contract, and `actualGasCostWei` is a decimal string. Failure modes:

| Response | Meaning | Fix |
|---|---|---|
| 409 `SESSION_NONE` | No live approved session | Grant again |
| 403 `POLICY_UNSCOPED` | A call is outside the scope | Fix `buildCalls`, or widen the scope on purpose |
| 429 "An action is already in flight" | Another act is running for this user | Retry shortly |
| `PAYMASTER_*` or `AA3x` | Sponsorship denied or no deposit | See [Sponsored Transactions](sponsored-transactions.md) |
| `trailing-hour spend ... would exceed cap` | Per-user caps below the reservation (about 20.5 PEPU first operation, 6.9 later) | Raise caps; `SESSION_GAS_RESERVATION_PEPU` exports the numbers |
| `BUNDLER_AA_FAILED` `AA25` | Nonce conflict | Wait and retry |
| `BUNDLER_UNREACHABLE` | `PEPU_BUNDLER_URL` unset or down | Fix the URL; `pepu_bundler_health` |

### 6. Revoke

`revoke()` deletes the server-held key and approval at once, so the app can no longer act. It does not uninstall the permission on-chain (see below). Offer it anyway, and keep sessions short.

## What is enforced on-chain and what is not

| Property | Enforced by | Strength |
|---|---|---|
| Only the listed contracts and function selectors, value at most `valueLimit` | Call policy v0.0.4 `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2`, checked in UserOperation validation | On-chain. Holds even if your server is compromised |
| Valid only until `validUntil` | Timestamp policy `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | On-chain |
| The session is the one the owner approved | The owner's EIP-712 signature and the permission id | On-chain |
| `assertCallsInScope`, approval and permission-id checks in `activate` | Your server | Off-chain, fail fast only. The chain is the real enforcement |
| What the paymaster pays for | Paymaster policy service and contract | Off-chain allowlist plus on-chain signature check. Limits sponsorship money, not the user's account |
| Revocation | Server deletes the key | Immediate for your app. On-chain the grant lapses at expiry |
| Who owns the account | Owner address from Privy's records for the verified token, never from the request | Server check |

## Production notes

- **`createMemoryStore()` is dev-grade.** A restart ends every session, it does not work across serverless instances, and the session private key sits in plaintext process memory. Production implements `SessionStore` (`get`, `set`, `delete`, `tryLock`, `unlock`) on a database or KV, encrypts `sessionPrivateKey` at rest, and uses an atomic or distributed lock for `tryLock`. Nothing else in the SDK changes.
- **Gas budget.** Size the paymaster's per-user hourly and daily caps and your app's daily cap above the reservation numbers.
- **Never expose** `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` to the browser. These routes run them server-side.
- **Session store.** The template stores sessions in memory; use a persistent store in production.

## Verify

1. `npm run doctor` (the template's script; runs the SDK's `checkPepuEnv`; prints no values).
2. `pepu_check_privy_config` with `appId`, `origin: "http://localhost:3000"`, `pillars: ["login"]`.
3. `pepu_sponsorship_status`: `available: true`, or read the `fixes`.
4. Run the flow with no browser: `PEPU_BUNDLER_URL=... PEPU_PAYMASTER_URL=... npm run prove-session`. It sends real sponsored transactions on mainnet with throwaway keys that need no balance, and checks the account balance (0) and the score (2).
5. By hand: sign in, start a session, tap, confirm both addresses show 0 PEPU, open the explorer link, tap again (cheaper, no deploy), revoke.

### Doctor checks that catch each step

| Step | Check |
|---|---|
| Env | `env.<NAME>` fails for a missing, placeholder or malformed value (Privy id shape, URL shape, `SESSION_DURATION_MINUTES` positive) |
| Privy id | `privy.app-id` format check |
| Chain | `chain.rpc` reports chainId 97741 |
| Sponsorship | `sponsorship.bundler` and `sponsorship.paymaster` (skip when unset, fail when set but unreachable) |
| Dashboard | `privy.login-methods`, `privy.login-methods.google`, `privy.allowed-origins`, `privy.embedded-wallets` when a checker is injected; see [Privy Env Vars and Verification](../privy/env-and-checks.md) |

## Related

- [Sponsored Session: No Popup, No Gas](sponsored-session.md)
- [Session Keys](session-keys.md)
- [Sponsored Transactions](sponsored-transactions.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
- [Architecture: Who Calls What](../concepts/architecture.md)
- [Sponsored Session App](../templates/sponsored-session-app.md)
- [/combo](../sdk/combo.md), [/session/kernel](../sdk/session-kernel.md)
- [Recipes: Sponsored Session in One Flow](../recipes/sponsored-session.md)
