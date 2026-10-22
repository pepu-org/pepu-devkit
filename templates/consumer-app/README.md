# PEPU Consumer App

A starter that proves onchain onboarding can feel like a normal app:
**sign in with an email address, get a wallet, do something onchain — no
seed phrase, no browser extension, no prior crypto knowledge.**

Built on [Pepe Unchained V2](https://pepuscan.com) with
[Privy](https://privy.io) (email/social login + embedded wallets),
[wagmi](https://wagmi.sh) + [viem](https://viem.sh), and `@pepu-chain/sdk`
for chain facts.

## What this app actually does

- **Signed out:** a plain landing page with one button — sign in with
  email, Google, or an existing wallet.
- **Signed in:** provisions the user's wallet if they don't have one yet
  (see "Custody model" below for exactly how), then shows its address
  (with a copy button and a link to it on
  [pepuscan.com](https://pepuscan.com)), its live PEPU balance, and a
  form to send native PEPU to an address you type, with a pending state
  and a link to the resulting transaction.
- **Gas notice:** there's a permanent notice that this app
  does not sponsor gas — the hosted bundler and paymaster are live, but
  sponsorship needs a project token this template does not use, so nothing
  sponsors this app's transactions. Every send costs the user real PEPU
  (typically a fraction of a cent). There is no "gasless" badge
  anywhere in this app, on purpose — see `AGENTS.md`.

## Custody model — read this before you assume "classic embedded wallet"

This app's wallet is a Privy **self-custodial embedded wallet**, same as
always — but Privy runs two different architectures for that, and which
one your Privy app uses changes what actually happens on login. This
distinction matters to anyone evaluating the chain, so it's spelled out
here rather than blurred:

- **`legacy-embedded-wallets-only`** — the older architecture. Wallets
  are reassembled **on the user's device**. Automatic "create a wallet
  on login" (`createOnLogin` in the SDK's `createPepuPrivyConfig`) reliably fires
  here.
- **`user-controlled-server-wallets-only`** — what Privy's own docs call
  **"TEE execution"** (docs.privy.io/recipes/tee-wallet-migration-guide).
  Wallets are reassembled inside a trusted execution environment
  (secure enclave) that only Privy's infrastructure can invoke, gated
  by the user's own authenticated session. **Neither Privy nor this
  app's server ever sees the private key or a usable share of it** —
  same self-custody guarantee as the legacy architecture, different
  mechanism. This is a real, current Privy execution mode, not
  something this template invented — `@privy-io/react-auth`'s own
  `AppConfig` type literally names it:
  `embeddedWallets.mode: 'legacy-embedded-wallets-only' |
  'user-controlled-server-wallets-only'`
  (`node_modules/@privy-io/react-auth/dist/dts/types-DbuRjK23.d.ts`).

In this app's Privy config the dashboard reports
`embedded_wallet_config.create_on_login: "off"` at the root, `.ethereum`,
and `.solana` levels, and a real Google login created a user
(`did:privy:...`) but automatic client-side wallet creation never fired
— the app just hung on "Creating your wallet…" forever, because nothing
was actually driving creation.

**What this app does about it:** a first attempt called `useCreateWallet()`
from `@privy-io/react-auth` explicitly for any signed-in user with no
wallet yet, instead of only waiting on `createOnLogin` — a real,
Privy-documented alternative to automatic creation
(docs.privy.io/basics/react/quickstart, step 2; and
docs.privy.io/wallets/wallets/create/create-a-wallet, "React" tab). That
still hit the same indefinite hang in live testing, because it still
asks Privy's own wallet-creation UI/enclave machinery to run for this
app — the trigger (automatic vs. explicit) wasn't the problem.

What's actually in this app today: `<WalletGate>` in `components/signed-in-view.tsx` (the SDK's `WalletGate`, styled by render props) calls this app's own `POST /api/wallet/ensure` route right after login. That
route verifies the caller's Privy access token server-side, then creates
the wallet **server-side** via
`privy.wallets().create({ chain_type: "ethereum", owner: { user_id } })`
if the user doesn't already have one — bypassing Privy's client-side
creation UI/enclave path entirely. This is Privy's own documented
"pregenerate wallets" pattern (docs.privy.io/recipes/pregenerate-wallets),
not a workaround or a different custody model. The result is the same
kind of self-custodial embedded wallet either way: **the user signs
every transaction from their own browser session.** This app's backend
never holds a signing key for it, never added itself as a session
signer, and has no path to sign on the user's behalf — a live test
confirmed a backend attempt to sign for a user-owned wallet gets a flat
`401` from Privy's API (`"No valid authorization keys or user signing
keys available"`), exactly as it should for a wallet this app's server
does not control. That route is the SDK's `createEnsureWalletRoute` (`@pepu-chain/sdk/privy/server`, mounted in `app/api/wallet/ensure/route.ts`); its doc comment carries the idempotency and custody reasoning.

If you're looking for the *other* documented pattern — a backend that
**can** sign on a user's behalf via a delegated session signer with a
scoped, time-boxed policy — that's the `game-app` template in this same
devkit, not this template. Don't add that pattern here without a real
reason; it changes the trust model in a way that deserves its own
explicit UI, exactly like `game-app`'s consent screen does.

**Flow:** a Google login (against an app in
`user-controlled-server-wallets-only` mode) creates a Privy user,
`WalletGate` calls `/api/wallet/ensure`, and the route creates a
self-custodial embedded wallet for that user, which carries a
`chain_type: "ethereum"`, `connector_type: "embedded"` linked wallet in
Privy's `/v1/users` API. If you ever see
this route return `401` for a real logged-in user, check for a stale
`next dev` process still bound to the port first — Next.js only reads
`.env.local` once at process startup, and a leftover process from before
a config change will keep failing forever no matter how correct the
current code and `.env.local` are. **Still worth eyeballing yourself:**
that `WalletGate` shows "Setting up your wallet…" only briefly (not an
indefinite hang) and that a real "Send PEPU" transaction prompts your own
browser session to sign it, not a silent backend action.

## Active wallet

This app can have two different kinds of wallet in play at once: the
Privy **embedded wallet** it provisions for you, and any **external
wallet** (a browser extension like MetaMask or Phantom) Privy's SDK
happens to be tracking for the same browser session — `loginMethods`
includes `"wallet"`, so an installed extension can end up tracked here
even for a user who signed in with email/Google and never touched it.
`components/wallet-card.tsx` shows both, clearly labelled, with real
balances — see the SDK's `useEmbeddedWallet` for how it tells them apart.

**By default, the embedded wallet is the active account for every
action in this app** — `useAccount()`, `useBalance()`,
`useSendTransaction()`, and every other wagmi hook `send-pepu-form.tsx`
and `wallet-card.tsx` use. That's enforced by the SDK's `useActiveWalletPin` hook (`@pepu-chain/sdk/privy/wagmi`), which `PepuPrivyWagmiProvider` mounts once in `app/providers.tsx`.

This exists because of a real, live-reproduced bug: a user signed in
with Google, Privy created their embedded wallet, but because Phantom
happened to be installed, `@privy-io/wagmi`'s own auto-connect logic
made Phantom's address the active wagmi account instead — so "Send
PEPU" would have gone out from Phantom, not the embedded wallet the user
was just shown and told was theirs. For an app whose entire promise is
"sign in, the wallet is handled for you," that's backwards.
`useActiveWalletPin` re-asserts the embedded wallet as active any time
the two drift apart — not just once on page load, since an extension
can auto-connect (or reconnect, or switch accounts) well after that —
using `@privy-io/wagmi`'s own `useSetActiveWallet`.

**If you want the opposite** — an app that should let a connected
external wallet act as the active account instead of the embedded
one — pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider` in `app/providers.tsx`. That's a legitimate choice for an app that treats
the embedded wallet as a fallback rather than the primary account; it
just isn't this template's default, since this template's whole
onboarding story depends on it.

**Edge case:** a user with no embedded wallet at all keeps whatever
external wallet is active — `useActiveWalletPin` never forces a switch
to a wallet that doesn't exist. In this app specifically that gap should
only ever be momentary: `<WalletGate>` in `components/signed-in-view.tsx` (see "Custody
model" above) provisions an embedded wallet for every signed-in user,
including one who signed in by connecting an external wallet.

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
- **Smart Wallets:** leave off unless you are using the `sponsored-demo`
  template. If you enable it, the chain must be 97741 with provider Kernel
  and bundler and paymaster URLs (the hosted bundler `https://bundler.pepeunchained.com` and paymaster `https://paymaster.pepeunchained.com/v2/paymaster/<project token>`; sponsorship needs a project token, see the `sponsored-demo` template).
- **Coinbase smart wallet does not support chain 97741.** This template sets
  `eoaOnly` for the Coinbase connector so the unsupported path is not offered.
- **Console noise:** "Unable to fetch token price" in the browser console is
  harmless. Privy's own transaction confirmation modal also runs a
  conservative pre-flight gas check that can refuse a transfer the wallet can
  afford, because PEPU's base fee is around 12,500 gwei.

## Quickstart

### 1. Get the code

Scaffold it with `npx create-pepu-app@latest my-app --template consumer-app`, then continue with step 2.

### 2. Install dependencies

```bash
npm install
# or: pnpm install / yarn install
```

### 3. Get a Privy App ID (about a minute, free)

1. Go to [dashboard.privy.io](https://dashboard.privy.io) and sign up.
2. Create a new app (any name).
3. Copy the **App ID** from that app's Settings page.

### 4. Configure the environment

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

```
NEXT_PUBLIC_PRIVY_APP_ID=your-app-id-here
PRIVY_APP_SECRET=your-app-secret-here
```

`PRIVY_APP_SECRET` is the App Secret from the same Privy Settings page. It is
server-only (no `NEXT_PUBLIC_` prefix) and is used by `/api/wallet/ensure` to
create the embedded wallet after login. Without it, login succeeds but the
wallet is never created.

If you skip the App ID, the app runs and shows a clear setup screen explaining
exactly what to do — it will not crash with a stack trace.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with an
email address; the app provisions an embedded wallet for you the first
time you log in (see "Custody model" above for exactly how — it's not
always the automatic-on-login flow you might expect from other Privy
apps).

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
> set of origins. Also note that `http://localhost` (no port) is **not**
> the same origin as `http://localhost:3000` — a URL with no explicit
> port defaults to the scheme's standard port (80 for `http`), so the two
> will never match. If you deliberately want a different port, add that
> exact origin to your Privy Dashboard's allowed origins yourself.

### 6. Get a small amount of PEPU to actually send something

The app targets **mainnet (chain 97741)**, the only network this kit
supports — and it's cheap: a simple transfer costs a fraction
of a cent. Buy PEPU on an exchange, or bridge existing PEPU from Ethereum
L1 via [pepubridge.com](https://pepubridge.com), and send a small amount
to your new embedded wallet's address (shown on the signed-in screen).
Then use the "Send PEPU" form to send some back out, and watch it confirm
on pepuscan.

## A note on `.npmrc`

This project ships a `.npmrc` with `legacy-peer-deps=true`.
`@privy-io/wagmi@4`'s package.json pins its `viem` peer dependency to an
exact patch version (`2.56.0`) instead of a range, while this app (like
the rest of the PEPU devkit) uses a slightly newer viem patch
(`^2.56.8`) — the two are compatible in practice, but that exact-pin
peer range makes plain `npm install` fail with `ERESOLVE` by default.
`pnpm` and `yarn` aren't affected and already install this project fine
without it. Don't delete this file unless you've confirmed `npm install`
still works without it (i.e. Privy has relaxed that peer range).

## SDK functions this template uses

All PEPU and Privy plumbing comes from `@pepu-chain/sdk`; the template keeps only its UI and design.

| Concern | SDK function | Where |
|---|---|---|
| Privy + react-query + wagmi providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`), which uses `createPepuPrivyConfig`, `pepuWagmiConfig` and `useActiveWalletPin` | `app/providers.tsx` |
| Wallet provisioning (request, timeouts, `refreshUser`, retry) | `useEnsureWallet` (`/privy/react`) | `<WalletGate>` in `components/signed-in-view.tsx` |
| Server-side wallet creation | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure/route.ts` |
| Embedded vs. external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Chain facts, explorer links, PEPU amount formatting | `pepuMainnet`, `explorerLinks`, `formatPepu` (core) | wallet card, send form, network badge |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` (`npm run doctor`) |

## Project structure

```
app/
  layout.tsx        root layout, loads Providers
  providers.tsx      PepuPrivyWagmiProvider (SDK): Privy + wagmi + react-query + wallet pin
  page.tsx            signed-out vs signed-in switch
  globals.css        Tailwind v4 entry point
  pepu-design.css    Shared PEPU theme tokens + component classes
components/
  signed-out-view.tsx   landing + login
  signed-in-view.tsx    wallet card + gas notice + send form
  wallet-card.tsx       address, balance, explorer link
  send-pepu-form.tsx    native PEPU transfer with pending/confirmed states
  gas-notice.tsx        the "you pay gas" banner (this template sends ordinary transactions; `sponsored-demo` and `sponsored-session-app` use sponsorship)
  missing-config-notice.tsx  friendly screen when the Privy App ID is unset
lib/
  format.ts     small formatting helper (address truncation)
scripts/
  doctor.mjs    `npm run doctor`: checks .env.local with the SDK's checkPepuEnv
contracts/
  foundry/    Foundry project with the same trivial example contract
  hardhat/    Hardhat + TypeScript project with the same contract
```

## Mainnet only

This kit targets Pepe Unchained V2 mainnet (`97741`) only. Mainnet gas
costs a fraction of a cent, so "sign in, get a wallet, do something
onchain" is completable end to end on the real network.

## What's not here (on purpose)

- **No gas sponsorship in this template.** The hosted PEPU bundler
  (`https://bundler.pepeunchained.com`) and paymaster service
  (`https://paymaster.pepeunchained.com`) are available, but this template does not wire it up and sponsorship
  needs a project token (claim a project, deposit, use its token). Every
  transaction here is paid in real PEPU by the signed-in wallet. See the
  in-app notice and `AGENTS.md`. Don't add a fake "gasless" badge. For
  sponsored gas start from the `sponsored-demo` template (Privy Smart
  Wallets) or the `sponsored-session-app` template (Kernel session key).
- **No Multicall3 usage.** The canonical Multicall3 address is not
  deployed on Pepe Unchained and is structurally unreachable at that
  address (see `@pepu-chain/sdk`'s README, "Known gaps"). This app doesn't use
  multicall batching.

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

## More

- [`AGENTS.md`](./AGENTS.md) — how a coding agent should build, run, and
  extend this app.
- [`contracts/README.md`](./contracts/README.md) — the Foundry/Hardhat
  starter contracts.
- `@pepu-chain/sdk` — the chain definitions, contract registry, and token list
  this app is built on. `create-pepu-app` bundles a built copy at
  `vendor/pepu-sdk` (see `vendor/pepu-sdk/package.json`). Outside this
  project, install it with `npm i @pepu-chain/sdk`; the reference is at
  https://docs.pepeunchained.com/sdk/reference.
