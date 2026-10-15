# AGENTS.md — PEPU Consumer App

Instructions for a coding agent building, running, or extending this
template. This is the flagship demo of the PEPU devkit — a founder or a
new developer will click through it directly — so keep it honest and
keep it running.

## What this app is

A Next.js (App Router, TypeScript strict) app that demonstrates the
onboarding story for Pepe Unchained V2: email login via
[Privy](https://privy.io) creates an embedded wallet with no seed phrase,
and the user immediately does something real onchain (a native PEPU
send). It is a demo of the account/onboarding stack, not a general-purpose
dApp scaffold — resist the urge to add unrelated features.

## SDK functions this template uses

Do not re-implement these locally; they come from `@pepu-chain/sdk`.

- `PepuPrivyWagmiProvider` (`/privy/wagmi`): `app/providers.tsx`. Privy config, react-query, wagmi and the active-wallet pin in one provider.
- `useEnsureWallet` (`/privy/react`): `<WalletGate>` in `components/signed-in-view.tsx`. The styled shell is local, the logic is the SDK's.
- `createEnsureWalletRoute` (`/privy/server`): `app/api/wallet/ensure/route.ts`.
- `useEmbeddedWallet` (`/privy/react`): `components/wallet-card.tsx`.
- `pepuMainnet`, `explorerLinks`, `formatPepu` (core): chain facts, explorer links and PEPU amounts.
- `checkPepuEnv` (`/doctor`): `scripts/doctor.mjs` (`npm run doctor`).

## Custody model — do not blur this

This app's wallet is a Privy **self-custodial embedded wallet** the user
signs from their own browser session. Full detail and sourcing are in
`README.md`'s "Custody model" section — read that before touching `app/providers.tsx` or `<WalletGate>` in `components/signed-in-view.tsx`. The short version:

- Privy runs two wallet architectures: `legacy-embedded-wallets-only`
  (on-device key shares) and `user-controlled-server-wallets-only`
  (Privy calls this "TEE execution" — wallets reassembled in a secure
  enclave, gated by the user's session). Both are self-custodial; the
  difference is *how*, not *who controls it*. This is a real Privy-named
  mode (`AppConfig['embeddedWallets']['mode']` in
  `node_modules/@privy-io/react-auth/dist/dts/types-DbuRjK23.d.ts`), not
  a term this template invented.
- A Privy app in `user-controlled-server-wallets-only` mode can have
  automatic on-login wallet creation (`createOnLogin`) switched off
  app-wide in the dashboard. This is not just "possible" — the resolved
  runtime `AppConfig.embeddedWallets.ethereum.createOnLogin` type is
  sourced *exclusively* from `AppResponse['embedded_wallet_config']`
  (the dashboard value); `PrivyClientConfig['embeddedWallets']` (the
  prop you pass to `<PrivyProvider config={...}>`) has no wiring into it
  at all — confirmed directly in
  `node_modules/@privy-io/react-auth/dist/dts/types-DbuRjK23.d.ts`
  (compare the `embeddedWallets.ethereum.createOnLogin` line, sourced
  only from `AppResponse`, against sibling fields like `priceDisplay`/
  `showWalletUIs` a few lines below it, which explicitly do pull from
  `PrivyClientConfig`). So the SDK's `createPepuPrivyConfig` setting `createOnLogin: "off"` is inert by design where the dashboard already says the same
  thing — it's there for clarity/future-proofing, not because it's
  doing the work.
- This was confirmed against a live app: with automatic creation off,
  Google login created a Privy user but no wallet ever appeared. A
  *separate* attempt to work around that by calling `useCreateWallet()`
  explicitly client-side (a manual invocation, independent of
  `createOnLogin`) still exercised Privy's own wallet-creation UI/enclave
  machinery for this app and hit the same indefinite "Creating your
  wallet…" hang — see the "Privy setup" page of the PEPU docs (guide.pepeunchained.com) for the
  full diagnosis (a likely mismatch between this app's TEE execution mode
  and a stale `user_owned_recovery_options` dashboard value).
- The fix that's actually in this codebase today is
  `<WalletGate>` in `components/signed-in-view.tsx` (the SDK's `WalletGate`, styled by render props) calling this app's own
  `POST /api/wallet/ensure` route — which creates the wallet **server-side**
  via `privy.wallets().create({ chain_type: "ethereum", owner: { user_id } })`,
  bypassing Privy's client-side creation UI/enclave path entirely. This is
  Privy's documented "pregenerate wallets" pattern
  (docs.privy.io/recipes/pregenerate-wallets), not a different custody
  model — see the SDK's `createEnsureWalletRoute` (`@pepu-chain/sdk/privy/server`)'s doc comment for the idempotency and custody guarantees (mounted in `app/api/wallet/ensure/route.ts`). **Do not delete or bypass
  `WalletGate`, and do not "fix" it by switching back to a client-side
  `useCreateWallet()` call** — that was tried first and hit the exact
  hang above; it is not a regression-safe alternative for this app's
  current dashboard config.
- This app's backend has **no signing authority** over the user's
  wallet — it never adds itself as a session signer and holds no
  `PRIVY_APP_SECRET`. A live test confirmed a backend attempting to sign
  for a user-owned wallet it doesn't control gets `401` from Privy's
  API. If you're tempted to add backend-signed transactions here,
  that's a different, explicit trust model (see the `game-app` template's
  session-signer pattern) — don't fold it into this template silently.

## Build, run, typecheck

From this directory:

```bash
pnpm install     # or npm/yarn — see package.json
pnpm dev         # http://localhost:3000
pnpm build       # next build — must succeed before calling anything done
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # eslint .
```

`pnpm build` must complete cleanly. If it doesn't, that's a real bug —
don't work around it by loosening `tsconfig.json`'s `strict` setting.

You cannot exercise the actual login flow without a real Privy App ID
(see `.env.example`). Without one, the app shows
`components/missing-config-notice.tsx` instead of crashing — verify that
screen renders instead of trying to fake a login.

## Hard rules for this template specifically

1. **Never claim gas is free or sponsored.** ERC-4337 EntryPoint v0.6/v0.7,
   the ZeroDev Kernel v3 factory, and a funded paymaster contract ARE
   deployed on Pepe Unchained V2 mainnet (see `@pepu-chain/sdk`'s README
   and `getPepuKernelStack`) — but that only means a Kernel smart account
   can be built and deployed today, funding its own gas exactly like an
   EOA. The hosted bundler (`https://bundler.pepeunchained.com`) and
   paymaster service (`https://paymaster.pepeunchained.com`) are live and
   sponsorship is proven end to end on mainnet (see the `sponsored-demo`
   and `sponsored-session-app` templates), but it needs a project token
   and this app is not wired to it, so no gas is sponsored here.
   `components/gas-notice.tsx` exists specifically to state this plainly.
   Do not remove it, water it down, or add a "gasless" badge anywhere in
   the UI. If this app is wired up to a funded project, update the
   notice — don't just delete it.
2. **Never invent a contract address, RPC URL, or chain fact.** Import
   `pepuMainnet` / `pepuTestnet` / `explorerUrl` / etc. from `@pepu-chain/sdk`
   — don't redefine a chain object or hardcode an RPC URL here. If you
   need a fact the SDK doesn't expose, that's a signal to raise it with
   the `@pepu-chain/sdk` maintainers (the pepu-devkit repository), not to
   hardcode it in this template.
3. **Testnet has no registered explorer.** `@pepu-chain/sdk`'s `explorerUrl()`
   throws for chain `97740` on purpose (no confirmed indexed Blockscout
   instance for it). Build explorer links with the SDK's `explorerLinks()` (mainnet pepuscan URLs); never hand-write a URL or guess a path.
4. **Mainnet only.** This kit targets chain 97741 only — see the
   "Mainnet only" section of `README.md`. Don't add a testnet switch; the chain is the SDK's `pepuMainnet`.
5. **`NEXT_PUBLIC_PRIVY_APP_ID` must fail loud-but-friendly, never with a
   raw stack trace.** That behavior lives in `PepuPrivyWagmiProvider`'s `fallback` in `app/providers.tsx` + `components/missing-config-notice.tsx`. If you change how the app
   reads that env var, keep this behavior working.
6. **Don't bypass the SDK's `PepuPrivyWagmiProvider` / `pepuWagmiConfig`.**
   They use `@privy-io/wagmi`'s `createConfig`/`WagmiProvider`, not plain
   `wagmi`'s — that's what makes the embedded wallet show up as a wagmi connector. This is
   a documented Privy footgun; get it wrong and `useAccount()` /
   `useSendTransaction()` silently stop seeing the embedded wallet.
7. **Privy's SDK surface can change between versions.** The versions
   pinned in `package.json` were verified against docs.privy.io at the
   time this template was written. If an upgrade changes a prop name or
   hook shape, follow Privy's current docs over anything written here —
   this file describes intent, not a frozen API contract.
8. **Never rely on `createOnLogin` alone for wallet creation, and never
   remove `<WalletGate>` in `components/signed-in-view.tsx`.** See "Custody model" above —
   some Privy dashboard configurations disable automatic on-login
   wallet creation app-wide, and a screen that only waits on it hangs
   forever. Wrap any new wallet-dependent UI in `<WalletGate>`, the same
   way `signed-in-view.tsx` wraps `WalletCard`/`GasNotice`/`SendPepuForm`.
9. **Never add backend signing authority over the user's wallet in this
   template.** No route here should hold `PRIVY_APP_SECRET` or call
   `useSigners().addSigners()` / `useCreateWallet({ signers: [...] })`.
   That's a legitimate, differently-scoped pattern — see
   the `game-app` template — but it changes the trust model this template
   is demonstrating (fully user-signed) and needs its own explicit
   consent UI if it's ever wanted here.
10. **The embedded wallet is the active wagmi account by default — keep
    it that way.** the SDK's `useActiveWalletPin` (mounted once by `PepuPrivyWagmiProvider` in `app/providers.tsx`, inside its `<WagmiProvider>`) uses
    `@privy-io/wagmi`'s `useSetActiveWallet` to re-assert the embedded
    wallet as wagmi's active connection any time it drifts away — e.g. an
    installed browser extension auto-connecting and silently becoming the
    account `useAccount()`/`useBalance()`/`useSendTransaction()` actually
    operate on. This fixes a live-reproduced bug: a Google-signed-in
    user's embedded wallet sat unused while wagmi's active account was a
    Phantom extension, so a "Send PEPU" would have gone out from Phantom.
    Don't swap `PepuPrivyWagmiProvider` for a provider that drops the pin. Don't "fix"
    `wallet-card.tsx`'s "Used for actions" badge by hardcoding it onto the
    embedded wallet, either — it already reflects reality once this hook
    is running, and hardcoding it would start lying the moment a
    developer opts out (see next line). **To opt out** — e.g. an app that
    deliberately wants an external wallet to be the active account —
    pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider` in `providers.tsx`. See `README.md`'s "Active wallet" section for why
    the default exists.

## Extending this template

- Adding a new onchain action: put the wagmi/viem logic in its own
  component under `components/`, following the pattern in
  `send-pepu-form.tsx` (local form state → validate → wagmi mutation
  hook → pending/confirmed UI → `explorerLinks` for the result link).
  Remember the gas notice applies to it too.
- Adding a new contract: add the Solidity source to **both**
  `contracts/foundry/src/` and `contracts/hardhat/contracts/` (same
  filename, same content) so neither toolchain's users are left out.
- Reading the contract registry (`getContract`, `isDeployed` from
  `@pepu-chain/sdk`): a `"pending"` entry has no `.address` field and
  TypeScript will refuse to let you read one. Don't work around that with
  a cast — it means the contract genuinely isn't deployed on this chain.

## Scope boundary

This template is self-contained. `@pepu-chain/sdk` is a dependency (vendored
under `vendor/pepu-sdk` until it is published to npm), so do not edit that
copy. If a change here seems to require changing the SDK itself, stop and
flag it instead.

<!-- BEGIN:pepu-agent-kit -->

## PEPU dev kit: agent wiring

This project is built on the PEPU dev kit (`@pepu-chain/sdk`, `@pepu-chain/mcp`, the PEPU skills). Template: **Consumer app** (`consumer-app`). Features: `login`. Use the kit; do not hand-roll what it already provides.

### Chain facts (Pepe Unchained V2)

- Chain id **97741**, mainnet only. There is no supported testnet in this kit; do not add a network switch.
- RPC: `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`
- Explorer: `https://pepuscan.com` (Blockscout)
- Native token: PEPU (18 decimals).
- Multicall3 is at the **PEPU-specific** address `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, NOT the canonical `0xcA11bde05977b3631167028862bE2a173976CA11` (nothing is deployed there). Never hardcode either: use the SDK (`getPepuAddresses`, `pepuMulticall`).
- Get chain, RPC, explorer and addresses from the SDK (`pepuMainnet`, `explorerLinks`, `getPepuAddresses`). Never redefine a chain, RPC, address or policy in app code.

### Use the SDK

Import from `@pepu-chain/sdk` subpaths. Before writing infrastructure code, check that the SDK does not already export it (MCP `pepu_sdk_exports`).

For this template:

- `@pepu-chain/sdk` (core): chain, addresses, explorer links, multicall, errors.
- Login and wallet: `/privy` (config), `/privy/react` (provider, `WalletGate`, `useEmbeddedWallet`, `useEnsureWallet`), `/privy/server` (`createEnsureWalletRoute`, `requireUser`), `/privy/wagmi` (wagmi on top of Privy).
- Readiness check: `/doctor` (`runDoctor`, with `privyDashboardChecker`), used by `scripts/doctor.mjs`.

All subpaths:

| Subpath | Use it for |
|---|---|
| `@pepu-chain/sdk` | chain, addresses, explorer links, multicall, permit2, errors (`explainError`), ERC-7677 builders, `checkSponsorship` |
| `/privy`, `/privy/react`, `/privy/server`, `/privy/wagmi` | Privy config, provider, wallet gate and pinning, server auth, ensure-wallet route, wagmi config |
| `/session`, `/session/server`, `/session/react` | Privy session signers (scoped policy, grant, revoke, act) |
| `/session/kernel` | on-chain Kernel session keys |
| `/aa`, `/aa/kernel`, `/aa/react` | bundler and paymaster clients, Kernel smart account, sponsored sends |
| `/paymaster`, `/paymaster/server` | paymaster REST API, project balance and deposits, claim attestation |
| `/combo`, `/combo/react` | Google login plus one session plus sponsored gas |
| `/doctor` | `checkPepuEnv`, `runDoctor`, `TEMPLATE_REQUIREMENTS` |

### Use the MCP tools

The `pepu` MCP server (`npx -y @pepu-chain/mcp`) is the source of truth for PEPU facts. Prefer it to guessing or searching the web.

How it reaches your editor: Claude Code gets it (and the skills) from the `pepu-devkit` plugin that `.claude/settings.json` enables, so there is deliberately no `.mcp.json` (it would load the server twice). Cursor and VS Code read `.cursor/mcp.json` and `.vscode/mcp.json`. If you do not use the plugin, add the server to Claude Code with `claude mcp add pepu -- npx -y @pepu-chain/mcp`.

Tools (32), grouped by purpose:

- Chain facts and reads: `pepu_chain_info` (call this FIRST), `pepu_known_gotchas`, `pepu_health_check`, `pepu_gas_price`, `pepu_estimate_gas_cost`, `pepu_read_contract`, `pepu_check_contract_deployed`, `pepu_get_token_info`, `pepu_get_address_overview`, `pepu_get_transaction`, `pepu_search`, `pepu_smart_account_info`, `pepu_encode_calls`.
- Errors and debugging: `pepu_explain_error`, `pepu_decode_error`, `pepu_explain_tx`.
- Contracts: `pepu_verify_contract_guide`, `pepu_verify_contract_status`.
- Sponsorship (bundler, paymaster, projects): `pepu_bundler_health`, `pepu_paymaster_health`, `pepu_sponsorship_status`, `pepu_project_balance`, `pepu_prepare_project_tx` (unsigned only, never signs).
- Scaffolding and setup: `pepu_list_templates`, `pepu_scaffold_app`, `pepu_check_env`, `pepu_check_privy_config`, `pepu_generate_authorization_key` (returns the public key only; the private half goes to `.env.local`).
- Sessions: `pepu_session_policy`.
- Docs and snippets: `pepu_get_docs`, `pepu_sdk_snippet`, `pepu_sdk_exports`.

Prompts (6): `new-pepu-app`, `add-google-login`, `add-session`, `add-sponsorship`, `add-sponsored-session`, `debug-tx`. The server also exposes resources (`pepu://chain-facts`, `pepu://addresses`, `pepu://docs/{slug}`, `pepu://skills/{name}`, `pepu://sdk/exports`).

Before changing env or Privy config, call `pepu_check_env` / `pepu_check_privy_config`, or run `npm run doctor`.

### Skills and the Claude Code plugin

The PEPU skills (chain setup, deploy and verify, tokens and NFTs, Privy onboarding, session keys, smart accounts, debugging, app scaffolding) ship in the `pepu-devkit` plugin. This repo's `.claude/settings.json` offers it on first open. To install manually in Claude Code:

```
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

### Environment

Required: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`
Optional: none
Privy dashboard settings this template needs:

- enable the login methods you use (email, Google, ...)
- add your app origin including the port (e.g. `http://localhost:3000`)
- enable embedded wallets and create-on-login


Run `npm run doctor` to check `.env.local` against this template's requirements. It reports presence and shape only. Fix every `FAIL` before running the app.

### Never print secrets

Never print, log, echo, commit or paste secret values (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key, bundler or paymaster URLs that embed an app key, API keys). Do not read `.env*` files into the conversation; use `npm run doctor`, which never prints values. Only `NEXT_PUBLIC_*` values are safe to show. If a secret is ever exposed, say so and tell the user to rotate it.

<!-- END:pepu-agent-kit -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
