# AGENTS.md — PEPU Sponsored Demo

Instructions for a coding agent working in this template. It is the smallest browser proof that gas sponsorship works end to end on Pepe Unchained V2 (chain 97741): a zero-balance Kernel smart account sends one sponsored `TapScore.tap()` UserOperation, and the paymaster's own EntryPoint deposit drops.

## Hard rules

1. **State sponsorship accurately.** Sponsorship runs through the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`) on the v2 paymaster. A developer must bring a project token: the Privy Dashboard paymaster URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`. The free tier (100 PEPU/day, 50 PEPU/hour per user, TapScore only) needs a Privy token from PEPU's own Privy app, which the Dashboard URL cannot attach, so do not promise it here. The paymaster URL embeds a credential: never hardcode or print a real one.
2. **Two addresses, always labelled.** The embedded wallet (an EOA) is only the signer; the Kernel smart account is a different address and is the one that transacts and shows up on pepuscan. Show the smart account address, never present the EOA as "your wallet" in this app, and never tell a user to send funds to one expecting them at the other.
3. **The proof is the deposit drop, not the transaction.** A transaction succeeding says nothing about who paid. Keep the before and after reads of the paymaster's EntryPoint deposit and the drop panel; do not replace them with a bare success message.
4. **All smart-wallet configuration lives in the Privy Dashboard**, not in code: Smart Wallets enabled, chain 97741, provider Kernel, a bundler URL and a paymaster URL. If it is off, the page waits forever on "Setting up your smart wallet...". Do not add client-side config to work around that.
5. **Mainnet only.** The paymaster, bundler and Kernel factory only exist on mainnet (97741). Do not add a testnet switch.
6. **The target contract is hardcoded** (`lib/tapscore.ts`). The paymaster only sponsors calls to allowlisted contracts, and a silently changed address would turn into an opaque denial. Changing it means changing the allowlist and your app's allowed destinations too.
7. **Never claim "gasless" for the tiered model.** The tiered sponsorship model (free tier plus project deposits) is live, with conditions: the free tier needs a verified Privy token from PEPU's own Privy app and covers TapScore only, and project sponsorship needs a claimed, funded project with the destination in its targets. A zero-balance account is only gas-free when one of those applies.

## What is where

Everything below is `@pepu-chain/sdk`; do not hand-roll it.

- `app/providers.tsx`: `PepuPrivyProvider` (`/privy/react`) with Privy's `SmartWalletsProvider` composed inside it via `composeProviders`.
- `<WalletGate>` in `components/signed-in-view.tsx` and `app/api/wallet/ensure/route.ts`: `useEnsureWallet` and `createEnsureWalletRoute()` (`/privy/react`, `/privy/server`) create the owner embedded wallet server-side after login (needs `PRIVY_APP_SECRET`). Privy's own login-time creation screen can stall, so this is the fallback; it gives the server no signing authority.
- `components/sponsored-tap-demo.tsx` is the whole sponsored path (`/aa`, `/aa/react`):
  - `useSponsoredSend({ transport: "privy-smart-wallets" })`: one send, waits for the receipt, one at a time, errors already passed through `describeUserOpFailure` (the paymaster's real denial reason, secrets redacted).
  - `usePepuSmartAccount`: the Kernel address, distinct from the owner EOA.
  - `getPaymasterDeposit`: the deposit before and after (the proof).
  - `usePepuSponsorship` (wraps `checkSponsorship`): consulted only after a failure, to say whether `PEPU_BUNDLER_URL` / `PEPU_PAYMASTER_URL` are set.
- `lib/tapscore.ts` is the only template-specific code: the target (from the SDK registry via `getContract`) and its ABI. `lib/env.ts` reads the two public variables.
- Transport: this template stays on **Privy Smart Wallets**, so `@pepu-chain/sdk/aa/react` never resolves `@zerodev/*`. It does need `permissionless` (Privy's smart-wallets module requires it), which is in `package.json`. The SDK's direct transport (`useDirectSponsoredSend` from `/aa/react-direct`, your own bundler and paymaster, needs `@zerodev/*`) is not used here.
- Before changing Privy or env config, call the MCP tools `pepu_check_env` / `pepu_check_privy_config` (`@pepu-chain/mcp`).
- Run on port 3000 only: Privy's allowed origins match the exact origin including the port, and Next.js silently falls back to 3001 when 3000 is taken.

<!-- BEGIN:pepu-agent-kit -->

## PEPU dev kit: agent wiring

This project is built on the PEPU dev kit (`@pepu-chain/sdk`, `@pepu-chain/mcp`, the PEPU skills). Template: **Sponsored demo** (`sponsored-demo`). Features: `login`, `sponsor`. Use the kit; do not hand-roll what it already provides.

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
- Sponsored transactions: `/aa` (`describeUserOpFailure`, bundler and paymaster clients), `/aa/react` (`useSponsoredSend`, `usePepuSmartAccount`, `usePepuSponsorship`), `/paymaster` (project balance, deposits).
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
Optional: `NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS`
Privy dashboard settings this template needs:

- enable the login methods you use (email, Google, ...)
- add your app origin including the port (e.g. `http://localhost:3000`)
- enable embedded wallets and create-on-login
- enable Smart Wallets: chain 97741, provider Kernel, plus bundler and paymaster URLs

Extra steps:

- In the Privy dashboard enable Smart Wallets: chain 97741, provider Kernel, bundler URL https://bundler.pepeunchained.com and paymaster URL https://paymaster.pepeunchained.com/v2/paymaster/<your project token> (claim, deposit and register a project first; see README).


Run `npm run doctor` to check `.env.local` against this template's requirements. It reports presence and shape only. Fix every `FAIL` before running the app.

### Never print secrets

Never print, log, echo, commit or paste secret values (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key, bundler or paymaster URLs that embed an app key, API keys). Do not read `.env*` files into the conversation; use `npm run doctor`, which never prints values. Only `NEXT_PUBLIC_*` values are safe to show. If a secret is ever exposed, say so and tell the user to rotate it.

<!-- END:pepu-agent-kit -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
