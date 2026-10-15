# Pepe Unchained (PEPU) Developer Kit

Everything a builder needs to ship a consumer app on **Pepe Unchained V2**: an Arbitrum Orbit / Nitro chain, chain ID `97741`, native token PEPU. A project scaffolder, six starter templates, an SDK, an MCP server and Claude Code skills, all checked against the live chain rather than copied from elsewhere.

- RPC: `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`
- Explorer: [pepuscan.com](https://pepuscan.com)
- Docs: [guide.pepeunchained.com](https://guide.pepeunchained.com)
- Live demo: [roadmap-demo.pepeunchained.com](https://roadmap-demo.pepeunchained.com) (the `sponsored-session-app` template, deploying now)

You do not need to clone this repository to use the kit. Everything installs from npm.

## Quickstart

```bash
npx create-pepu-app@latest my-app      # pick a template; add --template sponsored-session-app for gasless
cd my-app
# set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET in .env.local
npm run doctor                         # checks env, RPC, bundler, paymaster and your Privy dashboard
npm run dev                            # http://localhost:3000
```

Before you run it, do the Privy dashboard clicks: login fails unless your Privy Dashboard allows the exact origin including the port and has embedded wallets on ([Dashboard Settings](docs/privy/dashboard-settings.md)). The two sponsored templates also need a paymaster project of yours ([how to get one](docs/infra/paymaster/v2-register-deposit-claim.md)). Full walkthrough: [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](docs/get-started/quickstart-app.md). With Claude Code: install the plugin (below) and run `/pepu-new-app`.

New to smart accounts? Read [Smart Account Paths](docs/concepts/smart-account-paths.md): it says which template to start from.

## What is in the kit

### Six templates

Scaffolded by `create-pepu-app` (`--template <name>`). All are Next.js (App Router, TypeScript) with Privy login, wagmi, viem and PEPU branding.

| Template | What it shows |
| --- | --- |
| `consumer-app` (default) | Email, Google or wallet sign-in, an embedded wallet, and a real PEPU send. |
| `token-gated-app` | Unlock content by holding an ERC-20 or NFT, with balance checks batched through PEPU's Multicall3. |
| `nft-mint` | An ERC-721 mint page plus the Foundry and Hardhat contract. |
| `game-app` | A tap-to-score game using Privy session signers: grant once, then play with no popup per move. |
| `sponsored-demo` | A zero-balance smart account sending a gas-sponsored transaction. Uses the hosted bundler by default; the paymaster URL needs your project token (`PEPU_PAYMASTER_URL`, in the Privy dashboard for this template). |
| `sponsored-session-app` | Sign in with Google, grant one scoped on-chain session, then act with no popup and no gas from the user. A ZeroDev Kernel session key (enforced on-chain) plus the PEPU paymaster. Proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster. Uses the hosted bundler by default; `PEPU_PAYMASTER_URL` needs your project server key. |

Which one? Users pay gas, plain wallet: `consumer-app`. No popup and no user gas, limits enforced on-chain: `sponsored-session-app` (ZeroDev-native). One gasless button in a client-only app: `sponsored-demo` (Privy Smart Wallets). The comparison is in [Smart Account Paths](docs/concepts/smart-account-paths.md).

### SDK: `@pepu-chain/sdk`

```bash
npm i @pepu-chain/sdk viem
```

```ts
import { pepuMainnet, getPublicClient } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);
const balance = await client.getBalance({ address: "0x..." });
```

Chain definitions, contract and DEX registries, verified ABIs, gas and fee helpers, explorer helpers, an account-abstraction surface, a token list and optional React hooks. It extends viem and does not wrap it. Reference: [`docs/sdk/reference.md`](docs/sdk/reference.md).

### MCP server: `@pepu-chain/mcp`

```bash
npx -y @pepu-chain/mcp
```

32 tools (30 read-only, 2 that write files) that give a coding agent PEPU's real facts and let it build: chain info and known gotchas, pepuscan lookups, RPC reads, gas estimation, revert decoding, sponsorship probes, error explanation, scaffolding, env and Privy checks, session policies and SDK snippets, plus 6 prompts and 5 resources. Add it to any MCP client:

```json
{ "mcpServers": { "pepu": { "command": "npx", "args": ["-y", "@pepu-chain/mcp"] } } }
```

Reference: [`docs/agent-tooling/mcp-and-skills.md`](docs/agent-tooling/mcp-and-skills.md).

### Claude Code plugin and skills

```text
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

Installs the MCP server, 12 skills and 6 slash commands: chain setup, contract deploy and verify, tokens and NFTs, Privy onboarding, session keys, sponsored transactions, the sponsored session, paymaster projects, smart accounts, transaction debugging, SDK use and end-to-end app building. Sources are in [`skills/`](skills).

## Status

| | |
|---|---|
| Google login and embedded wallets (Privy) | Live. |
| Session signers for popup-free play | Live. Privy signs, the app broadcasts, because Privy's server-side `eth_sendTransaction` does not support chain 97741. |
| Distribution | `@pepu-chain/sdk` and `@pepu-chain/mcp` are on npm (`npm i @pepu-chain/sdk viem`, `npx -y @pepu-chain/mcp`). `create-pepu-app` 0.1.3 is on npm too (`npx create-pepu-app@latest my-app`). It scaffolds from the published SDK (`@pepu-chain/sdk` 0.2.2), with a vendored copy as the offline fallback. Current versions: SDK 0.2.2, MCP 0.2.5, `create-pepu-app` 0.1.3, Claude Code plugin 0.4.1. |
| Gas sponsorship | **Live and proven** through the hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`): a project-sponsored operation from a fresh 0-PEPU Kernel account ran on mainnet on the v2 paymaster (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`). The ERC-7677 URL needs a token: `https://paymaster.pepeunchained.com/v2/paymaster/<token>` (a project client token from its allowed origins, a project server key on a backend, or, for PEPU's own Privy app, the free tier with a Privy token in the ERC-7677 context). You can still run your own from [`services/bundler`](services/bundler) and [`services/paymaster`](services/paymaster). |
| The combination (Google login, on-chain session key and gas sponsorship together) | Proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster (`sponsored-session-app`: Google sign-in, one Privy signature, sponsored taps with no popup, revoke), and by script (`pnpm --filter @pepu-chain/sdk prove-session`). It needs a paymaster URL with your project's server key. See [`docs/onboarding/sponsored-session.md`](docs/onboarding/sponsored-session.md). |
| Tiered sponsorship v2 (free tier plus on-chain project deposits) | **Deployed on mainnet as a canary** at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`: internally reviewed 3 times, external audit pending, funded in small tranches. Free tier: 100 PEPU/day and 50 PEPU/hour per Privy user of PEPU's own app, TapScore only for now. The v1 paymaster is retired (deposit withdrawn). See [`docs/onboarding/sponsorship-tiers.md`](docs/onboarding/sponsorship-tiers.md). |

Contract addresses (PEPU-specific Multicall3, Permit2, EntryPoint, Kernel factory, paymaster) are in [`docs/contracts/deployed-contracts.md`](docs/contracts/deployed-contracts.md). The testnet (`97740`) has no faucet or indexed explorer, so everything targets mainnet, where a transaction costs a fraction of a cent.

## Documentation

- [Introduction](docs/get-started/introduction.md) and [Network Reference](docs/get-started/network-reference.md)
- [Quickstart](docs/get-started/quickstart-app.md)
- [Smart Account Paths](docs/concepts/smart-account-paths.md): plain wallet, ZeroDev-native or Privy Smart Wallets, and which template to start from
- [Privy Setup](docs/onboarding/privy-setup.md), [Session Keys](docs/onboarding/session-keys.md), [Sponsored Transactions](docs/onboarding/sponsored-transactions.md)
- [Deploy & Verify a Contract](docs/contracts/deployment.md) and [The Multicall3 Trap](docs/contracts/multicall3.md)
- [Recipes](docs/recipes/read-a-contract.md), [Troubleshooting](docs/troubleshooting.md), [`llms.txt`](docs/llms.txt)

## Repository layout

| Path | What it is |
| --- | --- |
| [`packages/sdk`](packages/sdk), [`packages/mcp`](packages/mcp), [`packages/create-pepu-app`](packages/create-pepu-app) | The three npm packages. |
| [`templates/`](templates) | The six starter templates. |
| [`skills/`](skills) and [`.claude-plugin/`](.claude-plugin) | The Claude Code plugin and its skills. |
| [`docs/`](docs) | The developer documentation. |
| [`services/bundler`](services/bundler), [`services/paymaster`](services/paymaster) | Operator source: the Alto ERC-4337 bundler config, the verifying paymaster, the policy service. |
| [`contracts/`](contracts), [`deploy/`](deploy) | Foundry projects and deploy scripts for the PEPU-specific Multicall3 and canonical Permit2. |

## Contributing

A pnpm workspace (`pnpm@11.25.0`, Node >= 18.17). Build order matters because `create-pepu-app` vendors the SDK build:

```bash
pnpm install
pnpm --filter @pepu-chain/sdk build
pnpm --filter @pepu-chain/mcp build
pnpm --filter create-pepu-app build
pnpm -r typecheck
pnpm -r --workspace-concurrency=1 test
node templates/scripts/check-design.mjs
node scripts/check-links.mjs
```

The policy service under `services/paymaster/policy-service` is a standalone package; run its tests with `npm test` from that directory. See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`RELEASING.md`](RELEASING.md) and [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
