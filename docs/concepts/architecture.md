# Architecture: Who Calls What

One page showing the browser, your Next.js route handlers, Privy, the RPC, the bundler, the paymaster and the EntryPoint, and which credential each hop uses. Use it to find which package owns a hop and where a failure comes from.

> Status: the plain and Privy-session paths are proven on mainnet. The sponsored path is proven on mainnet through the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`), with the v2 paymaster deployed as a canary (internally reviewed 3x, external audit pending). The full combination of Google login, a Kernel session key and sponsorship is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster.

## Components

```
                       ┌────────────────────────── your app ───────────────────────────┐
 browser ──────────────► Next.js route handlers (SDK server entries) ──► PEPU RPC (Conduit)
 PepuPrivyProvider            │        │                │
 hooks (SDK react)            │        │                └──► bundler (ERC-4337 v0.7) ─► EntryPoint ─► Kernel account
        │                     │        └──► paymaster (ERC-7677 policy service) ─► signs, pays from deposit
        └──► Privy (login, wallets, signing, policies)
```

| Component | Role | Credential used |
|---|---|---|
| Browser | Login, owner signatures, UI | Privy access token (bearer) to your server |
| Route handlers | Verify the token, provision wallets, hold session keys, call services | `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, session private key, paymaster URL |
| Privy | Users, embedded wallets, policy engine, signing | App ID (public), app secret, authorization key |
| PEPU RPC | Chain reads and raw transaction broadcast | None (public), or an authenticated URL via `PEPU_RPC_URL` |
| Bundler | Accepts UserOperations, submits through EntryPoint | `PEPU_BUNDLER_URL` (private network or credential) |
| Paymaster | Approves sponsorship, pays gas | App key embedded in `PEPU_PAYMASTER_URL`; Privy access token for the free tier (v2) |
| EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Validates and executes UserOperations | None |

## Sequences

### Plain transaction (embedded wallet, user pays gas)

1. Browser: `PepuPrivyWagmiProvider`, wagmi `useSendTransaction` on the pinned embedded wallet.
2. Privy's confirmation modal; the wallet signs; the transaction is broadcast to the PEPU RPC.
3. Bundler, paymaster and your server are not involved.

### Privy session action (user pays gas)

1. Browser: `useSessionAct` posts to your action route with `Authorization: Bearer <token>` (`usePepuAuthFetch`).
2. Server: `createSessionActionRoute` verifies the token, finds the delegated wallet, re-checks the call against the scope.
3. Server to Privy: `eth_signTransaction` with `PRIVY_AUTHORIZATION_KEY`. Privy's policy engine evaluates the policy.
4. Server to RPC: `signAndBroadcast` sends the raw transaction (Privy's server-side `eth_sendTransaction` rejects chain 97741).

### Sponsored UserOperation (Privy Smart Wallets or direct)

1. Browser: `useSponsoredSend` (Privy Smart Wallets) or `useDirectSponsoredSend` (own bundler and paymaster) sends from the Kernel account (owner: embedded wallet).
2. Client to paymaster: `pm_getPaymasterStubData`, then bundler gas estimation, then `pm_getPaymasterData` (the second call is the authorization; stub data is unauthenticated by spec).
3. Owner signs the UserOperation; client sends `eth_sendUserOperation` to the bundler.
4. Bundler submits `handleOps` to the EntryPoint; the EntryPoint validates the account and the paymaster signature, executes, and charges the paymaster's deposit.

### Sponsored session action (the combination)

1. Browser: `useSponsoredSession.act()` posts to `/api/session/act`.
2. Server: `createSponsoredSessionRoutes` checks the live session, `assertCallsInScope`, takes the per-user lock.
3. Server: `loadKernelSessionAccount` rebuilds the account from the approval and the session key; `createPepuSponsoredClient` and `sendSponsored` send one UserOperation through the bundler with the paymaster.
4. EntryPoint: the Kernel account's validation runs the call policy and timestamp policy on-chain. Out of scope fails here.

## Package and subpath owning each hop

| Hop | Owner |
|---|---|
| Provider, wallet gate, hooks for auth | `@pepu-chain/sdk/privy/react`, `/privy/wagmi` |
| Token verification, ensure wallet, `requireUser` | `/privy/server` |
| Session policy, grant, act, revoke (Privy) | `/session`, `/session/server`, `/session/react` |
| Kernel policies, owner approval, session account | `/session/kernel` |
| Kernel account, sponsored client, probes | `/aa`, `/aa/kernel`, `/aa/react`, `/aa/react-direct` |
| Five session routes and browser flow | `/combo`, `/combo/react` |
| v2 project helpers, REST client | `/paymaster`, `/paymaster/server` |
| Endpoint resolution | root (`resolvePepuEndpoints`, `PEPU_HOSTED` in `src/endpoints.ts`) |
| Readiness checks | `/doctor` |

## Local development versus hosted

| | Local development | Hosted |
|---|---|---|
| Bundler | `http://localhost:4337` (`services/bundler`) | `https://bundler.pepeunchained.com` (SDK default for `PEPU_BUNDLER_URL`) |
| Paymaster | `http://localhost:8788/v2/paymaster/<token>` (`services/paymaster/policy-service`) | `https://paymaster.pepeunchained.com/v2/paymaster/<token>` in `PEPU_PAYMASTER_URL`; the token is always part of the URL, so there is no tokenless default (the SDK default is the base `https://paymaster.pepeunchained.com`) |
| App | `http://localhost:3000` (must match Privy Allowed origins) | Your production origin, also in Allowed origins |

The hosted URLs live in one place, `PEPU_HOSTED` in `packages/sdk/src/endpoints.ts` (`bundlerUrl`, `paymasterBaseUrl`, and `paymasterUrl: null`), and the SDK, MCP server and docs read it. See [Infrastructure Map](../infra/overview.md).

## Common failures

| Symptom | Hop | Fix |
|---|---|---|
| 401 from your route | Browser to server | Secret belongs to another app, or no token; see [Privy Env Vars](../privy/env-and-checks.md) |
| `BUNDLER_UNREACHABLE` | Server to bundler | Fix `PEPU_BUNDLER_URL` |
| `PAYMASTER_*` | Server to paymaster | [Error Reference](../reference/errors.md) |
| UserOperation reverts at validation | Kernel account | Call outside session scope, or expired |

## Related

- [The Three Pillars](../get-started/pillars.md)
- [Trust and Security Model](trust-and-security.md)
- [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md)
