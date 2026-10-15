# PEPU Sponsored Session App

Sign in with Google, approve **one** scoped, time-limited session, and then act on Pepe Unchained V2 with **no wallet popup** and **no gas from the user**. Built on `@pepu-chain/sdk`: the session mechanics are `createSponsoredSessionRoutes` (`/combo`) and `useSponsoredSession` (`/combo/react`), on top of `buildKernelSessionPolicies` and `approveKernelSession` (`/session/kernel`), with the Privy wiring from `/privy`, `/privy/react` and `/privy/server`. The three proven pillars of the PEPU dev kit in one flow:

1. **Google sign-in** with a Privy embedded wallet.
2. **A session granted once**, enforced **on-chain** by the user's smart account.
3. **Sponsored gas**: a paymaster pays, so the user's accounts can stay at 0 PEPU.

Mainnet only (chain 97741). The demo action is `TapScore.tap()` on the shared TapScore contract.

```bash
npx create-pepu-app@latest my-app --template sponsored-session-app
```

## Status: what is verified and what is not

| | State |
|---|---|
| Whole session mechanism, server side | **Proven live on PEPU mainnet** (the original hand-written version, and again after the move onto the SDK, with `npm run prove-session`): a throwaway owner signs one grant, a throwaway session key then sends two sponsored UserOperations that deploy the account and call `tap()`. The smart account balance stays exactly 0, `TapScore.scores(account)` is 2, the paymaster's EntryPoint deposit dropped. |
| Scope is enforced by the chain | **Proven live** (original version, and by the SDK's own `prove-session` script, which this template's script points to). It tries `TapScore.scores(...)` (a different selector on the allowed contract): the account's `validateUserOp` reverts. An already-expired grant is refused. |
| Needed contracts exist on 97741 | **Verified** with `eth_getCode`. **No contract deployment was needed.** See "Contracts". |
| Browser flow (Google login, Privy signature prompt, UI) | **Proven live in a browser on mainnet (2026-10-14)** against the hosted bundler and v2 paymaster: Google sign-in, one Privy `eth_signTypedData_v4` signature on chain 97741, sponsored taps with no popup while the smart account stayed at 0 PEPU, and revoke. Unit and route-wiring tests also pass. Steps to repeat it are at the end. |
| Hosted bundler and paymaster | **Live** at `https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com`, and **proven**: a project-sponsored operation from a fresh 0-PEPU Kernel account went through those URLs on the v2 paymaster (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`, 5.00 PEPU gas including account deployment). The v2 paymaster is a **canary**: internally reviewed 3 times, external audit pending, funded in small tranches. The earlier v1 paymaster is retired. |
| This template's combined flow against the hosted URLs | **Proven by script** (`npm run prove-session`) and **proven live in a browser on mainnet (2026-10-14).** |
| Production-readiness | **No.** Sessions live in server memory (see "Trust model"). |

## Design: who signs, and how the session is scoped

The question that decides everything: for a smart account, **who signs the UserOperation without a popup, and where is the limit enforced?**

I checked three options.

**A. On-chain session key (chosen).** The user's ZeroDev Kernel v3.1 account installs a *permission* made of a **call policy** (target, selector, zero value) and a **timestamp policy** (expiry). The server holds a session key; it signs UserOperations; the paymaster sponsors them. The limits are checked by contracts during UserOperation validation. All the contracts already exist on PEPU (Kernel v3 handles permissions natively, so there is no separate permission-validator contract either).

**B. Privy session signer on the owner EOA.** The server would ask Privy to sign the UserOperation. Privy's Node SDK does have `eth_signUserOperation`, and a policy method of the same name, but I found no documented condition that decodes a UserOperation's inner call, and signing an opaque hash (`personal_sign`) cannot be scoped at all. I did not test it live. Even in the best case the scope would live in Privy's backend, not on-chain. Not chosen.

**C. EIP-7702.** The embedded EOA would delegate to Kernel. The Privy SDK has `eth_sign7702Authorization`, with a policy that can allowlist delegate contracts, but I did not verify it end to end on 97741, and it still needs a separate session mechanism on top. Not chosen. Worth revisiting once someone proves it on PEPU.

**Why A:** it is the only option where the limit is real, auditable and independent of this app's backend and of Privy, and everything it needs is already deployed and working. The cost is that we build the Kernel account with ZeroDev's SDK instead of Privy's smart-wallet client, because Privy's client cannot install a scoped session validator. So **you do not enable Smart Wallets in the Privy Dashboard.**

### How it works

```
browser                          your server                         chain
-------                          -----------                         -----
Google sign-in (Privy)
embedded wallet = OWNER (signer)
Start session  ───────────────►  /api/session/prepare
                                 new session key (private key stays here),
                                 expiry decided here
   ◄─── session key ADDRESS, expiry, scope
owner signs ONE EIP-712 message
(enables the permission)
   ───── approval (no secret) ──► /api/session/activate
                                 checks it is for this user + this scope
Tap ───────────────────────────► /api/session/act
                                 session key signs a UserOperation,
                                 bundler + paymaster (gas sponsored) ───►  EntryPoint
                                                                          Kernel validates:
                                                                          call policy + expiry
   ◄─── tx hash, userOp hash, who paid
Revoke ────────────────────────► /api/session/revoke  (server forgets the key)
```

The first session-signed UserOperation also deploys the smart account (counterfactual) and enables the permission on-chain ("enable mode"). That is why the first action costs more gas than later ones.

## Where the scope is enforced

**On-chain, by the user's smart account.** Not by Privy, and not by this app.

- **Call policy v0.0.4** (`0x9a52283276A0ec8740DF50bF01B28A80D880eaf2`): the account may only call `TapScore` (`0x261eA5971B93237a56990206A46Bc80318e4d078`), only the `tap()` selector (`0xfd221031`), with value exactly `0`.
- **Timestamp policy** (`0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F`): the permission is invalid after `validUntil`.

If the session key signs anything else, the EntryPoint's validation fails, whoever relays it. The definition is one object, `scope` in `lib/scope.ts`: the server turns it into policies with the SDK's `buildKernelSessionPolicies`, the browser rebuilds the same policies for the owner's signature, and the consent screen is rendered from the SDK's `describeKernelSessionScope` over it.

Separately, the paymaster only sponsors calls to **allowlisted destinations**. That is a second, off-chain boundary that limits what sponsorship money can be spent on. It is not what protects the user's account.

## Trust model

- **The owner key** never leaves Privy and the user's browser. The server never signs as the owner.
- **The session key** is held by this app's server. A compromised server, or a leaked session key, can do exactly what the permission allows (`tap()`, zero value) until it expires, and nothing else. It cannot move funds or call other contracts.
- **The approval** (the owner's enable signature plus policy parameters) holds no secret. It is useless without the session key.
- **The server checks** that an approval is for the caller's own smart account, for the session key and expiry it issued, and carries no private key. The chain is the real enforcement; these checks fail fast and avoid sponsoring operations for the wrong account.
- **The user's owner address always comes from Privy's records** for the verified access token, never from the request.
- **Sponsorship is a separate trust relationship:** the paymaster operator decides what to pay for, within its caps.

**Honest limits:**

- **Sessions are stored in server memory** (`createMemoryStore` from the SDK, wired in `lib/session-routes.ts`). A restart ends every session (the user just starts a new one) and it does not work across several serverless instances. For production, implement `SessionStore` on a database or KV and **encrypt the session private key at rest**.
- **Revoking.** "Revoke session" deletes the key and approval on the server, so this app stops acting immediately. It does **not** uninstall the permission on-chain: that is an owner-signed call to the user's own account, and a paymaster destination allowlist should not sponsor calls to arbitrary user accounts. The on-chain grant stays valid until its expiry but only the deleted key can use it, and only for `tap()`. Keep sessions short (default 15 minutes, clamped to 24 hours).
- **Gas reservation and caps.** See "Gas budget" below; the SDK exports the measured numbers as `SESSION_GAS_RESERVATION_PEPU`.
- **Smart account address is per owner.** The address does not change between sessions. Funds sent to the signer (EOA) do not appear in the smart account, and the reverse. See the "Two-Address Model" page of the PEPU docs (guide.pepeunchained.com).

## Contracts

Checked with `eth_getCode` on chain 97741, 2026-10-02. All present at ZeroDev's deterministic addresses.

| Contract | Address |
|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Kernel v3.1 implementation | `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` |
| Kernel v3.1 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` |
| ECDSA root validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` |
| ECDSA signer module | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` |
| Call policy v0.0.4 | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` |
| Timestamp policy | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` |
| Rate-limit, gas, signature and sudo policies | also present (unused here) |

Call policy **v0.0.5** (`0x85770b90…`) is **not** deployed on PEPU. This template uses v0.0.4, which is. The SDK pins `CallPolicyVersion.V0_0_4` in `buildKernelSessionPolicies`; if you upgrade the ZeroDev packages, check `eth_getCode` for every contract on 97741 first.

## What this app needs from outside

- **A Privy app** (App ID and secret), with Google login enabled and `http://localhost:3000` in Allowed origins. No Smart Wallets setting.
- **A bundler.** `PEPU_BUNDLER_URL=https://bundler.pepeunchained.com` (the SDK default, and what `.env.example` sets). Or run your own: `services/bundler` in the devkit repo, port 4337.
- **A paymaster URL with a token.** `PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<token>`. The URL always embeds a credential, and this template sends from your **server**, so use your project's **server key** (`ppk_`) and treat the URL as a secret. A **client token** (`ppt_`) works only from your project's allowed browser origins and is refused here (`project_origin_not_allowed`).
- **The free tier is not your path, unless your Privy app is PEPU's.** PEPU funds 100 PEPU/day and 50 PEPU/hour per user, but it needs a verified Privy access token from PEPU's own Privy app in the ERC-7677 context, and today the only free-tier target is TapScore. A token from your own Privy app does not qualify (the service cannot verify it, so it is ignored). The session routes forward the signed-in user's token as `context.privyAccessToken` (`forwardPrivyToken`, default on). When the service can verify it, it must belong to a user who owns the sender: the Kernel account of one of their Privy embedded wallets (what this template creates) passes; anything else is denied with `sender_not_owned_by_token_user`, even if your project could have paid. Set `forwardPrivyToken: false` if you point the URL at a service you do not trust with it.
- **Project first, free tier as the fallback.** The service tries your project, then the free tier, per operation. A new user's first operation also deploys their account and reserves about 20 PEPU, more than a small project balance covers; on a PEPU-Privy-app deployment that operation then falls back to the free tier with no error, and later operations use the project again.
- Optionally `PEPU_RPC_URL`, an authenticated PEPU RPC for server chain reads (replaces the old `CONDUIT_API_KEY`).
- **Your own project** (the developer flow): sign in with SIWE (`/v2/auth`), `POST /v2/projects/verify` with your Privy app id and secret (used for one request, never stored), `claimProject` on the v2 paymaster (immediate if the project is empty; pending 48 hours if it already holds funds), `setTargets` (include TapScore), `setDailyLimit` and `setSenderDailyLimit`, `depositFor` (one-way: nobody can withdraw it; the v2 paymaster is a canary, so deposit small amounts), register the project, then copy its server key and client token. The MCP tool `pepu_prepare_project_tx` encodes each transaction without signing. See the docs page "Register, deposit, claim".

The app shows a setup screen listing whatever is missing. `/api/config` reports booleans only.

### Gas budget (measured)

The policy service reserves each operation's **worst-case** cost. On PEPU mainnet the first operation of a session (deploy plus enable permission) reserved about **20.5 PEPU**, and later ones about **6.9 PEPU**; the real first-session cost measured about 12.8 PEPU for two taps. With the stock per-user hourly cap of 25 PEPU, a second tap in the same hour was denied (`trailing-hour spend ... would exceed cap`). Size your caps (`USER_HOURLY_SPEND_CAP_WEI`, `USER_DAILY_SPEND_CAP_WEI`, your app's `dailySpendCapWei`) above that, or users will hit a wall after their first tap.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Privy, bundler and paymaster values
npm run dev                  # http://localhost:3000 (the port must be 3000 for Privy)
```

## Prove it without a browser

```bash
PEPU_BUNDLER_URL=https://bundler.pepeunchained.com \
PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<your-project-server-key> \
npm run prove-session
```

`scripts/prove-session.ts` (about 50 lines) runs this template's own scope through the SDK's `createSponsoredSessionRoutes` with a throwaway owner: prepare, one owner signature (`approveKernelSession`), activate, two taps, the account balance (0), the score (2), then revoke. It sends **real sponsored transactions** on mainnet with random throwaway keys that need no balance.

The two refusals (a different selector on the allowed contract, an expired grant) are covered by the SDK's own `prove-session` script (`pnpm --filter @pepu-chain/sdk prove-session` in the devkit repo), not duplicated here.

## Tests

```bash
npm test         # the template's scope, the route wiring, formatting (policy, approval, store and route behaviour are tested in the SDK)
npm run typecheck && npm run lint && npm run build
```

## Manual browser test (how to repeat it)

1. Fill `.env.local` (the hosted bundler is the default; add your project's paymaster URL), `npm run dev`.
2. Open `http://localhost:3000`. Sign in with Google.
3. Confirm both addresses show (Signer and Smart account), both at `0 PEPU`.
4. Click **Start session**. Read the consent screen. Click **Approve**. Privy asks for **one** signature. Approve it.
5. Click **Tap**. No popup should appear. After a few seconds the Evidence panel shows a transaction link, the sender (smart account), "Gas paid by paymaster ..." and a cost. Open the pepuscan link.
6. Tap again (cheaper, no deploy). Confirm balances are still `0 PEPU`.
7. Click **Revoke session**. Tap is gone; start a new session to continue.
8. Things to watch: the Privy signature prompt appearing for `eth_signTypedData_v4` on chain 97741 (exercised in the 2026-10-14 run), and whether Privy shows more than one prompt.

## Files

- `lib/scope.ts` the only place the scope is defined (`tap()` on TapScore, address from the SDK registry).
- `lib/session-routes.ts` `createSponsoredSessionRoutes` plus the in-memory store; `app/api/session/{prepare,activate,status,act,revoke}` are one-line mounts of it.
- `app/api/wallet/ensure` is `createEnsureWalletRoute()`; `app/providers.tsx` is `PepuPrivyProvider`; the wallet gate is the SDK's `WalletGate`.
- `components/session-flow.tsx` the flow on `useSponsoredSession`; `consent-screen.tsx`, `address-card.tsx`, `action-panel.tsx`.
- `scripts/prove-session.ts` the live end-to-end proof, against the SDK.

## Adapting it

To sponsor your own contract: change the ABI in `lib/tapscore.ts`, then `scope` in `lib/scope.ts` and `act.buildCalls` in `lib/session-routes.ts`, deploy the contract, and add it to your project's targets (`setTargets`). Each `KernelSessionCall` takes a target, an ABI, a function name and an optional `valueLimit`; add more calls for more functions (argument rules and ZeroDev's rate-limit policy are not wrapped by the SDK yet). Keep the policy as narrow as the action allows: it is the user's safety, not a formality.
