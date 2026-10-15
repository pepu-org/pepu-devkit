# Pepe Unchained Developer Docs

Developer documentation for building on Pepe Unchained V2 (Arbitrum Orbit, mainnet chain ID `97741`). The published site is [guide.pepeunchained.com](https://guide.pepeunchained.com); the same pages live here as Markdown. You do not need to clone this repository to build on PEPU:

```bash
npx create-pepu-app@latest          # scaffold a Next.js + Privy app
npm i @pepu-chain/sdk viem          # chain definitions, contracts, ABIs, helpers
npx -y @pepu-chain/mcp              # MCP server for coding agents
```

For Claude Code, install the plugin (skills plus the MCP server):

```text
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

## The shortest path

1. [What is Pepe Unchained V2](get-started/introduction.md): the chain in one page.
2. [The Three Pillars](get-started/pillars.md): login, sessions, sponsored gas, and how they combine.
3. [Smart Account Paths](concepts/smart-account-paths.md): which setup to start from.
4. [Quickstart](get-started/quickstart-app.md): `npx create-pepu-app@latest`, fill `.env.local`, click the Privy dashboard settings, `npm run doctor`, `npm run dev`, first sponsored transaction. With an AI agent: [Build with an AI Coding Agent](get-started/ai-assisted.md).

## The nine deliverables

The dev kit is SDK-first: every other deliverable uses the SDK instead of re-implementing it.

| # | Deliverable | What it is | Docs |
|---|---|---|---|
| 1 | SDKs | `@pepu-chain/sdk`: chain, contracts registry, Privy, sessions, account abstraction, paymaster, combined flow, doctor | [SDK](sdk/reference.md) |
| 2 | MCP + agentic skills | `@pepu-chain/mcp` (32 tools, 6 prompts) and 12 agent skills that call the SDK and MCP | [MCP](mcp/index.md), [Skills](agent-tooling/skills.md) |
| 3 | Plugins | The `pepu-devkit` Claude Code plugin: MCP server, skills, 6 commands and a builder subagent | [Plugin](agent-tooling/plugin.md) |
| 4 | Starter templates | Six templates, from a consumer app to the full sponsored session | [Templates](templates/index.md) |
| 5 | CLI scaffolding | `create-pepu-app` scaffolds a Next.js app with a chosen template | [CLI](cli/create-pepu-app.md) |
| 6 | Developer docs | This site, one source of truth for all of the above | [Style guide](CONTRIBUTING-DOCS.md) |
| 7 | Our own bundler | The ERC-4337 bundler (Alto) for PEPU, hosted at `bundler.pepeunchained.com` | [Bundler](infra/bundler/overview.md) |
| 8 | Paymaster infrastructure | The verifying paymaster, its policy service and REST APIs, hosted at `paymaster.pepeunchained.com` | [Paymaster](infra/paymaster/overview.md) |
| 9 | Multicall3 and supporting infrastructure | Multicall3, Permit2, EntryPoints, Kernel, with every address | [Contracts](contracts/address-map.md) |

## The three pillars

1. **Google to wallet.** Sign in with Google and get an embedded wallet on PEPU. Proven live on mainnet.
2. **Session keys.** Approve once, then act with no wallet popup. Two modes: Privy session signers (proven) and Kernel on-chain session keys (proven live in a browser, 2026-10-14).
3. **Sponsored transactions.** The user pays no gas. Works end to end on mainnet through the hosted bundler and paymaster.

Their combination is the headline flow: [Google Login, Session and Sponsorship End to End](onboarding/google-session-sponsored.md). Start with [The Three Pillars](get-started/pillars.md).

## Where to start

| I want to... | Read |
|---|---|
| Understand the chain | [What is Pepe Unchained V2](get-started/introduction.md), [Network Reference](get-started/network-reference.md) |
| Get a running app and a first sponsored transaction | [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](get-started/quickstart-app.md), [Template Gallery](templates/index.md) |
| Choose between a plain wallet, ZeroDev-native and Privy Smart Wallets | [Smart Account Paths](concepts/smart-account-paths.md) |
| Get a paymaster project (claim, deposit, keys) | [Register, Deposit and Claim a v2 Project](infra/paymaster/v2-register-deposit-claim.md) |
| Look up a term (UserOperation, bundler, paymaster, Kernel) | [Glossary](reference/glossary.md) |
| Build with an AI agent | [Build with an AI Coding Agent](get-started/ai-assisted.md), [MCP](mcp/index.md) |
| Configure Privy | [Dashboard Settings](privy/dashboard-settings.md), [Privy Setup](onboarding/privy-setup.md) |
| Avoid a wallet popup per action | [Session Keys](onboarding/session-keys.md) |
| Understand gas sponsorship | [Sponsored Transactions](onboarding/sponsored-transactions.md), [Paymaster](infra/paymaster/overview.md) |
| Use the SDK | [SDK](sdk/reference.md) |
| Look up an address | [Address Map](contracts/address-map.md), [Deployed Contracts](contracts/deployed-contracts.md), [The Multicall3 Trap](contracts/multicall3.md) |
| Deploy and verify a contract | [Deploy & Verify a Contract](contracts/deployment.md) |
| Copy a pattern | [Recipes](recipes/read-a-contract.md) |
| Look up an env var or error | [Environment Variables](reference/env-vars.md), [Error Reference](reference/errors.md) |
| Fix a problem | [Troubleshooting](troubleshooting.md) |

The full navigation is in [`SUMMARY.md`](SUMMARY.md). Machine-readable index: [`llms.txt`](llms.txt).

## Hosted bundler and paymaster

The hosted endpoints are live and proven: bundler `https://bundler.pepeunchained.com` and paymaster service `https://paymaster.pepeunchained.com`. They are the SDK defaults; `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` override them. The ERC-7677 URL always embeds a token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`). The v2 paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. Operators who want to run their own can use the source in [`services/bundler`](../services/bundler) and [`services/paymaster`](../services/paymaster).

## Maintainer notes

This folder syncs to GitBook through bi-directional Git Sync: merging Markdown to the synced branch publishes it, and edits made in GitBook's editor are committed back here.

- **`SUMMARY.md` is load-bearing.** GitBook builds the table of contents from it, so add every new page there in the same change that adds the file.
- **`llms.txt` and `llms-full.txt`** follow the llmstxt.org format and are generated by `node scripts/gen-docs.mjs` (CI runs it with `--check`). They assume each page's published URL mirrors its path here. The same script generates `reference/errors.md`, `reference/endpoints.md` and `sdk/errors.md`; do not edit those by hand. `node scripts/check-docs-parity.mjs` keeps counts, names and addresses on the pages equal to the code.
- **Voice.** Plain, sober, friction-focused. No hype words, no emoji. Never state a feature as available if it is not live; say plainly that it is in progress. The test for every page: does it make it easier to build or to use?
- **Facts that change often.** Re-check before repeating as current: hosted endpoint status (live), the v2 paymaster canary (external audit pending), Privy behavior (allowed-origin port rule, `eoaOnly`, server-side `eth_sendTransaction` not supporting chain 97741), Multicall3 (deployed at a PEPU-specific address, never the canonical one), Permit2 (canonical address), and testnet `97740` (out of scope for development).
- **Flip these together** when the hosted endpoint status changes: [`onboarding/sponsored-transactions.md`](onboarding/sponsored-transactions.md), [`onboarding/smart-accounts.md`](onboarding/smart-accounts.md), [`onboarding/privy-embedded-wallets.md`](onboarding/privy-embedded-wallets.md), [`onboarding/privy-setup.md`](onboarding/privy-setup.md), [`get-started/introduction.md`](get-started/introduction.md), [`contracts/deployed-contracts.md`](contracts/deployed-contracts.md), [`troubleshooting.md`](troubleshooting.md) and `llms.txt`.
- **Not written yet, deliberately:** a Stylus page, a grants and ecosystem section, and Remix or thirdweb deep-dives. Add them to `SUMMARY.md` only when they exist.
- **Writing pages.** Read [`CONTRIBUTING-DOCS.md`](CONTRIBUTING-DOCS.md) first. No page should contain a stub marker; `check-docs-parity.mjs` fails on one.
