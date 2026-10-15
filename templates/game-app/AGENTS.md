# AGENTS.md — PEPU game template

Instructions for coding agents working in this template.

## Build and run

```bash
npm install
npm run dev          # or: build / start / typecheck / lint / test
npm run generate-authorization-key
```

From the monorepo root: `pnpm -r typecheck` and `pnpm -r build` must both stay green.

## Built on `@pepu-chain/sdk`

Chain, wallet, session and policy logic comes from the SDK. **Never redefine a chain, RPC URL, explorer URL, address, or policy here** — import it. What this template uses:

| Job | SDK function (subpath) | Where |
|---|---|---|
| Privy + wagmi providers, embedded wallet pinned as the active account | `PepuPrivyWagmiProvider` (`/privy/wagmi`) | `app/providers.tsx` |
| Wallet provisioning after login | `createEnsureWalletRoute` (`/privy/server`), `useEnsureWallet` (`/privy/react`) | `app/api/wallet/ensure`, `<WalletGate>` in `components/signed-in-view.tsx` |
| Embedded vs external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Scoped policy, consent data | `buildSessionPolicy`, `describeSessionScope`, `SESSION_TRUST_NOTICE` (`/session`) | `lib/scope.ts`, `components/session-consent-screen.tsx` |
| Grant / status / revoke routes | `createSessionRoutes` (`/session/server`) | `app/api/session/*` |
| One gameplay tx, signed with the session, broadcast by the SDK | `createSessionActionRoute` (`/session/server`) | `app/api/game/tap` |
| Client session flow | `useSessionGrant`, `useSessionStatus`, `useSessionRevoke`, `useSessionAct` (`/session/react`) | `components/` |
| Key generation | `generatePrivyAuthorizationKey` (`/doctor`) | `scripts/generate-authorization-key.mjs` |

Before changing Privy or env config, call the MCP tools `pepu_check_env` / `pepu_check_privy_config` (`@pepu-chain/mcp`).

## Three rules that must not be broken

These are the reason this template exists. A change that violates one is wrong even if it compiles and the tests pass.

### 1. A session signer is ALWAYS created with a scoped policy attached

`lib/scope.ts` defines the one scope (the game contract plus `tap()`), and `buildSessionPolicy` (called inside `createSessionRoutes`, behind `app/api/session/grant`) is the only thing that turns it into a policy. Do not add another path, and do not hand-write a policy body.

Privy policies are **opt-in**. A signer granted with an empty `policyIds` is effectively unscoped over the player's entire wallet. Never create one — not as a fallback, not as a debug option, not commented out for someone to uncomment later. `buildSessionPolicy` refuses an unscoped policy (no functions, bad address, no expiry); keep it that way.

The policy scopes four things, all four required: contract address, function selector (`tap()`), zero value, and a time-bound expiry. If you add a gameplay function, add its ABI fragment to `lib/scope.ts` (`sessionScope.functions`); the rule and its conditions follow. Widening the policy widens the blast radius of a leaked authorization key.

`tap()` being non-payable is load-bearing — it is what makes the zero-value condition meaningful. Do not make gameplay functions payable.

**Policy and rule names must be at most 49 characters.** Privy's live validator says "must be fewer than 50 characters", stricter than the 50 in its published spec. `buildSessionPolicy` checks this (`PRIVY_POLICY_NAME_MAX_LENGTH`, error `POLICY_NAME_TOO_LONG`); if you pass a custom `name`, keep it short.

### 2. Say plainly that enforcement is off-chain

The scope is enforced by **Privy's backend policy engine, not an on-chain validator**. Unlike an ERC-4337/7579 session-key module, there is no on-chain code a studio can audit to verify these limits.

