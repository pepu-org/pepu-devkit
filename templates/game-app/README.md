# PEPU Game Template — play without a popup per move

A Next.js starter for Pepe Unchained V2 (chain `97741`) showing how a game can write on-chain on every move **without asking the player to approve a wallet popup each time**.

The player signs in with Google or email, grants a **scoped session signer once**, and then plays. Each tap is a real transaction, submitted by this app's backend on their behalf.

```bash
cp .env.example .env.local   # fill in — see Setup
npm run dev
```

The app runs with nothing configured and tells you exactly what is missing.

---

## How it works

1. **Sign in** — the player gets an embedded wallet (no seed phrase, no extension) — see "Wallet provisioning" below for exactly how.
2. **Grant a session** — one consent screen, one signature. The player sees precisely what they are authorizing.
3. **Play** — the backend submits `tap()` per move. No further prompts.
4. **Revoke** — available at any time from the UI; sessions also expire on their own.

This uses **Privy session signers on a plain embedded EOA**. It does
*not* require ERC-4337 — even though EntryPoint v0.6/v0.7, the Kernel
factory, and the v2 paymaster are deployed on Pepe Unchained
V2 mainnet and PEPU hosts the bundler and paymaster service, sponsorship
needs a project token this template does not use, so a smart-account
approach would still have to self-fund its own gas and buys nothing
over a plain EOA here.

---

## How this is actually enforced

Read this before shipping a real game on it.

Every session signer this template creates has a policy attached that scopes it to exactly four things. The policy is built by the SDK's `buildSessionPolicy` from the one scope in `lib/scope.ts`:

| Constraint | Value |
|---|---|
| Contract | only the deployed `TapScore` address |
| Function | only `tap()` — matched by selector |
| Value | must be exactly `0x0` |
| Expiry | denied after `SESSION_DURATION_MINUTES` |

**Policy and rule names must be at most 49 characters.** Privy's live validator says "must be fewer than 50 characters" (its published OpenAPI spec says 50, which is wrong by one). `buildSessionPolicy` enforces this (`PRIVY_POLICY_NAME_MAX_LENGTH`, error `POLICY_NAME_TOO_LONG`) instead of letting Privy return an opaque 400; if you pass a custom `name`, keep it short.

**That scope is enforced by Privy's backend policy engine, not by an on-chain validator contract.**

This is a real difference from an ERC-4337/ERC-7579 session-key module, where limits live in on-chain code that anyone can audit and that applies regardless of who relays the transaction. Here you are trusting Privy's policy engine to enforce the rules. That is a reasonable trust assumption — it is the same infrastructure already holding the wallet — but it is a different one, and a studio evaluating this deserves to know which they are getting.

The end state for PEPU is session keys on a smart account. A Kernel session key on a smart account (`sponsored-session-app`) moves the limits on-chain.

**One platform limitation worth knowing about:** Privy's server-side `eth_sendTransaction` — which both signs and broadcasts in one call — does not support chain 97741 ("Unsupported chain with id 97741"). This is a genuine gap in Privy's managed chain infrastructure for that RPC method specifically, not a bug in this template's request shape, and not the same thing as the client-side embedded-wallet signing this app also does (which works fine on 97741, because it broadcasts through an RPC endpoint this app configures, not Privy's own). The SDK's `createSessionActionRoute` (`app/api/game/tap/route.ts`) works around it by asking Privy to *sign* only (`eth_signTransaction`, which has no chain allowlist) and broadcasting the signed transaction itself via PEPU's RPC (`signAndBroadcast`, with a 20% gas-limit buffer). The policy engine enforces the same four conditions either way. Set `PEPU_RPC_URL` to broadcast through an authenticated endpoint such as a Conduit URL.

**The template deliberately contains no code path that grants an unscoped signer** — not even a commented-out "simpler" version. Privy policies are opt-in, and a signer with no policy attached can do anything with the wallet. `buildSessionPolicy` refuses to build an unscoped policy, and `lib/scope.ts` is the single place the scope is defined, so loosening it cannot happen quietly in review. `lib/scope.test.ts` pins the four conditions and the name limit.

---

## Built on the SDK

| Job | `@pepu-chain/sdk` function |
|---|---|
| Providers (Privy, react-query, wagmi, active-wallet pin) | `PepuPrivyWagmiProvider` (`/privy/wagmi`) |
| Wallet provisioning | `createEnsureWalletRoute` (`/privy/server`), `useEnsureWallet`, `useEmbeddedWallet` (`/privy/react`) |
| Scoped policy and consent-screen data | `buildSessionPolicy`, `describeSessionScope`, `SESSION_TRUST_NOTICE` (`/session`) |
| Grant, status and revoke routes | `createSessionRoutes` (`/session/server`) |
| The `tap()` route (sign with Privy, broadcast) | `createSessionActionRoute` (`/session/server`) |
| Client session flow | `useSessionGrant`, `useSessionStatus`, `useSessionRevoke`, `useSessionAct` (`/session/react`) |
| Authorization key generation | `generatePrivyAuthorizationKey` (`/doctor`) |
| Explorer links | `explorerLinks` |

