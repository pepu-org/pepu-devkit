---
name: pepu-build-dapp
description: Entry point for building a Pepe Unchained (PEPU) V2 app from zero to running, agent-driven with no manual steps beyond secrets. Scaffolds a Next.js app with create-pepu-app (npx create-pepu-app --json) or the MCP tools pepu_list_templates and pepu_scaffold_app, picks the template by pillar (Google login, Privy session keys, sponsored transactions, or the sponsored session), fills and checks the environment with pepu_check_env and pepu_check_privy_config, runs the app, and hands off to the pillar skills. Every template is built on @pepu-chain/sdk and ships .mcp.json, AGENTS.md and CLAUDE.md. Use whenever someone asks to build, start, scaffold or add features to a PEPU app or dapp, or says "Google login", "session keys", "gasless" or "sponsored" for a new project.
---

# Build a PEPU app (scaffold first)

Do not write a PEPU app from a blank folder. Scaffold a template that already uses `@pepu-chain/sdk`, then change it.

## When to use

A new app, or a feature added to one. For an existing project that is not a template, still read the matching pillar skill and use the SDK functions it lists.

Choosing the template for gas and sessions: plain wallet (`consumer-app`), Privy session signers (`game-app`), Privy Smart Wallets (`sponsored-demo`) or ZeroDev-native sessions (`sponsored-session-app`). Decision table: https://docs.pepeunchained.com/concepts/smart-account-paths.

## Chain facts

Chain 97741, mainnet only, native PEPU (gas), pepuscan.com. Generated, complete facts: [reference/chain-facts.md](reference/chain-facts.md). Rules: [reference/rules.md](reference/rules.md).
There is no faucet and no testnet workflow: the dev wallet needs a small amount of real PEPU (buy on an exchange, or bridge from Ethereum L1 via pepubridge.com), a transfer costs a fraction of a cent. You cannot fund a user's wallet.

## SDK functions to use

The templates already wire these; you extend them with the same functions:

```ts
import { pepuMainnet, getPepuAddresses, explorerLinks } from "@pepu-chain/sdk";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";
import { createEnsureWalletRoute, requireUser } from "@pepu-chain/sdk/privy/server";
import { checkPepuEnv, runDoctor, TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
```

Which functions per pillar: `pepu-sdk` (map), `pepu-onboarding-privy`, `pepu-session-keys`, `pepu-sponsored-transactions`, `pepu-sponsored-session`.

## MCP tools to call first

1. `pepu_list_templates`: templates with doctor pillars and CLI features, required env, Privy dashboard needs, when to pick, commands.
2. `pepu_scaffold_app`: `{ template, directory (absolute, must not exist or be empty), packageManager?, privyAppId?, bundlerUrl?, paymasterUrl?, dry_run? }`. Runs the CLI with `--json`; returns paths, next steps and what env is still missing. Never echoes secrets. Try `dry_run: true` first if unsure.
3. `pepu_check_env`: `{ projectDir, template }`: per key `ok`, `missing`, `placeholder`, `malformed`, with the fix, never values.
4. `pepu_check_privy_config`: `{ appId, origin, pillars }` (`login`, `session`, `sponsor`; `sponsorship` is accepted as an alias): allowed origin with exact port, login methods, embedded wallets, smart wallets.
5. `pepu_sponsorship_status` for any template with the `sponsorship` pillar. `pepu_sdk_snippet` for extra wiring.

## Steps

### 1. Choose the template by pillar

| Want | Template | Pillars | Needs beyond Privy |
|---|---|---|---|
| Google (and email) login, an embedded wallet, send PEPU | `consumer-app` (default) | login, wallet | nothing |
| Hold-to-unlock content (ERC-20 or NFT) | `token-gated-app` | login, wallet, gate | `NEXT_PUBLIC_GATE_ERC20_ADDRESS` and/or `NEXT_PUBLIC_GATE_ERC721_ADDRESS` |
| An NFT mint page plus the contract | `nft-mint` | login, wallet, mint | deployed contract address |
| Popup-free actions, user pays gas (Privy session signers) | `game-app` | login, wallet, session | authorization key and key quorum, game contract address |
| Gasless transactions with a Kernel smart account | `sponsored-demo` | login, wallet, sponsorship | a bundler and paymaster (Privy Smart Wallets, or direct URLs) |
| Google login, one signature, then no popups and no user gas | `sponsored-session-app` | login, wallet, session, sponsorship | `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL` |

For a combination not listed, scaffold the closest one and add the missing pillar from its skill. The hosted bundler (`https://bundler.pepeunchained.com`) is the default; sponsorship templates need a paymaster URL with the project's token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`), so say that a project (claim, deposit, token) is required. Deposits to the v2 paymaster are one-way.