This is stated in `README.md` and to the player in `components/session-consent-screen.tsx` (rendered from the SDK's `SESSION_TRUST_NOTICE["privy-offchain"]`). Keep it in both. Do not soften it into "secure by default" or drop it for being wordy — someone shipping a real game needs to know which trust model they picked.

### 3. Never imply transactions are free or sponsored

EntryPoint v0.6/v0.7, the Kernel factory, and the v2 paymaster canary (external audit pending) are deployed on Pepe Unchained V2 mainnet, and PEPU hosts the bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`). Sponsorship needs a project token and is proven live on mainnet in the `sponsored-demo` and `sponsored-session-app` templates, but it is **not used by this template.** Players pay their own gas in PEPU.

`components/gas-notice.tsx` says so and must stay visible. Never add a "gasless" badge, never describe taps as free. "Costs a fraction of a cent" is accurate; "free" is not.

## Wallet provisioning

`createPepuPrivyConfig` (inside `PepuPrivyWagmiProvider`) sets `createOnLogin: "off"` deliberately, and `<WalletGate>` in `components/signed-in-view.tsx` provisions the embedded wallet instead (SDK `useEnsureWallet` calling this app's `POST /api/wallet/ensure`, which is `createEnsureWalletRoute()`). Do not remove `<WalletGate>` from `signed-in-view.tsx`, and do not "fix" a missing-wallet issue by relying on `createOnLogin` alone — some Privy dashboard configurations disable automatic on-login wallet creation app-wide (see the `consumer-app` template's `AGENTS.md` / `README.md`, "Custody model"), and without the gate a player on such a dashboard could never reach the grant flow.

`createEnsureWalletRoute` uses `PRIVY_APP_SECRET` for exactly two things — verifying access tokens and creating a wallet via `owner: { user_id }` — neither of which grants signing authority. Only `app/api/session/grant` (rule 1) may delegate signing authority, and only via a scoped, time-bound, player-consented policy. Do not fold signer-granting logic into the gate or `wallet/ensure`.

## Active wallet policy

`PepuPrivyWagmiProvider` mounts `useActiveWalletPin` (`/privy/wagmi`), which keeps wagmi's active account pinned to the player's Privy embedded wallet whenever one exists. This matters here: **Privy only attaches session signers to embedded wallets**, so every session hook in this app is passed the address from `useEmbeddedWallet()`, never wagmi's `useAccount()`. Don't gate any session-signer action on `useAccount()`'s address.

A player who logs in via an external wallet only (no embedded wallet) is left on that wallet, but cannot grant a session signer, for the Privy-side reason above. To opt out of the pin (not recommended here) pass `pinEmbeddedWallet={false}` to the provider.

## Secrets

Server secrets (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`) are read by the SDK's `/privy/server` and `/session/server` entry points (`privyEnvVar`), which refuse to load in a browser bundle. Never read them in a client component, never prefix them `NEXT_PUBLIC_`.

`/api/config` reports **booleans only**, never values. Keep it that way.

Public config (`NEXT_PUBLIC_*`) is fine client-side: app ID, key quorum ID, contract address.

## Honesty about verification

The live session-signer flow was run end to end on PEPU mainnet against a real Privy app (sign in, grant a session, tap with no popup) with the hand-written version of this template. That run surfaced the `eth_signTransaction` plus self-broadcast pattern, which now lives in the SDK (`privySessionSigner`, `createSessionActionRoute`). The SDK-based rewrite is covered by typecheck, lint, build and the scope tests but has not itself been re-run against a live Privy app. What remains unverified is listed in "What has not been verified" in `README.md`; if you verify any of it, update that section. Do not quietly delete it, and do not claim something works because it compiles.

## Conventions

Follow the `consumer-app` template for stack and style — Next.js App Router, TypeScript strict, Tailwind, named exports. This template should feel like its sibling.

<!-- BEGIN:pepu-agent-kit -->

## PEPU dev kit: agent wiring

This project is built on the PEPU dev kit (`@pepu-chain/sdk`, `@pepu-chain/mcp`, the PEPU skills). Template: **Game app** (`game-app`). Features: `login`, `session`. Use the kit; do not hand-roll what it already provides.

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
- Session signers (grant once, no popup per action): `/session` (`buildSessionPolicy`, `describeSessionScope`), `/session/server` (`createSessionRoutes`, `createSessionActionRoute`), `/session/react` (`useSessionGrant`, `useSessionAct`, `useSessionRevoke`).
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

Required: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`, `PRIVY_AUTHORIZATION_KEY`, `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS`
Optional: `SESSION_DURATION_MINUTES`, `PEPU_RPC_URL`
Privy dashboard settings this template needs:

- enable the login methods you use (email, Google, ...)
- add your app origin including the port (e.g. `http://localhost:3000`)
- enable embedded wallets and create-on-login
- register the authorization key as a key quorum

Extra steps:

- Run `npm run generate-authorization-key` to create a P-256 authorization key pair. Register the public key as a key quorum in the Privy dashboard, then set NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID (the quorum id) and PRIVY_AUTHORIZATION_KEY (the private key; server only, never commit it).
- Deploy the TapScore contract in contracts/ (Foundry or Hardhat) and set NEXT_PUBLIC_GAME_CONTRACT_ADDRESS.


Run `npm run doctor` to check `.env.local` against this template's requirements. It reports presence and shape only. Fix every `FAIL` before running the app.

### Never print secrets

Never print, log, echo, commit or paste secret values (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key, bundler or paymaster URLs that embed an app key, API keys). Do not read `.env*` files into the conversation; use `npm run doctor`, which never prints values. Only `NEXT_PUBLIC_*` values are safe to show. If a secret is ever exposed, say so and tell the user to rotate it.

<!-- END:pepu-agent-kit -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