Trust model: Privy's policy engine (off-chain) enforces the scope; the player's gas is paid by their own wallet; nothing is sponsored.

---

## Wallet provisioning

Signing in gives a player an embedded wallet automatically — but not via Privy's own login-time `createOnLogin` (the SDK's `createPepuPrivyConfig`, used by `PepuPrivyWagmiProvider`, sets it to `"off"` on purpose). That setting is largely symbolic anyway: Privy resolves it from your Dashboard's config, not from anything passed to `<PrivyProvider>`, and a Dashboard with automatic creation off makes Privy's own "Creating your wallet…" login-time UI hang forever instead of erroring — a real, live-reproduced failure documented in the `consumer-app` template's `AGENTS.md` / `README.md` ("Custody model").

Instead, `<WalletGate>` in `components/signed-in-view.tsx` uses the SDK's `useEnsureWallet`, which calls this app's own `POST /api/wallet/ensure` route (`createEnsureWalletRoute()`) right after login. That route verifies the caller's Privy access token server-side, then creates a wallet **owned by that player** (`owner: { user_id }`) only if they don't already have one — Privy's own documented "pregenerate wallets" pattern (docs.privy.io/recipes/pregenerate-wallets). This is load-bearing for the whole template: the session grant needs an embedded wallet address, so without one a player could never reach the "grant a session signer" flow at all.

This route grants **zero signing authority by itself** — it only ensures a wallet exists to later (and only with the player's explicit consent via the screen above) grant a scoped, time-bound session signer to.

Concurrent and multi-tab first logins are not handled specially.

## Active wallet

A player can have two different kinds of wallet in play at once: the Privy **embedded wallet** this app provisions, and any **external wallet** (a browser extension) Privy's SDK happens to be tracking for the same browser session. `components/wallet-card.tsx` shows both, clearly labelled, with real balances — `useEmbeddedWallet` (SDK) tells them apart.

**By default, the embedded wallet is the active wagmi account**, kept that way by `useActiveWalletPin` (`/privy/wagmi`), which `PepuPrivyWagmiProvider` mounts once in `app/providers.tsx`. It re-asserts the embedded wallet any time wagmi's active account drifts (e.g. an extension auto-connecting).

This matters more here than in the other PEPU starters: **Privy will only attach a session signer to an embedded wallet**, so every session hook here is given the embedded wallet's address (from `useEmbeddedWallet`), not wagmi's `useAccount()`. This live bug was reproduced without the pin: a Google-signed-in player's embedded wallet sat unused while an installed extension was the active account instead.

To opt out of the pin (not recommended for this template) pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider`. A player with no embedded wallet at all keeps their external wallet active — but that player can't grant a session signer either, for the same Privy-side reason.

## Gas

Players pay their own gas, in PEPU. **This template does not sponsor gas.** The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`) are available, but sponsorship needs a project token (claim a project, deposit, use its token) that this template does not use. See the `sponsored-demo` and `sponsored-session-app` templates for sponsored flows. Nothing in this template is free or sponsored, and the UI says so.

A tap costs a fraction of a cent. That is cheap, not free, and the difference matters when you are telling players what to expect.

---

## Privy Dashboard checklist

Login failures on a fresh Privy app almost always come from one of these
settings. The full walkthrough, with troubleshooting, is the "Privy setup"
page of the PEPU docs (docs.pepeunchained.com).

- **Allowed origins** must include the exact origin
  you run on, port included: `http://localhost:3000`. `http://localhost`
  with no port is a different origin and does not match. Next.js silently
  moves to 3001 when 3000 is taken, and login then fails.
- **Automatically create embedded wallets on login** should be on. This template also creates the
  wallet server-side after login as a fallback, so a missing wallet does not
  leave the app hanging.
- **Wallet execution mode:** the live tests ran with TEE execution
  (`user-controlled-server-wallets-only`). See "Custody model" below for what
  that means for this app.
- **Smart Wallets:** not needed here. This template uses a session signer on a plain
  embedded wallet, not a smart account.
- **Coinbase smart wallet does not support chain 97741.** If you add external
  wallet login, set `eoaOnly` for the Coinbase connector.
