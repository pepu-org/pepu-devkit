# PEPU NFT Mint

A starter for a real onchain NFT mint: **sign in with an email address,
get a wallet, mint an ERC-721 on Pepe Unchained V2, and see the token
show up as yours — no seed phrase required.**

Built on [Pepe Unchained V2](https://pepuscan.com) with
[Privy](https://privy.io) (email/social login + embedded wallets),
[wagmi](https://wagmi.sh) + [viem](https://viem.sh), `@pepu-chain/sdk` for
chain facts, and
[OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x/)
v5.7.0 for the contract itself.

## What this app actually does

- **Signed out:** a plain landing page with one button — sign in with
  email, Google, or an existing wallet.
- **Signed in:** shows the embedded wallet's address and native PEPU
  balance, the collection's live mint price / supply (one batched
  Multicall3 read), a "Mint" button that sends a real transaction, and
  the list of token ids that wallet owns (a second batched read, using
  the contract's `ERC721Enumerable` extension).
- **Honest about gas:** minting is a real transaction — even when the
  mint price itself is 0, the caller still pays gas. There is no
  "gasless" badge anywhere in this app, on purpose — see `AGENTS.md`.

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
self-custodial embedded wallet: **you sign every transaction, including
the mint, from your own browser session.** This app's backend never
holds a signing key for it and never adds itself as a session signer —
see the SDK's `createEnsureWalletRoute` (`@pepu-chain/sdk/privy/server`, mounted in `app/api/wallet/ensure/route.ts`) and AGENTS.md, "Never
add backend signing authority".

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
action in this app** — `useAccount()`, `useBalance()`, and the mint
transaction in `mint-panel.tsx` all operate on it. That's enforced by
 the SDK's `useActiveWalletPin` hook (`@pepu-chain/sdk/privy/wagmi`), which `PepuPrivyWagmiProvider` mounts once in `app/providers.tsx`,
`app/providers.tsx`, which uses `@privy-io/wagmi`'s
`useSetActiveWallet` to re-assert the embedded wallet as active any time
wagmi's active account drifts — e.g. an installed browser extension
auto-connecting. This fixes a real, live-reproduced bug: a
Google-signed-in user's embedded wallet sat unused while an installed
extension was the active account instead, which would have sent the
mint transaction from the wrong wallet.

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

Scaffold it with `npx create-pepu-app@latest my-app --template nft-mint`, then continue with step 2.

### 2. Deploy the contract (required — there is no pre-deployed collection)

Pick one toolchain:

- [`contracts/foundry/README.md`](./contracts/foundry/README.md)
- [`contracts/hardhat/README.md`](./contracts/hardhat/README.md)

Both deploy the same `PepuNft` contract (see
[`contracts/README.md`](./contracts/README.md)) to Pepe Unchained V2
mainnet. Note the deployed address — you'll need it in step 4.

### 3. Install dependencies

```bash
npm install
# or: pnpm install / yarn install
```

### 4. Get a Privy App ID (about a minute, free)

1. Go to [dashboard.privy.io](https://dashboard.privy.io) and sign up.
2. Create a new app (any name).
3. Copy the **App ID** from that app's Settings page.

### 5. Configure the environment

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

```
NEXT_PUBLIC_PRIVY_APP_ID=your-app-id-here
PRIVY_APP_SECRET=your-app-secret-here
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=the-address-from-step-2
```

`PRIVY_APP_SECRET` is the App Secret from the same Privy Settings page. It is
server-only (no `NEXT_PUBLIC_` prefix) and is used by `/api/wallet/ensure` to
create the embedded wallet after login. Without it, login succeeds but the
wallet is never created.

If either is missing, the app runs and shows a clear setup screen
explaining exactly what to do — it will not crash with a stack trace.

### 6. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, and mint —
Privy creates an embedded wallet automatically the first time you log in.

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

### 7. Get a small amount of PEPU to actually mint

The app targets **mainnet (chain 97741)**, the only network this kit
supports. Buy PEPU on an exchange, or bridge existing PEPU
from Ethereum L1 via [pepubridge.com](https://pepubridge.com), and send a
small amount to your new embedded wallet's address (shown on the
signed-in screen) before minting.

## How the reads are batched

`components/mint-panel.tsx` (name/symbol/mintPrice/totalSupply/MAX_SUPPLY) uses the SDK's `pepuMulticall`, viem's `multicall` pinned to PEPU's own Multicall3. `components/owned-tokens.tsx` (`tokenOfOwnerByIndex` across every token the wallet owns) uses wagmi's `useReadContracts`, which routes through the same Multicall3 because the SDK's `pepuMainnet` carries a `contracts.multicall3` entry. Each of those is one RPC round trip regardless of how many individual contract reads it covers.

## SDK functions this template uses

All PEPU and Privy plumbing comes from `@pepu-chain/sdk`; the template keeps only its UI, design and its own contract ABI (`lib/nft-abi.ts`).

| Concern | SDK function | Where |
|---|---|---|
| Privy + react-query + wagmi providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`), which uses `createPepuPrivyConfig`, `pepuWagmiConfig` and `useActiveWalletPin` | `app/providers.tsx` |
| Wallet provisioning (request, timeouts, `refreshUser`, retry) | `useEnsureWallet` (`/privy/react`) | `<WalletGate>` in `components/signed-in-view.tsx` |
| Server-side wallet creation | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure/route.ts` |
| Embedded vs. external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Batched collection reads | `pepuMulticall` (core), pinned to PEPU's own Multicall3 | `components/mint-panel.tsx` |
| Chain facts, explorer links, PEPU amount formatting | `pepuMainnet`, `explorerLinks`, `formatPepu` (core) | wallet card, mint panel, owned tokens, network badge |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` (`npm run doctor`) |

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
  signed-in-view.tsx     wallet card + gas notice + mint panel + owned tokens
  wallet-card.tsx        address, native balance, explorer link
  mint-panel.tsx         batched contract reads + the mint transaction
  owned-tokens.tsx       batched tokenOfOwnerByIndex read, token id list
  gas-notice.tsx         the "you pay gas, this app does not sponsor" banner
  setup-gate.tsx         blocks rendering until the NFT contract is configured
  missing-config-notice.tsx  friendly screen when required config is unset
lib/
  env.ts          parses NEXT_PUBLIC_NFT_CONTRACT_ADDRESS once, in one place
  nft-abi.ts      ABI for the functions this app actually calls
  format.ts       small formatting helper (address truncation)
scripts/
  doctor.mjs    `npm run doctor`: checks .env.local with the SDK's checkPepuEnv
contracts/
  foundry/    Foundry project with the PepuNft contract
  hardhat/    Hardhat + TypeScript project with the same contract
```

## Mainnet only

This kit targets Pepe Unchained V2 mainnet (`97741`) only, so "sign in,
get a wallet, mint something" is completable end to end on the real
network.

## What's not here (on purpose)

- **No gas sponsorship in this template.** The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service
  (`https://paymaster.pepeunchained.com`) are live and sponsorship is proven on mainnet, but it needs a project token and this template does not use one. For sponsored gas start from the `sponsored-demo` or `sponsored-session-app` template. Every
  mint is paid for by the signed-in wallet. See the in-app notice and
  `AGENTS.md`. Don't add a fake "gasless" badge.
- **No allowlist, reveal mechanism, or royalty standard.** The contract
  is a deliberately minimal starting point — see `contracts/README.md`.
- **No NFT metadata/image rendering.** This app shows owned token ids and
  links to the collection on pepuscan; it does not fetch or render
  `tokenURI()` metadata or images. Add that yourself once you have real
  metadata hosted (the contract's `_baseURI()` is already wired for it).

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
  contract, and what it does and doesn't include.
- `@pepu-chain/sdk` — the chain definitions and contract registry this app is
  built on. `create-pepu-app` bundles a built copy at
  `vendor/pepu-sdk` (see `vendor/pepu-sdk/package.json`). Outside this
  project, install it with `npm i @pepu-chain/sdk`; the reference is at
  https://guide.pepeunchained.com/sdk/reference.
