# Template: Sponsored Session App

The `sponsored-session-app` template combines all three pillars in one flow: sign in with Google, approve one scoped, time-limited session, then act on Pepe Unchained V2 with no wallet popup and no gas from the user. The session is an on-chain ZeroDev Kernel permission and a paymaster pays the gas, so the user's accounts can stay at 0 PEPU. The demo action is `TapScore.tap()`.

![The live sponsored-session demo sign-in screen on desktop and mobile: Grant once, then act, with no popups and no gas](../.gitbook/assets/demo.png)

*The live demo's sign-in screen. [Try the live demo](https://roadmap-demo.pepeunchained.com).*

Live demo: [roadmap-demo.pepeunchained.com](https://roadmap-demo.pepeunchained.com) (being deployed now).

Sessions live in server memory in this template; use a persistent store in production. `npm run prove-session` runs the mechanism from a script: a throwaway owner signs one grant and a throwaway session key then sends two sponsored UserOperations that deploy the account and call `tap()`. The smart account balance stays 0 and `TapScore.scores(account)` is 2. The browser flow is Google login, one `eth_signTypedData_v4` signature on chain 97741, sponsored taps with no popup, and revoke. It uses the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`); you must bring a project: claim it, set targets and limits, deposit, and use its server key (below).

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes: Google is required. The embedded wallet is the owner of the smart account |
| Session keys | Yes: an on-chain Kernel permission made of a call policy and a timestamp policy |
| Sponsored transactions | Yes: direct bundler and paymaster, no Privy Smart Wallets |
| The combination | Yes |

Who signs and where the limit lives:

```text
Google sign-in (Privy)  -> embedded wallet = OWNER
Start session           -> server makes a session key, decides expiry
Owner signs ONE EIP-712 message that enables the permission
Tap                     -> the session key signs a UserOperation; the bundler and paymaster send it
Kernel validates        -> call policy + expiry, on-chain
Revoke                  -> the server forgets the key
```

The first session-signed UserOperation also deploys the smart account and enables the permission, so the first action costs more gas than later ones.

Scope enforcement is on-chain, by the user's smart account, not by Privy and not by the app:

- Call policy v0.0.4 (`0x9a52283276A0ec8740DF50bF01B28A80D880eaf2`): only `TapScore` (`0x261eA5971B93237a56990206A46Bc80318e4d078`), only the `tap()` selector (`0xfd221031`), value exactly zero.
- Timestamp policy (`0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F`): the permission is invalid after the expiry.

The paymaster separately sponsors only allowlisted destinations. That is an off-chain boundary on what sponsorship money can be spent on, not what protects the user.

## Scaffold

```bash
npx create-pepu-app@latest my-app --template sponsored-session-app
```

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| The five session routes (prepare, activate, status, act, revoke) | `createSponsoredSessionRoutes`, `createMemoryStore` (`/combo`) | `lib/session-routes.ts`, `app/api/session/*` |
| The client flow | `useSponsoredSession` (`/combo/react`) | `components/session-flow.tsx` |
| The on-chain scope | `buildKernelSessionPolicies`, `approveKernelSession`, `describeKernelSessionScope`, `isCallInScope` (`/session/kernel`) | `lib/scope.ts` |
| Privy provider | `PepuPrivyProvider`, `WalletGate` (`/privy/react`) | `app/providers.tsx` |
| Wallet provisioning | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure` |
| Shared trust text | `SESSION_TRUST_NOTICE`, `resolveSessionMinutes` (`/session`) | consent screen |
| Explorer links, errors | `explorerLinks`, `PepuError` (core) | components |

The state machine lives in the SDK; the route files are one-line mounts. The Kernel account is built with ZeroDev's SDK, not Privy's smart-wallet client, because Privy's client cannot install a scoped session validator. That is why you do not enable Smart Wallets in the Privy dashboard.

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public. |
| `PRIVY_APP_SECRET` | Yes | Server only. |
| `PEPU_BUNDLER_URL` | No | Server only. ERC-4337 v0.7 bundler tuned for PEPU. Defaults to `https://bundler.pepeunchained.com`; `.env.example` sets it. Local default for your own: `http://localhost:4337`. |
| `PEPU_PAYMASTER_URL` | Yes | Server only. `https://paymaster.pepeunchained.com/v2/paymaster/<project server key>`. The server key (`ppk_`) is secret, so this URL is a credential. The session routes forward the signed-in user's Privy token as ERC-7677 context (ignored for project billing unless the service can verify it, in which case it must belong to the owner of the sending account; the free tier is the automatic fallback when the project cannot cover an operation). Local default for your own: `http://localhost:8788/paymaster/<your-app-key>`. |
| `SESSION_DURATION_MINUTES` | No | Default 15, clamped to 24 hours. Baked into the on-chain permission. |
| `PEPU_RPC_URL` | No | Authenticated RPC for server chain reads. Falls back to the public endpoint. |

What you must configure to sponsor with your own project (the free tier is not available here: it needs a verified Privy token from PEPU's own Privy app, and a third-party app's own Privy token is ignored for billing):

1. Sign in with Ethereum to the policy service (`/v2/auth/nonce`, `/v2/auth/login`).
2. Verify your Privy app: `POST /v2/projects/verify` with the Privy app id and secret (used for one request, never stored).
3. Claim the project (`claimProject`): immediate if the project is empty, pending 48 hours if someone already funded it.
4. Set the targets and limits: `setTargets` (include `TapScore`), `setDailyLimit`, `setSenderDailyLimit`.
5. Deposit PEPU (`depositFor`). Deposits are one-way, so deposit only what your project needs.
6. Register the project to get the server key (`ppk_`, secret) and a client token (`ppt_`, which works only from the allowed origins you set; this template's server does not need it).
7. Put the server key in `PEPU_PAYMASTER_URL`.

See [Sponsorship Tiers](../onboarding/sponsorship-tiers.md) and [Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md).

Privy dashboard checklist (the same list sits in the template's `.env.example`). Doctor requirements `login-methods`, `allowed-origins`, `embedded-wallets`:

- Env: `NEXT_PUBLIC_PRIVY_APP_ID` (public) and `PRIVY_APP_SECRET` (secret, server only), both under Settings, Basics.
- Allowed origins: the exact origin with the port, `http://localhost:3000`, plus your production domain.
- Login methods: Google and email, matching `loginMethods` in `app/providers.tsx` (the doctor checks Google as `login-methods.google`).
- Embedded wallets: enable for Ethereum, create on login. `WalletGate` calls `/api/wallet/ensure` after login and creates the wallet server-side with the app secret if the dashboard setting is off, so both together is fine. TEE (user-controlled) mode is what the live tests used.
- Coinbase `eoaOnly` does not apply: this template offers no external wallets.
- Smart Wallets: not required. The SDK builds the ZeroDev Kernel account itself. Leaving it enabled is harmless: users then also get a Privy smart wallet linked, which the paymaster also accepts as owned. If an old dashboard still has temporary development bundler or paymaster URLs (tunnels), replace them with the hosted ones or turn Smart Wallets off.
- Paymaster credential: `PEPU_PAYMASTER_URL` holds the project server key (`ppk_`), server only. Sponsorship tries your project first and falls back to the free tier; the free tier needs the user's Privy token from PEPU's own Privy app, which the SDK combination routes forward automatically.

Field by field: [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

Your app must also be registered in the paymaster policy service with `TapScore` in its allowed destinations. See [Policy, Caps and the Circuit Breaker](../infra/paymaster/policy-and-caps.md).

Gas budget (measured): the policy service reserves each operation's worst-case cost, about 20.5 PEPU for the first operation of a session (deploy plus enable permission) and about 6.9 PEPU for later ones. The real first-session cost measured about 12.8 PEPU for two taps. With the stock per-user hourly cap of 25 PEPU, a second tap in the same hour was denied. Size `USER_HOURLY_SPEND_CAP_WEI`, `USER_DAILY_SPEND_CAP_WEI` and your app's `dailySpendCapWei` above that. The SDK exports the numbers as `SESSION_GAS_RESERVATION_PEPU`.

## Run and check

```bash
cd my-app
npm install
npm run doctor
npm run dev                  # http://localhost:3000, the port must be 3000
npm test                     # scope, route wiring, formatting
```

Prove it without a browser (this sends real sponsored transactions on mainnet with throwaway keys that need no balance):

```bash
PEPU_BUNDLER_URL=http://localhost:4337 \
PEPU_PAYMASTER_URL=http://localhost:8788/paymaster/<your-app-key> \
npm run prove-session
```

It runs the template's own scope through `createSponsoredSessionRoutes`: prepare, one owner signature, activate, two taps, the account balance (0), the score (2), then revoke. The two refusals (a different selector on the allowed contract, an expired grant) are covered by the SDK's own `prove-session` script (`pnpm --filter @pepu-chain/sdk prove-session` in the devkit repository).

## Project structure

```text
lib/scope.ts             the only place the scope is defined (tap() on TapScore, address from the SDK registry)
lib/session-routes.ts    createSponsoredSessionRoutes plus the in-memory store
lib/tapscore.ts          the ABI
app/api/session/{prepare,activate,status,act,revoke}   one-line mounts
app/api/wallet/ensure    createEnsureWalletRoute()
components/              session-flow, consent-screen, address-card, action-panel
scripts/prove-session.ts end-to-end session script for mainnet
```

## Limitations

- The template is a reference implementation. Review the trust model below before production use.
- Sessions are stored in server memory; use a persistent store in production.

## Trust model and limits

- The owner key never leaves Privy and the user's browser. The server never signs as the owner.
- The session key is held by your server. A compromised server or a leaked key can do exactly what the permission allows (`tap()`, zero value) until it expires, and nothing else.
- The approval holds no secret. The owner address always comes from Privy's records for the verified access token, never from the request.
- Sessions are stored in server memory (`createMemoryStore`). A restart ends every session and it does not work across several serverless instances. For production, implement `SessionStore` on a database or KV and encrypt the session private key at rest.
- Revoke deletes the key and approval on the server, so the app stops acting immediately. It does not uninstall the permission on-chain. The grant stays valid until its expiry but only the deleted key can use it, and only for `tap()`. Keep sessions short.
- The smart account address is per owner and does not change between sessions. Funds sent to the signer do not appear in the smart account. See [The Two-Address Model](../onboarding/two-address-model.md).

## Customizing it

To sponsor your own contract: change the ABI in `lib/tapscore.ts`, then `scope` in `lib/scope.ts` and `act.buildCalls` in `lib/session-routes.ts`; deploy the contract; add it to the paymaster's allowlist and your app's allowed destinations. Each `KernelSessionCall` takes a target, an ABI, a function name and an optional `valueLimit`; add more calls for more functions. Argument rules and ZeroDev's rate-limit policy are not wrapped by the SDK yet. Keep the policy as narrow as the action allows: it is the user's safety, not a formality. See [Sponsored Session in One Flow](../recipes/sponsored-session.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Setup screen lists missing items | Env not set | Run `npm run doctor` and fill `.env.local`. `/api/config` reports booleans only. |
| A second tap is denied with a trailing-hour cap message | Per-user cap below the gas reservation | Raise the caps above about 20.5 PEPU for the first operation and 6.9 after. |
| Denied for the destination | `TapScore` is not in the paymaster's allowed destinations | Add it for your app. |
| Sessions vanish | Server restart with the in-memory store | Expected in development. Use a persistent, encrypted store in production. |
| Login hangs or returns 403 | Wrong port or origin, or Google not enabled | Use `http://localhost:3000`, allow it, enable Google. |
| `sponsored session` calls fail with a config error | `PEPU_BUNDLER_URL` or `PEPU_PAYMASTER_URL` unset | Set both, then run `pepu_sponsorship_status`. |

## Related

- [Template Gallery](index.md)
- [Sponsored Session: No Popup, No Gas](../onboarding/sponsored-session.md)
- [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md)
- [Template: Game App](game-app.md)
