# Skills Catalog

The 12 PEPU skills: what each one does, when it triggers, the chain facts they all share, how they use the SDK and the MCP tools instead of hand-rolled code, and the rules for writing a new one. Read it to know which skill an agent will load, or before adding one.

> Status: built and tested. The skills ship in the `pepu-devkit` plugin and are also served by the MCP server as `pepu://skills/{name}`. The pillar skills describe flows that are Proven on mainnet; the paymaster v2 skill describes a contract that is Proven on mainnet as a canary (deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches).

## Prerequisites

- The skills are installed through the [Claude Code plugin](plugin.md), or read one on demand through the `pepu://skills/{name}` MCP resource.
- For method, not just text: the [MCP server](../mcp/index.md) connected, because every skill tells the agent to call its tools.

## The 12 skills

| Skill | What it does | Use it for |
|---|---|---|
| `pepu-build-dapp` | The entry point from zero to a running app. Scaffolds with `create-pepu-app` or the MCP tools `pepu_list_templates` and `pepu_scaffold_app`, picks the template by pillar, fills and checks env and Privy config, runs the app and hands off to the pillar skills. | Building, starting, scaffolding or extending a PEPU app. |
| `pepu-sdk` | A cheat sheet for `@pepu-chain/sdk`: the subpath map, "if you want X, import Y", which entries are server-only, client-only or ESM-only, and the rule against reimplementing what it ships. | Before writing any PEPU infrastructure code by hand, or to pick the right import. |
| `pepu-chain-setup` | Configures viem, wagmi, Hardhat and Foundry for chain `97741` with the SDK instead of a hand-written chain object. Carries the traps: PEPU-specific Multicall3, the huge-looking gas price, the 2,000-block `eth_getLogs` cap, no WebSocket RPC. | Adding PEPU to any project, setting up a client, batching reads. |
| `pepu-onboarding-privy` | Google (and email) login with a server-provisioned Privy embedded wallet, built from the SDK provider, `WalletGate`, `createEnsureWalletRoute` and `requireUser`. Gives the Privy dashboard fields and the troubleshooting for login hangs and a missing wallet. Pillar: Google to wallet. | Sign-in, wallets, protecting an API route by user. |
| `pepu-session-keys` | Privy session signers on a plain embedded wallet, so an app acts for the user with no popup per action. The scope is enforced off-chain by Privy and the user pays gas. Includes the three safety rules. Pillar: session keys. | "No wallet popup" actions with the user paying gas. |
| `pepu-sponsored-transactions` | Gasless transactions with a Kernel v3.1 smart account, an EntryPoint v0.7 bundler and an ERC-7677 paymaster. Covers both transports (Privy Smart Wallets or direct URLs). Sponsorship status is live-checked, never assumed. Pillar: sponsored transactions. | Gasless, paymaster, bundler or UserOperation work. |
| `pepu-sponsored-session` | The combination: Google login, one owner signature that grants an on-chain Kernel session key, then actions with no popup and no user gas. The scope is enforced on-chain. Includes the five routes and the production `SessionStore` warning. | The full flow, matching the `sponsored-session-app` template. |
| `pepu-smart-accounts` | Account mechanics: the two-address model (embedded EOA owner plus Kernel smart account), counterfactual addresses and when a smart account is the right choice. Deliberately slim. | Computing or inspecting a smart account, explaining owner versus smart account. |
| `pepu-paymaster-projects` | The v2 tiered model: claim a project keyed by Privy app id, deposit PEPU one-way, set targets and daily limits. Deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. Advise small deposits. | Preparing, reviewing or scripting the v2 workflow, and answering tier questions honestly. |
| `pepu-deploy-contract` | Deploys and verifies a Solidity contract on mainnet with Foundry (primary) or Hardhat. Detects the `foundry-zksync` binary shadowing `forge` before it produces a wrong deployment. | Deploying or verifying a contract on PEPU. |
| `pepu-token-and-nft` | Deploys and uses an ERC-20 or ERC-721 on PEPU, and explains what "getting listed" actually means: the PepuSwap list and the kit's own token list are separate and neither is automatic. | Creating a token or NFT collection, or interacting with one. |
| `pepu-debug-transaction` | Diagnoses a failed, stuck, denied or expensive transaction, UserOperation or Privy, paymaster or session error. Starts with `pepu_explain_tx`, `pepu_explain_error` and `pepu_known_gotchas`. | Reverts, transactions that never land, denied sponsored sends, session 409s. |

