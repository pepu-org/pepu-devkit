# AGENTS.md — PEPU NFT Mint

Instructions for a coding agent building, running, or extending this
template. It demonstrates one thing well — a real ERC-721 mint on Pepe
Unchained V2, plus reading what a wallet owns — resist the urge to turn
it into a general-purpose dApp scaffold or NFT marketplace.

## What this app is

A Next.js (App Router, TypeScript strict) app that signs a user in via
[Privy](https://privy.io) (embedded wallet, no seed phrase), lets them
mint from a deployed `PepuNft` ERC-721 contract, and shows the token ids
they own. `contracts/` ships the same contract in both Foundry and
Hardhat, built on OpenZeppelin Contracts v5.7.0.

## SDK functions this template uses

Do not re-implement these locally; they come from `@pepu-chain/sdk`. `lib/nft-abi.ts` stays local because it is this template's own contract.

- `PepuPrivyWagmiProvider` (`/privy/wagmi`): `app/providers.tsx`.
- `useEnsureWallet` (`/privy/react`) and `createEnsureWalletRoute` (`/privy/server`): `<WalletGate>` in `components/signed-in-view.tsx` and `app/api/wallet/ensure/route.ts`.
- `useEmbeddedWallet` (`/privy/react`): `components/wallet-card.tsx`.
- `pepuMulticall` (core): the batched collection read in `components/mint-panel.tsx`.
- `pepuMainnet`, `explorerLinks`, `formatPepu` (core): chain facts, explorer links and PEPU amounts.
- `checkPepuEnv` (`/doctor`): `scripts/doctor.mjs` (`npm run doctor`).

## Build, run, typecheck

```bash
pnpm install     # or npm/yarn — see package.json
pnpm dev         # http://localhost:3000
pnpm build       # next build — must succeed before calling anything done
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # eslint .
```

`pnpm build` must complete cleanly. If it doesn't, that's a real bug —
don't work around it by loosening `tsconfig.json`'s `strict` setting.

You cannot exercise the actual login flow or a real mint without a real
Privy App ID, a deployed contract address, and a funded wallet. Without a
Privy App ID, `app/providers.tsx` renders
`components/missing-config-notice.tsx`. Without
`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`, `components/setup-gate.tsx` renders
the same notice with a different message. Verify both screens render
instead of trying to fake a login or a mint.

## Hard rules for this template specifically

1. **Never claim gas is free or sponsored.** ERC-4337 EntryPoint v0.6/v0.7,
   the Kernel factory and the v2 paymaster canary (external audit pending) ARE
   deployed on Pepe Unchained V2 mainnet, and PEPU hosts the bundler
   (`https://bundler.pepeunchained.com`) and paymaster service
   (`https://paymaster.pepeunchained.com`). Sponsorship needs a project token and
   is not wired into this template, so gas sponsorship does not apply
   for this app. Minting is a real transaction; even a free
   (`mintPrice == 0`) mint still costs the caller gas.
   `components/gas-notice.tsx` exists specifically to state this. Do not
   remove it, water it down, or add a "gasless" badge anywhere in the
   UI.
2. **Never invent a contract address, RPC URL, or chain fact.** Import
   `pepuMainnet` / `pepuTestnet` / `explorerUrl` / etc. from `@pepu-chain/sdk`
   — don't redefine a chain object or hardcode an RPC URL here.
   `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` is deliberately blank in
   `.env.example` — there is no pre-deployed collection on this chain,
   and this template will not invent one. It must be deployed (see
   `contracts/README.md`) before this app can run past the setup screen.
3. **Testnet has no registered explorer.** `@pepu-chain/sdk`'s `explorerUrl()`
   throws for chain `97740` on purpose. Build explorer links with the SDK's `explorerLinks()` (mainnet pepuscan URLs); never hand-write a URL or guess a path.
4. **Only link explorer resource types `@pepu-chain/sdk` actually supports.**
   `explorerUrl()`'s `ExplorerResourceType` is `"tx" | "address" |
   "token"` — there is no confirmed per-NFT-instance URL scheme wired
   into the SDK. `components/owned-tokens.tsx` deliberately links to the
   collection's `"token"` page, not a fabricated
   `/token/<address>/instance/<id>` URL, even though Blockscout supports
   that pattern in general — don't add that link without first getting
   it into `@pepu-chain/sdk`'s `ExplorerResourceType` (out of scope for this
   template — see "Scope boundary" below).
5. **Mainnet only.** This kit targets chain 97741 only. Don't add a testnet switch; the chain is the SDK's `pepuMainnet`.
6. **The NFT contract address comes from env, validated once.**
   `lib/env.ts`'s `readAddress()` parses
   `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` and drops anything that isn't a
   valid address (`viem`'s `isAddress`) rather than letting a typo reach
   wagmi. `components/mint-panel.tsx` and `components/owned-tokens.tsx`
   both use a non-null assertion (`nftContractAddress!`) on the
   resulting value — that's safe only because `<SetupGate>` (see
   `components/setup-gate.tsx`) guarantees it's defined before either
   component renders. Don't remove that gate without removing the
   assertions too.
7. **Keep the Solidity contract identical across both toolchains.** If
   you change `contracts/foundry/src/PepuNft.sol`, make the exact same
   change to `contracts/hardhat/contracts/PepuNft.sol` (same filename,
   same content) — see `contracts/README.md`.
8. **Don't bypass the SDK's `PepuPrivyWagmiProvider` / `pepuWagmiConfig`.**
   They use `@privy-io/wagmi`'s `createConfig`/`WagmiProvider`, not plain
   `wagmi`'s — see
   the `consumer-app` template's `AGENTS.md` for the full explanation of this
   footgun (same rule applies here).
9. **Privy's SDK surface can change between versions.** The versions
   pinned in `package.json` were verified against docs.privy.io at the
   time this template was written. Follow Privy's current docs over
   anything written here if an upgrade changes a prop name or hook
   shape.
10. **Never rely on `createOnLogin` alone for wallet creation, and never
    remove `<WalletGate>` in `components/signed-in-view.tsx`.** the SDK's `createPepuPrivyConfig` sets `createOnLogin: "off"` deliberately — some Privy dashboard
    configurations disable automatic on-login wallet creation app-wide
    (confirmed live against the `consumer-app` template's Privy app; see
    that template's `AGENTS.md` / `README.md` "Custody model"), and a
    screen that only waits on it hangs forever. `WalletGate` instead
    calls this app's own `POST /api/wallet/ensure` route right after
    login. Wrap any new wallet-dependent UI in `<WalletGate>`, the same
    way `signed-in-view.tsx` wraps `WalletCard`/`GasNotice`/`MintPanel`/
    `OwnedTokens`.
11. **Never add backend signing authority over the user's wallet in this
    template.** No route here should hold a session-signer authorization
    key or call `useSigners().addSigners()` / `useCreateWallet({ signers:
    [...] })`. `app/api/wallet/ensure/route.ts` (the SDK's `createEnsureWalletRoute`) uses `PRIVY_APP_SECRET`
    for exactly two things — verifying access tokens and creating a
    wallet via `owner: { user_id }` — neither of which grants signing
    authority. That's a legitimate, differently-scoped pattern — see
    the `game-app` template — but it changes the trust model this template
    demonstrates and needs its own explicit consent UI if it's ever
    wanted here.
12. **The embedded wallet is the active wagmi account by default — keep
    it that way.** the SDK's `useActiveWalletPin` (mounted once by `PepuPrivyWagmiProvider` in `app/providers.tsx`, inside its `<WagmiProvider>`) uses
    `@privy-io/wagmi`'s `useSetActiveWallet` to re-assert the embedded
    wallet as wagmi's active connection any time it drifts — e.g. an
    installed browser extension auto-connecting and silently becoming
    the account `mint-panel.tsx`'s mint transaction would otherwise use.
    Don't swap `PepuPrivyWagmiProvider` for a provider that drops the pin. To opt out —
    e.g. an app that deliberately wants an external wallet to be the
    active account — pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider` in `providers.tsx`. See `README.md`'s "Active wallet" section.

## Extending this template

- **Rendering actual metadata/images:** the contract's `_baseURI()` is
  already wired up (see the constructor's `baseURI_` argument in both
  `contracts/*/README.md`). Once you have metadata hosted, fetch
  `tokenURI(id)` and render it — this template deliberately stops short
  of that so it doesn't depend on any particular metadata host or image
  CDN.
- **Adding an allowlist or reveal mechanism:** these belong in the
  Solidity contract, not the frontend — extend `PepuNft.sol` (both
  copies) rather than trying to fake either one in the UI.
- **Adding royalties (ERC-2981):** same — add the OpenZeppelin
  `ERC2981` extension to the contract, following the same multiple-
  inheritance override pattern already used for `ERC721Enumerable` (see
  the `_update`/`_increaseBalance`/`supportsInterface` overrides).

## Scope boundary

This template is self-contained. `@pepu-chain/sdk` is a dependency (vendored
under `vendor/pepu-sdk` until it is published to npm), so do not edit that
copy. If a change here seems to require changing the SDK itself, stop and
flag it instead.

<!-- BEGIN:pepu-agent-kit -->

## PEPU dev kit: agent wiring

This project is built on the PEPU dev kit (`@pepu-chain/sdk`, `@pepu-chain/mcp`, the PEPU skills). Template: **NFT mint** (`nft-mint`). Features: `login`. Use the kit; do not hand-roll what it already provides.

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

Required: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`
Optional: none
Privy dashboard settings this template needs:

- enable the login methods you use (email, Google, ...)
- add your app origin including the port (e.g. `http://localhost:3000`)
- enable embedded wallets and create-on-login

Extra steps:

- Deploy the ERC-721 contract in contracts/ (Foundry or Hardhat, see its README) and set NEXT_PUBLIC_NFT_CONTRACT_ADDRESS to the deployed address.


Run `npm run doctor` to check `.env.local` against this template's requirements. It reports presence and shape only. Fix every `FAIL` before running the app.

### Never print secrets

Never print, log, echo, commit or paste secret values (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key, bundler or paymaster URLs that embed an app key, API keys). Do not read `.env*` files into the conversation; use `npm run doctor`, which never prints values. Only `NEXT_PUBLIC_*` values are safe to show. If a secret is ever exposed, say so and tell the user to rotate it.

<!-- END:pepu-agent-kit -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
