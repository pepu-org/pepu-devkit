# AGENTS.md — PEPU Sponsored Session App

Instructions for a coding agent working in this template: Google sign-in, one scoped on-chain session grant, then actions with no popup and no user gas (ZeroDev Kernel v3.1 session key + PEPU paymaster) on Pepe Unchained V2 (chain 97741).

## Hard rules

1. **Say exactly where the scope is enforced.** On-chain, by the user's Kernel account (call policy + timestamp policy). Not by Privy, not by this app's server. Never write copy implying otherwise, and never imply the server or Privy is what limits the key.
2. **The scope has one definition:** `scope` in `lib/scope.ts`, turned into policies by the SDK's `buildKernelSessionPolicies`. The consent screen is rendered from `describeKernelSessionScope`. Do not hand-write consent copy that could drift from the policy. Keep it as narrow as the action: one target, one selector, value 0, short expiry. Never add a sudo or unscoped path, not even commented out.
3. **Call policy v0.0.4 is pinned inside the SDK.** v0.0.5 is not deployed on PEPU. Do not bump the ZeroDev packages without checking `eth_getCode` for every contract on chain 97741.
4. **The owner key never reaches the server.** The owner signs once, in the browser, to enable the permission. The server holds only the session key. Never ask Privy to sign UserOperations server-side here.
5. **Never trust the client for identity or address.** The owner address comes from Privy's records for the verified access token (the SDK's `requireUser` from `@pepu-chain/sdk/privy/server`, used by every combo route). Never read a user id, owner address or kernel address from a request body. Never accept a private key in an approval.
6. **Two addresses, always labelled:** the embedded wallet is the Signer; the Kernel account is the Sender and is the address that appears on pepuscan. Never present the EOA as the user's wallet for actions.
7. **Be honest about gas.** PEPU hosts the bundler (`https://bundler.pepeunchained.com`) and the paymaster service (`https://paymaster.pepeunchained.com`), and sponsorship is proven through them. The v2 paymaster is a canary: internally reviewed 3 times, external audit pending, funded in small tranches; say so, never "audited". The ERC-7677 URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`; this template sends from the server, so the token is the project's server key and the URL is a secret (never print it). A client token only works from the project's allowed origins. The free tier (100 PEPU/day, 50 PEPU/hour per user, TapScore only) needs a Privy token from PEPU's own Privy app, so it does not cover a third-party app. Never hardcode a tunnel URL (no ngrok). Do not call it "gasless for everyone": it is sponsored by whoever runs the paymaster, within caps.
8. **Revoke is server-side only** (deletes the session key). It does not uninstall the permission on-chain; the grant lapses at expiry. Say so; do not label it a full on-chain revocation.
9. **Sessions are in memory** (`createMemoryStore`, wired in `lib/session-routes.ts`). Production needs a real store with the session key encrypted at rest. Do not claim otherwise.
10. **Server secrets stay behind `server-only`** (`lib/env.server.ts`, `lib/session-routes.ts`). `/api/config` returns booleans only. Mainnet only; no testnet switch.
11. **The target contract comes from the SDK registry** (`getContract(97741, "tapScore")` in `lib/scope.ts`), never an env var: the on-chain policy and the paymaster allowlist both name it.
12. **Run on port 3000 only** (Privy allowed origins include the port).
13. **Use the SDK, do not rebuild it.** Session mechanics are `createSponsoredSessionRoutes` (`@pepu-chain/sdk/combo`) and `useSponsoredSession` (`/combo/react`); policy, approval and store are `buildKernelSessionPolicies`, `approveKernelSession`, `loadKernelSessionAccount`, `createMemoryStore`, `isLive` (`/session/kernel`); wallet is `PepuPrivyProvider`, `WalletGate`, `createEnsureWalletRoute` (`/privy/*`).

## What is where

- `lib/scope.ts`: the scope. `lib/session-routes.ts`: `createSponsoredSessionRoutes` with TapScore `tap()` as `act.buildCalls`, plus the dev store. `lib/tapscore.ts`: the ABI.
- `app/api/session/{prepare,activate,status,act,revoke}`: one-line mounts of those routes (the state machine lives in the SDK). `app/api/wallet/ensure`: `createEnsureWalletRoute()`.
- `components/session-flow.tsx`: the flow on `useSponsoredSession`. `scripts/prove-session.ts`: live proof through the SDK (sends real sponsored mainnet UserOperations with throwaway keys). Negative proofs: the SDK's `prove-session`.
- Fees come from the chain with 20% headroom inside the SDK (Alto lacks ZeroDev's gas-price RPC).
- Per-user paymaster caps must clear the first operation (about 20 PEPU worst case; `SESSION_GAS_RESERVATION_PEPU`). See README "Gas budget".

<!-- BEGIN:pepu-agent-kit -->

## PEPU dev kit: agent wiring

This project is built on the PEPU dev kit (`@pepu-chain/sdk`, `@pepu-chain/mcp`, the PEPU skills). Template: **Sponsored session app** (`sponsored-session-app`). Features: `login`, `session`, `sponsor`. Use the kit; do not hand-roll what it already provides.

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
- Login plus one session plus sponsored gas: `/combo` and `/combo/react` (`createSponsoredSessionRoutes`, `useSponsoredSession`), built on `/session/kernel`, `/aa`, `/aa/kernel` and `/paymaster`.
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

Required: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`
Optional: `SESSION_DURATION_MINUTES`, `PEPU_RPC_URL`
Privy dashboard settings this template needs:

- enable the login methods you use (email, Google, ...)
- enable Google login
- add your app origin including the port (e.g. `http://localhost:3000`)
- enable embedded wallets and create-on-login

Extra steps:

- Set PEPU_BUNDLER_URL (default https://bundler.pepeunchained.com) and PEPU_PAYMASTER_URL (https://paymaster.pepeunchained.com/v2/paymaster/<your project server key>; server only, it embeds a secret). Get a project first: claim, deposit, set limits, register (see README).


Run `npm run doctor` to check `.env.local` against this template's requirements. It reports presence and shape only. Fix every `FAIL` before running the app.

### Never print secrets

Never print, log, echo, commit or paste secret values (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key, bundler or paymaster URLs that embed an app key, API keys). Do not read `.env*` files into the conversation; use `npm run doctor`, which never prints values. Only `NEXT_PUBLIC_*` values are safe to show. If a secret is ever exposed, say so and tell the user to rotate it.

<!-- END:pepu-agent-kit -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