The three pillar skills (`pepu-onboarding-privy`, `pepu-session-keys`, `pepu-sponsored-transactions`) and their combination (`pepu-sponsored-session`) match the pillars in [The Three Pillars and How They Combine](../get-started/pillars.md).

## Shared chain facts

Every skill carries two shared files in its own `reference/` folder, so a skill is self-contained when installed alone:

- `reference/chain-facts.md` is generated from the built SDK (chains, endpoints, the contract registry). It states chain `97741`, mainnet only, the default RPC and explorer, the PEPU-specific Multicall3, the full registry table with deployed or pending status, the gas explanation, the endpoint-resolution order and a "where to look things up" table.
- `reference/rules.md` is hand-written: "use the SDK, call the MCP tools, never hand-roll". It holds the order of work, a table of what never to write by hand and the SDK function to use instead, the hard rules and the MCP tool contract.

The hard rules every skill repeats:

| Rule | Detail |
|---|---|
| Mainnet only | Chain `97741`. Do not add the testnet to a chain list. |
| Never print secrets | `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, paymaster URLs and session private keys. Report key names and presence only. |
| Sponsorship wording follows the live answer | Call `pepu_sponsorship_status` or `checkSponsorship()`. The hosted bundler and paymaster service are live and are the defaults, but the ERC-7677 URL needs a project token, so the app brings a project. |
| Say which session mode | Privy session mode is enforced off-chain and the user pays gas. Kernel session mode is enforced on-chain. |
| v2 is a canary | Never call the v2 paymaster audited. Deposits are one-way; advise small deposits. The v1 paymaster is retired: never deposit to it. |
| Never call a transaction free or gasless | Unless a paymaster actually paid it. |
| Always a scoped session policy | Never an empty `policyIds`. |
| No server-side `eth_sendTransaction` on 97741 | Privy rejects it. Sign with `eth_signTransaction` and broadcast; the SDK does this. |

## How skills use the SDK and MCP

A skill follows one pattern: ask the tools, wire the SDK, verify.

1. Ground the facts with `pepu_chain_info` or the matching probe (`pepu_sponsorship_status`, `pepu_check_contract_deployed`).
2. Take canonical code from `pepu_sdk_snippet` and confirm names with `pepu_sdk_exports`. Import from the documented subpaths only.
3. Check `pepu_check_env` and `pepu_check_privy_config` before debugging application code.
4. Verify with the project's typecheck and build, then prove the pillar works (sign in, grant, act, send).
5. On failure, `pepu_explain_error` with the exact text, then `pepu_known_gotchas`.

Each `SKILL.md` has the same sections: When to use, Chain facts, SDK functions to use, MCP tools to call first, Steps, Verify, Pitfalls and Never hand-roll (the pillar skills add their safety rules).

If the SDK lacks something, the skill says so, writes the smallest local code and marks it `// TODO(sdk): ...`.

## Authoring rules for a new skill

1. Create `skills/<name>/SKILL.md` with frontmatter `name` equal to the directory name and a non-empty `description` that says when to use it.
2. Use the uniform sections above, in that order.
3. Name only SDK functions that exist, and only MCP tools that are registered. Import paths must exist in the SDK exports map.
4. Do not copy chain facts into the skill. Link to `reference/chain-facts.md`, which is generated.
5. State Proven, Built, not deployed or Pending plainly, using the labels in the docs style guide.
6. Run the sync and the check:

```bash
pnpm --filter @pepu-chain/sdk build        # the scripts read the built SDK
node scripts/sync-skill-shared.mjs         # regenerate chain-facts.md and copy shared files into every skill
node scripts/check-plugin.mjs              # validate skills, commands, agents, tool names, SDK imports and counts
```

`check-plugin.mjs` fails if a skill's name does not match its directory, a named `pepu_*` tool is not registered, an imported SDK symbol is not exported, a count in the manifest descriptions is wrong, or the shared files are stale. `node scripts/sync-skill-shared.mjs --check` is the CI form of the sync.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The agent does not load a skill | The plugin is not installed or enabled | Install it ([Claude Code Plugin](plugin.md)), or ask the agent to read `pepu://skills/<name>`. |
| `check-plugin.mjs` reports stale shared files | The SDK registry changed | Rebuild the SDK and run `node scripts/sync-skill-shared.mjs`. |
| `check-plugin.mjs` reports an unknown tool or export | A skill names something that does not exist | Fix the name against `pepu_sdk_exports` or the tool registry. |

## Related

- [Claude Code Plugin](plugin.md)
- [MCP Server Overview](../mcp/index.md)
- [SDK Overview and Reference](../sdk/reference.md)
- [Agent Tooling hub](mcp-and-skills.md)