### 2. Scaffold

MCP: `pepu_scaffold_app` with the template and an absolute directory. CLI, from an empty parent directory:

```bash
npx create-pepu-app@latest my-app --template consumer-app --pm pnpm --yes --no-install --no-git --json
```

With `--json` stdout is exactly one JSON document and nothing else (`--json` implies `--yes`). Success shape: `{ ok: true, path, targetDir, template, features, packageManager, sdk, installed, gitInitialized, envFile, requiredEnv: [{ key, secret, missing }], missingEnv, privyDashboard: [{ id, label, fix }], nextSteps, agentFiles, warnings }`;
failure: `{ ok: false, error }` with exit code 1. Only key names are ever reported. Other flags: `--sdk <vendor|npm>` (default `vendor`: a bundled copy at `file:./vendor/pepu-sdk`), `--skip-agent-files`, `--list`. Read `missingEnv` and `privyDashboard` and act on them.
The result contains `.env.local` (copied from `.env.example`), `AGENTS.md`, `CLAUDE.md`, editor MCP configs, `.claude/settings.json` (enables the pepu-devkit plugin, which provides the MCP server and skills), and the SDK wiring.

### 3. Install

```bash
cd my-app && pnpm install
```

### 4. Environment

Run `pepu_check_env` with `projectDir` and `template`. Ask the user only for what only they have:

- `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` from dashboard.privy.io (Settings, Basics). Write them into `.env.local` yourself; do not echo the secret.
- For `game-app`: run `pepu_generate_authorization_key` (private half goes to `.env.local`, you get the public key), ask the user to register the public key in the Privy dashboard (see `pepu-session-keys`), then set `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`.
- For sponsorship templates: `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` (a paymaster URL is a secret).
- A contract address (`NEXT_PUBLIC_GAME_CONTRACT_ADDRESS`, `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`, gate addresses): deploy with `pepu-deploy-contract` / `pepu-token-and-nft`.

Re-run `pepu_check_env` until nothing required is `missing`, `placeholder` or `malformed`.

### 5. Privy dashboard

Run `pepu_check_privy_config` with the app id, the dev origin **including the port** (`http://localhost:3000`) and the template's pillars. The field-by-field checklist is in `pepu-onboarding-privy`; session fields in `pepu-session-keys`; Smart Wallets in `pepu-sponsored-transactions`. Tell the user exactly which rows failed and what to click.

### 6. Run and prove it

```bash
pnpm dev        # open http://localhost:3000; free the port first: a move to 3001 breaks login
pnpm typecheck && pnpm build
```

With no Privy id the app shows a setup screen instead of crashing. Every template defines `npm run doctor`, which runs the SDK's env check against `.env.local` (names and status only).
Prove the pillar: sign in; see the embedded wallet address; for session templates grant once and act with no popup; for sponsorship run `pepu_sponsorship_status` first and report its answer.

### 7. Extend with the SDK, then deploy

Add features with the functions in `pepu-sdk`. Custom contracts: `pepu-deploy-contract` (Foundry primary) and `pepu-token-and-nft`. Batched reads: `pepuMulticall` (`pepu-chain-setup`). When something fails: `pepu-debug-transaction`.

## Verify

1. `pepu_check_env` has no required key missing; `pepu_check_privy_config` has no failing row.
2. `typecheck` and `build` pass; `dev` serves and sign-in works with a real Privy app.
3. The pillar works end to end as in step 6, and any gas claim in the UI matches `pepu_sponsorship_status`.

## Pitfalls

- **Port drift:** Next.js falls back to 3001 when 3000 is busy and Privy login then fails (origin not allowed). Free 3000 or add the exact origin.
- **Do not copy template internals into another project by hand;** scaffold, or import the same SDK functions.
- **UI copy:** a plain EOA send costs real gas and says so. Never label a transaction "free" or "gasless" unless a paymaster paid it (`pepu_sponsorship_status`, `result.paymaster`).
- **The SDK comes from npm** (`@pepu-chain/sdk` 0.2.2) by default; `--sdk npm` falls back to a vendored copy (`vendor/pepu-sdk`) with a warning only if npm is unreachable.
- Never commit `.env.local` or print secrets.
- Mainnet only: do not add a testnet switch.

## Never hand-roll

Do not hand-write chain config, Privy provider config, wallet creation, session routes, sponsored sends or env checks in a PEPU app. The template already has them via the SDK; use `pepu-sdk` to find the right function and [reference/rules.md](reference/rules.md) for the full list.
