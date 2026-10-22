# Dashboard Settings, Field by Field

Every Privy dashboard setting a PEPU app depends on, with the exact value, why it matters and the symptom when it is wrong. The rows come from `PEPU_PRIVY_REQUIREMENTS` in `@pepu-chain/sdk/privy` and from the live testing recorded in the template READMEs. If you only read one Privy page, read this one.

Menu labels are marked where they may change: Privy renames dashboard sections, and the SDK's table is the checklist of record. Fields Privy's public config does not expose cannot be checked automatically and show as `unknown`, not as a failure.

## Prerequisites

- A Privy app from [dashboard.privy.io](https://dashboard.privy.io).
- Which pillars you use. The last column of the table says which settings each pillar needs.

## The settings

"Menu label" is where the SDK's table says to look. Privy may rename menu labels.

| Setting | Menu label (may drift) | Exact value | Why | Failure symptom | Login | Session (Privy) | Sponsor |
|---|---|---|---|---|---|---|---|
| App ID | Settings, Basics | Copy to `NEXT_PUBLIC_PRIVY_APP_ID` | Public identifier, bundled into client JS | Setup screen "Missing NEXT_PUBLIC_PRIVY_APP_ID"; `privy.app-id` doctor failure | yes | yes | yes |
| App secret | Settings, Basics | Create one; copy to `PRIVY_APP_SECRET`. Server only | The ensure route, `requireUser` and every session route verify access tokens with it | `/api/wallet/ensure` returns 500; or 401 for a valid session when the secret belongs to another app | yes | yes | yes |
| Allowed origins | Configuration, App settings | The exact origin: `http://localhost:3000`, plus each production origin | Privy matches scheme, host and port. `http://localhost` is a different origin | Login iframe blocked by CSP `frame-ancestors`, OAuth init returns 403, console error naming no port | yes | yes | yes |
| Login methods | User management, Authentication | Enable every method you list in `loginMethods` | Methods not enabled here are hidden even if listed in code | Login button shows fewer methods than the code lists | yes | | |
| Google | User management, Authentication, Socials | On | The code-side `"google"` only shows if this is on | No "Continue with Google" button | yes | | |
| Embedded wallets, Ethereum | Wallets | On for Ethereum | The embedded wallet is created here | `WalletGate` errors; ensure route 502 `WALLET_NOT_PROVISIONED` | yes | yes | yes |
| Automatically create embedded wallets on login | Wallets | Either value works. On is fine | The dashboard wins over `createOnLogin` in code. The SDK provisions server-side regardless | With it off and a custom provider, "Creating your wallet..." hangs forever | recommended | | |
| Execution mode | Wallets | The live tests used TEE (`user-controlled-server-wallets-only`) | Selects where keys are reassembled | Behavior of wallet creation changes between modes | note | | |
| Coinbase Wallet eoaOnly | Not a dashboard field: set in code | Use `PepuPrivyProvider` or `createPepuPrivyConfig`, which pin it | Coinbase Smart Wallet does not support chain 97741 | Console: "configured chains are not supported by Coinbase Smart Wallet: 97741" | yes | | |
| Authorization key | Controls (Wallet infrastructure), Authorization keys, New key | Paste the public key from `generatePrivyAuthorizationKey` | Privy checks your server's signature on each signing request | `PRIVY_KEY_QUORUM_MISMATCH` | | yes | |
| Key quorum | Same area; create a quorum that contains the key | Copy its id to `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` | The grant names this quorum as the signer | 401 "No valid authorization keys or user signing keys available" | | yes | |
| Smart Wallets | Wallets, Smart wallets (the demo README says Settings, Wallet infrastructure, Smart wallets) | Enabled; chain `97741`; provider Kernel; bundler URL `PEPU_BUNDLER_URL`; paymaster URL `PEPU_PAYMASTER_URL` | Only the `privy-smart-wallets` transport reads it | Page spins on "Setting up your smart wallet..." | | | Privy transport only |

The combination (`sponsored-session-app`) needs only the Login column. It does not use Smart Wallets, authorization keys or quorums.

## Field notes

### App ID and secret

The App ID is public by design. The secret is server only: never give it a `NEXT_PUBLIC_` prefix, never commit it. Rotate it in the dashboard if it leaks; update `PRIVY_APP_SECRET` and restart. Note the v2 paymaster claim flow sends this secret to the PEPU policy service for one request, so use a dedicated app for sponsorship if you can and rotate afterwards ([Sponsorship Tiers](../onboarding/sponsorship-tiers.md)).

### Allowed origins

Include the exact origin of every environment: local, preview, production. Next.js silently moves to port 3001 when 3000 is taken, and login then fails with errors that never mention the port. Free port 3000 rather than passing `-p 3001`. If you deliberately use another port, add that exact origin first. Every template defaults to 3000, and a Privy app id is typically allow-listed for one set of origins, so do not run two templates at once. Preview deployments get their own URLs, so each preview origin needs an entry, or use one stable staging origin. The SDK check accepts a `*` entry as matching, but a wildcard is a security choice you make, not something this kit recommends.

### Google

For the default Privy-managed Google login, enabling the Socials toggle is all the setup. If you use a custom Google OAuth client (your own client id, redirect URL and consent screen), register the redirect URI the dashboard shows and publish the consent screen before real users arrive.

### Embedded wallets and the creation setting

Turn embedded wallets on for Ethereum. `createPepuPrivyConfig` sets `createOnLogin: "off"` and `WalletGate` calls `createEnsureWalletRoute()` right after login; with the dashboard creation setting off, Privy's own client-side creation hangs, which was reproduced live. Having the dashboard setting on and the server route in place is fine.

### TEE execution mode

TEE (`user-controlled-server-wallets-only`) reassembles wallets inside a secure enclave that only Privy can invoke, gated by the user's session. The legacy mode reassembles on the device. The live tests ran with TEE. Whether TEE is a requirement for anything here is **unverified**; only that setting has been proven.

### Smart Wallets (Privy transport only)

Smart Wallets is Path 2 in [Smart Account Paths](../concepts/smart-account-paths.md). If you are unsure whether you need it, read that page first: most apps (anything with sessions, the free tier or a server) use Path 1 and leave this off.

**Required** for `sponsored-demo`, which uses Privy Smart Wallets. **Not required** for `sponsored-session-app` or any other template: the SDK builds the ZeroDev Kernel account itself. Leaving Smart wallets enabled is harmless there; users then also get a Privy smart wallet linked to their account, which the paymaster also accepts as owned by the user.

For `sponsored-demo` configure, under Wallets, Smart wallets (or Settings, Wallet infrastructure, Smart wallets in older layouts):

| Setting | Value |
|---|---|
| Provider | Kernel (ZeroDev) v3.1 |
| Custom chain | PEPU, chain id `97741`, RPC `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` |
| Bundler URL | `https://bundler.pepeunchained.com` |
| Paymaster URL | `https://paymaster.pepeunchained.com/v2/paymaster/<project CLIENT token ppt_...>` |

Use the project **client token** (`ppt_`) and add your app's origins to the project's allowed origins, because Privy calls the URL from the browser. Never put the server key (`ppk_`) in the dashboard. The free tier cannot be used on this path: the dashboard URL is static and carries no per-user Privy token, so you need a funded project of your own (claim, set targets and limits, deposit, register). Without both URLs the page cannot sponsor anything. Old dashboards may still hold temporary development bundler or paymaster URLs (for example tunnels); replace them with the hosted ones above. See [Sponsored Transactions](../onboarding/sponsored-transactions.md).

### Paymaster credentials by template

| Template | Credential | Where | Secret? |
|---|---|---|---|
| `sponsored-demo` | Project client token `ppt_` | Inside the paymaster URL in the Privy dashboard | No, but only works from the allowed origins |
| `sponsored-session-app` | Project server key `ppk_` in `PEPU_PAYMASTER_URL` | `.env.local`, server only | Yes |
| Others | None | | |

Sponsorship is project first, then the free tier as a fallback when the project cannot cover an operation. The free tier (100 PEPU/day and 50 PEPU/hour per user, TapScore only for now) needs the user's Privy access token from PEPU's own Privy app; the SDK combination routes forward the signed-in user's token automatically, and it is ignored for project billing unless the service can verify it.

### Per-template requirements

| Template | Env vars | Login methods in code | Smart wallets | Extra |
|---|---|---|---|---|
| `consumer-app` | `NEXT_PUBLIC_PRIVY_APP_ID` (public), `PRIVY_APP_SECRET` (secret) | email, google, wallet | Off | Coinbase `eoaOnly` pinned in code |
| `token-gated-app` | same | email, google, wallet | Off | `eoaOnly` pinned |
| `nft-mint` | same | email, google, wallet | Off | `eoaOnly` pinned |
| `game-app` | same, plus `PRIVY_AUTHORIZATION_KEY` (secret), `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` (public id) | email, google, wallet | Off | Authorization key and key quorum |
| `sponsored-demo` | same as `consumer-app` | google, email | Required (above) | Client token in the dashboard URL |
| `sponsored-session-app` | same as `consumer-app`, plus `PEPU_PAYMASTER_URL` (secret), `PEPU_BUNDLER_URL` | google, email | Not required | Server key in env |

Every template also needs Allowed origins (exact origin with port, plus production) and embedded wallets for Ethereum with creation on login. Each template's `.env.example` carries the same checklist as comments. Find the App ID and App Secret under Settings, Basics. The authorization key pair comes from `npm run generate-authorization-key` in `game-app`; the quorum id is shown after you register the public key.

### Authorization keys, key quorums, policies and TTL

See [Authorization Keys and Key Quorums](authorization-keys.md). Policies are not dashboard fields: the SDK creates them per grant through the API. Policy and rule names must be at most 49 characters (`PRIVY_POLICY_NAME_MAX_LENGTH`); Privy's live validator says fewer than 50 although its OpenAPI spec says 50. The session TTL is `SESSION_DURATION_MINUTES` (default 15, clamped to 1 to 1440), baked into the policy's expiry condition.

### Access tokens

Nothing to configure for JWT verification. `verifyRequestUser` verifies the bearer token against Privy with your App ID and App Secret. A verification failure caused by a secret from a different app looks exactly like an expired session, so check the secret first.

## Verify

```ts
import { checkPrivyDashboardConfig } from "@pepu-chain/sdk/privy";
const r = await checkPrivyDashboardConfig({ appId, origin: "http://localhost:3000" });
```

Or the `pepu_check_privy_config` MCP tool. See [Privy Env Vars and Verification](env-and-checks.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Login fails, iframe blocked, OAuth 403 | Origin or port missing | Allowed origins |
| No Google button | Google off in the dashboard | Socials, Google |
| "Creating your wallet..." forever | Custom provider with creation off | `PepuPrivyProvider`, `WalletGate` |
| 401 "No valid authorization keys..." | Quorum id and private key from different keys | Realign; users re-grant |
| "Setting up your smart wallet..." forever | Smart Wallets not set for 97741 | Add chain, Kernel, both URLs |
| Everything `unknown` in the check | Privy's public config did not report fields, or the app id is wrong | Not a failure; verify by hand |

## Related

- [Smart Account Paths: which one needs Smart Wallets](../concepts/smart-account-paths.md)
- [Privy Configuration Overview](index.md)
- [Privy Setup Walkthrough](../onboarding/privy-setup.md)
- [Authorization Keys and Key Quorums](authorization-keys.md)
- [Privy Env Vars and Verification](env-and-checks.md)
