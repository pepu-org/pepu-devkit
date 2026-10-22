# Claude Code Plugin

The `pepu-devkit` plugin bundles everything the kit gives a coding agent into one Claude Code install: the `pepu` MCP server, the 12 skills, 6 slash commands and the `pepu-builder` subagent. This page covers installing it, what each command does, what loads, and the trust prompt you will see.

Commands that touch sponsorship use the hosted bundler and paymaster service by default and need a project token for the paymaster URL (`PEPU_PAYMASTER_URL`). `scripts/check-plugin.mjs` checks the manifests, commands and subagent against the real MCP tools and SDK exports.

## Prerequisites

- Claude Code with plugin support.
- Node.js 18 or newer, because the plugin starts the MCP server with `npx`.
- Optional: `PEPU_RPC_URL`, `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` exported in your shell. The plugin forwards them to the server and uses an empty value when they are unset.

## Install

Plugin (recommended):

```text
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

The first command registers the marketplace named `pepu` from the GitHub repository `pepu-org/pepu-devkit`. The second installs the plugin `pepu-devkit` from it.

If you only want the MCP server, use the fallback instead: `claude mcp add pepu -- npx -y @pepu-chain/mcp`. See [Install per Client](../mcp/install.md).

Apps scaffolded with [create-pepu-app](../cli/create-pepu-app.md) carry a `.claude/settings.json` that declares the `pepu` marketplace and enables `pepu-devkit@pepu`, so Claude Code offers the plugin the first time you open the project. See [AGENTS.md and CLAUDE.md in Templates](agents-md.md).

## What loads

| Part | Count | Detail |
|---|---|---|
| MCP server `pepu` | 1 server, 33 tools, 6 prompts, 5 resources | Started with `npx -y @pepu-chain/mcp@^0.2`. Environment: `PEPU_RPC_URL`, `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`. See [Tool Reference](../mcp/tools.md). |
| Skills | 12 | Listed in the [Skills Catalog](skills.md). |
| Commands | 6 | Below. |
| Subagent | 1 | `pepu-builder`, below. |

Inside Claude Code, the plugin's MCP tools are named `mcp__plugin_pepu-devkit_pepu__<tool>`, for example `mcp__plugin_pepu-devkit_pepu__pepu_chain_info`. Each command and the subagent list exactly the tools they may call.

## The trust prompt

A plugin runs code and can start a server on your machine, so Claude Code asks before it enables one. Expect:

1. A prompt to trust the marketplace or the folder when you add it, and to confirm the plugin install.
2. An approval for the plugin's MCP server the first time it starts. It runs `npx` with the package above.
3. Permission prompts for tool calls according to your normal rules. Read-only tools are annotated as such. The two write tools, `pepu_scaffold_app` and `pepu_generate_authorization_key`, are the ones that ask first.

Read the manifest before you trust it: it is `.claude-plugin/plugin.json` in the repository. Exact prompt wording belongs to Claude Code and can change.

## Commands

All six commands call the SDK through the MCP snippets. None hand-writes chain, Privy, session or sponsorship code.

| Command | Argument | What it does |
|---|---|---|
| `/pepu-new-app` | `[app name or idea]` | Lists templates, picks one by pillar and says why (default `consumer-app`), scaffolds to an absolute directory with `pepu_scaffold_app` (or the CLI with `--yes --no-install --no-git --json`), installs, runs `pepu_check_env` and `pepu_check_privy_config`, reports sponsorship status for sponsorship templates, then typechecks and builds. Follows the `pepu-build-dapp` skill. |
| `/pepu-add-login` | `[login methods, default google and email]` | Adds Google login and a Privy embedded wallet to the current Next.js app: `PepuPrivyProvider` or `PepuPrivyWagmiProvider` with `WalletGate`, and `createEnsureWalletRoute()`. Adds env placeholders, checks the dashboard (allowed origin with port, Google on, embedded wallets on). Follows `pepu-onboarding-privy`. |
| `/pepu-add-session` | `<contract address> <function signatures, e.g. tap()>` | Adds Privy session keys: builds the policy with `pepu_session_policy` (Privy mode), generates the authorization key with `pepu_generate_authorization_key` and asks you to register the public key and paste the quorum id, then applies the session routes and hooks. The consent screen says the user pays gas. Follows `pepu-session-keys`. |
| `/pepu-add-sponsorship` | `[transport: privy-smart-wallets or direct]` | Runs `pepu_sponsorship_status` first and reports the answer exactly, then wires `useSponsoredSend` or `useDirectSponsoredSend` (browser) or `sendSponsored` (server). Prefers the Privy Smart Wallets transport for browser code because a paymaster URL embeds a credential. Only says a send was sponsored when `result.paymaster` is set. Follows `pepu-sponsored-transactions`. |
| `/pepu-add-sponsored-session` | `<contract address> <function signatures>` | Adds the combination: Kernel scope from `pepu_session_policy`, `createSponsoredSessionRoutes` with its five route files and a `useSponsoredSession` component. Warns that `createMemoryStore()` is dev only and sizes spend caps above the gas reservation. For a new project prefer `/pepu-new-app` with `sponsored-session-app`. Follows `pepu-sponsored-session`. |
| `/pepu-doctor` | `[template name, optional]` | Readiness check: `pepu_check_env`, `npm run doctor` if defined, `pepu_check_privy_config`, `pepu_sponsorship_status` for sponsorship templates and `pepu_health_check`. Ends with a table of check, status and fix, applies the fixes it can, and lists exactly what only you can do. Never reads secret values. |

## The pepu-builder subagent

`pepu-builder` builds and extends PEPU apps end to end and asks you only for what only you have. Claude Code delegates to it for any task that creates or changes a PEPU app, a contract deployment or a PEPU chain integration.

How it works:

1. Scaffold first, never from a blank folder.
2. Ask the tools, not memory: `pepu_chain_info`, `pepu_sponsorship_status`, `pepu_check_env`, `pepu_check_privy_config`, `pepu_sdk_snippet`, `pepu_sdk_exports`.
3. Load the matching skill and obey its never-hand-roll list.
4. Verify before saying done: env check, Privy check, typecheck, build, then confirm the pillar works.
5. On failure, `pepu_explain_error` with the exact text, then `pepu_known_gotchas`.

What only you can do, and it will name each precisely: paste the Privy App ID and App Secret, register the authorization public key in the Privy dashboard, add the allowed origin, supply bundler and paymaster URLs, and fund wallets.

It never prints, logs or commits secrets, never calls a transaction free unless a paymaster paid it, and says which session mode it built. It finishes with a report of what it built, which SDK functions it uses, what was checked and what you still have to do. Its tools are Claude Code's file and shell tools (Read, Write, Edit, Glob, Grep, Bash) plus an explicit allow-list of all 33 PEPU MCP tools that includes both write tools. The list is in `agents/pepu-builder.md`.

## Versions and checks

The plugin version, the marketplace version and the MCP server's declared range move together. From a checkout:

```bash
node scripts/check-versions.mjs   # plugin.json, marketplace.json and packages/mcp/server.json in lock-step; prints SDK, MCP, CLI and plugin versions
node scripts/check-plugin.mjs     # validates skills, commands, agents, tool names, SDK imports and manifest counts
```

`check-plugin.mjs --write` regenerates the counts in the manifest descriptions.

## What to expect

- After install, `/mcp` shows the plugin's `pepu` server, and the six commands appear when you type `/pepu`.
- Without a project token for the paymaster URL, the sponsorship commands still set up the code and leave `PEPU_PAYMASTER_URL` as a marked placeholder (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`; the bundler defaults to the hosted one). They do not claim sponsorship works.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `/plugin marketplace add` fails | No network, or the repository is not reachable | Check access to `github.com/pepu-org/pepu-devkit`, or use the `claude mcp add` fallback. |
| The MCP server does not start | Node older than 18 or `npx` not on PATH | Install Node 18+. |
| Sponsorship tools say "not configured" | The environment cleared a default, or the paymaster URL has no project token | Export `PEPU_PAYMASTER_URL` (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`) and, for your own bundler, `PEPU_BUNDLER_URL` before launching Claude Code. |
| A command asks for something and stops | It needs a value only you have | Provide the Privy App ID or secret, or complete the named dashboard step, then continue. |

## Related

- [Skills Catalog](skills.md)
- [AGENTS.md and CLAUDE.md in Templates](agents-md.md)
- [Install per Client](../mcp/install.md)
- [Build with an AI Coding Agent in 3 Minutes](../get-started/ai-assisted.md)