- **Console noise:** "Unable to fetch token price" in the browser console is
  harmless. Privy's own transaction confirmation modal also runs a
  conservative pre-flight gas check that can refuse a transfer the wallet can
  afford, because PEPU's base fee is around 12,500 gwei.

## Setup

1. **Privy app** — create one at [dashboard.privy.io](https://dashboard.privy.io), copy the App ID and App Secret.
2. **Authorization key** — `npm run generate-authorization-key` (the SDK doctor's `generatePrivyAuthorizationKey`), register the public half in the Dashboard, then set `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` and `PRIVY_AUTHORIZATION_KEY`.
3. **Deploy the contract** — Foundry or Hardhat, see [`contracts/`](contracts/). Set `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS`.
4. **Get PEPU** — the wallet needs a little gas. This kit runs on mainnet (97741) only.

Every variable is documented in [`.env.example`](.env.example).

> **Login only works on the exact origin your Privy Dashboard allows —
> port included.** Privy's Dashboard has an "Allowed origins" list, and
> it matches on the full origin: scheme, host, *and port*. This project
> expects `http://localhost:3000`. If port 3000 is already taken,
> Next.js will silently start on 3001 (or higher) instead of erroring —
> and login there will fail with a confusing error (the login iframe
> gets blocked by CSP `frame-ancestors`, and OAuth init returns a 403),
> not an obvious "port in use" message. Before running this app, make
> sure port 3000 is actually free rather than adding `-p 3001` to work
> around a conflict — a Privy app id is only ever allow-listed for one
> set of origins (this matters if you're also running another PEPU
> template locally — every one of them defaults to 3000). Also note
> that `http://localhost` (no port) is **not** the same origin as
> `http://localhost:3000` — a URL with no explicit port defaults to the
> scheme's standard port (80 for `http`), so the two will never match.
> If you deliberately want a different port, add that exact origin to
> your Privy Dashboard's allowed origins yourself.

---

## Layout

```
app/
  api/config/          what is configured (booleans only, never values)
  api/wallet/ensure/   createEnsureWalletRoute(): creates the player's embedded wallet server-side
  api/session/*        createSessionRoutes(): grant (scoped policy), status, revoke cleanup
  api/game/tap/        createSessionActionRoute(): one gameplay tx via the session signer
components/
  session-consent-screen.tsx   the most important UI here (useSessionGrant) — read it
  session-status-card.tsx      countdown + revoke (useSessionRevoke)
  game-board.tsx               the game (useSessionAct), plus the no-signature counter
lib/
  scope.ts             the ONE session scope (contract + tap()), the game ABI
  env.ts               client-safe NEXT_PUBLIC_* values
contracts/             TapScore, for Foundry and Hardhat
```

---

## Security notes

- `PRIVY_AUTHORIZATION_KEY` is a production signing key. Anyone with it can request transactions for any wallet that granted a signer to its quorum — bounded by the policy, but still. Never commit it; rotate it if exposed.
- `PRIVY_APP_SECRET` and `PRIVY_AUTHORIZATION_KEY` are read only by the SDK's server entry points (`/privy/server`, `/session/server`), which refuse to load in a browser bundle. Nothing in `lib/` or `components/` reads them.
- Keep sessions short. The 15-minute default is deliberate.
- Widening the policy widens what a compromised key can do. If you add functions, add conditions.
- Keeping `tap()` non-payable is load-bearing: it is what makes the zero-value condition meaningful.

---

## Notes

Server-side `eth_sendTransaction` does not support chain 97741 (it is not one of Privy's "Tier 3" chains), so the tap route signs with Privy (`eth_signTransaction`) and broadcasts itself. That pattern lives in the SDK (`createSessionActionRoute`, `privySessionSigner`). The "Session keys" and "Sign with Privy, broadcast yourself" pages of the PEPU docs (docs.pepeunchained.com) describe it.

- Privy renders its own consent UI when a signer is granted. Test it in a sandbox before you write compliance language.
- Wallet provisioning is not tuned for concurrent or multi-tab use.
- `signAndBroadcast` applies a 20% gas buffer. Watch gas headroom over many taps.

## Design

Dark theme, PEPU green for actions, one lime accent, Grandstander for
headings: derived from pepeunchained.com's own stylesheet, not invented. All
tokens and component classes (`btn`, `card`, `notice`, `input`, `chip`,
`spinner`, `skeleton`...) live in one file, `app/pepu-design.css`, which is
identical in every PEPU template. Palette, type scale, spacing, motion rules
and where each value came from are documented in `BRAND.md` at
`templates/BRAND.md` in the pepu-devkit repo. Motion respects
`prefers-reduced-motion`. To use the official Pepe Unchained logo, drop it at
`public/pepu-logo.svg` and follow the note in `components/pepu-mark.tsx`.
