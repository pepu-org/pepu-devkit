# PEPU Token-Gated App

A starter that gates content behind an onchain balance check:
**sign in with an email address or wallet, and this app unlocks content
once it sees your wallet holding a configured ERC-20 token and/or NFT
collection on Pepe Unchained V2.**

Built on [Pepe Unchained V2](https://pepuscan.com) with
[Privy](https://privy.io) (email/social login + embedded wallets),
[wagmi](https://wagmi.sh) + [viem](https://viem.sh), and `@pepu-chain/sdk`
for chain facts, including the chain's Multicall3 deployment,
which this app uses directly.

## What this app actually does

- **Signed out:** a plain landing page with one button — sign in with
  email, Google, or an existing wallet.
- **Signed in:** shows the embedded wallet's address and native PEPU
  balance, then runs one batched read (via the SDK's `pepuMulticall`, one RPC round trip through PEPU's Multicall3) checking the balance of
  whichever gate token(s) you configured. Holding a positive balance of
  either one unlocks the gated content panel.
- **Honest about gas:** the balance check itself is a free read (no
  transaction, no gas). But this template doesn't hide the fact that gas
  sponsorship is not used here (PEPU's hosted bundler and paymaster are
  live, but sponsorship needs a project token) — see `AGENTS.md`.

## Wallet provisioning

Signing in gives you an embedded wallet automatically — but not via
Privy's own login-time `createOnLogin` (see the SDK's `createPepuPrivyConfig`, which sets it to `"off"` on purpose). That setting is largely symbolic anyway:
Privy resolves it from your Dashboard's config, not from anything passed
to `<PrivyProvider>` here, and a Dashboard with automatic creation off
makes Privy's own "Creating your wallet…" login-time UI hang forever
instead of erroring — a real, live-reproduced failure documented in
the `consumer-app` template's `AGENTS.md` / `README.md` ("Custody model").

Instead, `<WalletGate>` in `components/signed-in-view.tsx` (the SDK's `WalletGate`, styled by render props) calls this app's own
`POST /api/wallet/ensure` route right after login. That route verifies
the caller's Privy access token server-side, then creates a wallet
**owned by that user** (`owner: { user_id }`) only if they don't already
have one — Privy's own documented "pregenerate wallets" pattern
(docs.privy.io/recipes/pregenerate-wallets). The result is a normal
self-custodial embedded wallet, with no signing authority granted to
this app's backend — see the SDK's `createEnsureWalletRoute` (`@pepu-chain/sdk/privy/server`, mounted in `app/api/wallet/ensure/route.ts`) and AGENTS.md, "Never add backend signing authority". This matters here
specifically: the gate check itself reads whichever wallet the signed-in
user ends up with, so a user stuck with no wallet at all could never be
gated in (or out) correctly.

This exact pattern is proven working end-to-end against a live Privy app
in the `consumer-app` template; this template copies that implementation
verbatim rather than reinventing it, but has not itself been
independently re-verified against a live Privy app yet — see the SDK's `createEnsureWalletRoute` (`@pepu-chain/sdk/privy/server`, mounted in `app/api/wallet/ensure/route.ts`).

## Active wallet

This app can have two different kinds of wallet in play at once: the
Privy **embedded wallet** it provisions for you, and any **external
wallet** (a browser extension like MetaMask or Phantom) Privy's SDK
happens to be tracking for the same browser session. `wallet-card.tsx`
shows both, honestly labelled, with real balances — see the SDK's `useEmbeddedWallet` for how it tells them apart.

**By default, the embedded wallet is the active account for every
action in this app** — including the balance check itself.
`token-gate-panel.tsx`'s `pepuMulticall` call reads whichever wallet
wagmi currently treats as active, so if that ever drifted to an
unrelated external wallet, this app would gate content on the wrong
wallet's balance. the SDK's `useActiveWalletPin` hook (`@pepu-chain/sdk/privy/wagmi`), which `PepuPrivyWagmiProvider` mounts once in `app/providers.tsx`, prevents that: it uses `@privy-io/wagmi`'s
`useSetActiveWallet` to re-assert the embedded wallet as active any time
wagmi's active account drifts — e.g. an installed browser extension
auto-connecting. This fixes a real, live-reproduced bug: a
Google-signed-in user's embedded wallet sat unused while an installed
extension was the active account instead.

To opt out — e.g. an app that deliberately wants an external wallet to
be the active account — pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider` in `app/providers.tsx`. A user with no embedded wallet at all keeps
whatever external wallet is active; this hook never forces a switch to
a wallet that doesn't exist.

## Privy Dashboard checklist

Login failures on a fresh Privy app almost always come from one of these
settings. The full walkthrough, with troubleshooting, is the "Privy setup"
page of the PEPU docs (guide.pepeunchained.com).

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

Scaffold it with `npx create-pepu-app@latest my-app --template token-gated-app`, then continue with step 2.

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

Open `.env.local` and set at minimum:

```
NEXT_PUBLIC_PRIVY_APP_ID=your-app-id-here
PRIVY_APP_SECRET=your-app-secret-here
```

`PRIVY_APP_SECRET` is the App Secret from the same Privy Settings page. It is
server-only (no `NEXT_PUBLIC_` prefix) and is used by `/api/wallet/ensure` to
create the embedded wallet after login. Without it, login succeeds but the
wallet is never created.

`.env.example` already fills in `NEXT_PUBLIC_GATE_ERC20_ADDRESS` with
WPEPU's address so the app runs and gates on something real out of the
box — that's a convenience default, **not** a recommendation to gate your
own app on WPEPU. Replace it with your own token's address, and/or set
`NEXT_PUBLIC_GATE_ERC721_ADDRESS` to an NFT collection (the sibling
`nft-mint` template — `npx create-pepu-app@latest --template nft-mint` — deploys
one you can point here).

If either Privy or a gate token address is missing, the app runs and
shows a clear setup screen explaining exactly what to do — it will not
crash with a stack trace.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, and the app
checks your wallet's balance of the configured token(s) automatically.

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

## How the gate check works

`components/token-gate-panel.tsx` calls the SDK's `pepuMulticall` with `balanceOf` (plus `decimals`/`symbol` or `name`/`symbol` for display) for each configured token. `pepuMulticall` is viem's `multicall` pinned to PEPU's own Multicall3 deployment, so checking both an ERC-20 and an ERC-721 balance is still one RPC round trip, not two.

The unlock rule is simple on purpose: **holding any positive balance of
at least one configured token unlocks the content.** There's no minimum
threshold, allowlist, or per-tier logic — add that yourself if your app
needs it; the batched-read pattern here is the part worth reusing as-is.

## Mainnet only

This kit targets Pepe Unchained V2 mainnet (`97741`) only. It matters
for this template specifically: the gate check relies on Multicall3,
which is deployed on mainnet.

## SDK functions this template uses

All PEPU and Privy plumbing comes from `@pepu-chain/sdk`; the template keeps only its UI, design and gate logic.

| Concern | SDK function | Where |
|---|---|---|
| Privy + react-query + wagmi providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`), which uses `createPepuPrivyConfig`, `pepuWagmiConfig` and `useActiveWalletPin` | `app/providers.tsx` |
| Wallet provisioning (request, timeouts, `refreshUser`, retry) | `useEnsureWallet` (`/privy/react`) | `<WalletGate>` in `components/signed-in-view.tsx` |
| Server-side wallet creation | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure/route.ts` |
| Embedded vs. external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Batched balance reads | `pepuMulticall` (core), pinned to PEPU's own Multicall3 | `components/token-gate-panel.tsx` |
| Chain facts, explorer links | `pepuMainnet`, `explorerLinks` (core) | wallet card, gate panel, network badge |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` (`npm run doctor`) |

ERC-20 and ERC-721 read ABIs come from viem (`erc20Abi`, `erc721Abi`); the SDK does not ship its own.

## Project structure

```
app/
  layout.tsx           root layout, loads Providers
  providers.tsx         PepuPrivyWagmiProvider (SDK): Privy + wagmi + react-query + wallet pin
  page.tsx               signed-out vs signed-in switch, behind <SetupGate>
  globals.css           Tailwind v4 entry point
  pepu-design.css       Shared PEPU theme tokens + component classes
  api/wallet/ensure/     creates the signed-in user's embedded wallet server-side (see "Wallet provisioning" above)
components/
  signed-out-view.tsx    landing + login
  signed-in-view.tsx     wallet card + gate panel
  wallet-card.tsx        address, native balance, explorer link
  token-gate-panel.tsx   the batched balance check + lock/unlock UI
  gated-content.tsx      placeholder for whatever you actually gate
  setup-gate.tsx         blocks rendering until a gate token is configured
  missing-config-notice.tsx  friendly screen when required config is unset
lib/
  env.ts          parses the gate token addresses from NEXT_PUBLIC_* once, in one place
  format.ts       small formatting helpers (address truncation, token amounts for any decimals)
scripts/
  doctor.mjs    `npm run doctor`: checks .env.local with the SDK's checkPepuEnv
```

## What's not here (on purpose)

- **No gas sponsorship in this template.** The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service
  (`https://paymaster.pepeunchained.com`) are live and sponsorship is proven on mainnet, but it needs a project token and this template does not use one. For sponsored gas start from the `sponsored-demo` or `sponsored-session-app` template. This
  template only does free reads (no transaction the user needs to pay
  for), but don't add a "gasless" badge if you extend it with a write
  path — see `AGENTS.md`.
- **No per-tier or minimum-balance logic.** Deliberately the simplest
  possible rule (`balance > 0`) — see "How the gate check works" above.
- **No server-side re-verification.** The balance check runs entirely in
  the browser. If you gate something server-enforced (an API route, a
  paid download), re-check the balance server-side too — a client-only
  check can be bypassed by anyone editing browser state.

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
- `@pepu-chain/sdk` — the chain definitions, contract registry, and token list
  this app is built on. `create-pepu-app` bundles a built copy at
  `vendor/pepu-sdk` (see `vendor/pepu-sdk/package.json`). Outside this
  project, install it with `npm i @pepu-chain/sdk`; the reference is at
  https://guide.pepeunchained.com/sdk/reference.
