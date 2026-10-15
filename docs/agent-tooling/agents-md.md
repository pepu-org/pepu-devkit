# AGENTS.md and CLAUDE.md in Templates

Every app scaffolded from a PEPU template carries an agent kit: instructions and editor configs that point a coding agent at the SDK and the MCP server. This page lists what is in the kit, which part of `AGENTS.md` is hand-written and which is generated, and how the kit is kept in sync. Read it if you work with an agent inside a scaffolded app, or if you maintain a template.

> Status: built and tested. `templates/scripts/check-agent-kit.mjs` fails when any template drifts from the shared kit. The plugin route for Claude Code is recommended. Templates no longer ship a `.mcp.json`.

## Prerequisites

- An app from [create-pepu-app](../cli/create-pepu-app.md). Pass `--skip-agent-files` to leave the kit out.
- An agent client that reads `AGENTS.md` (Cursor, VS Code Copilot and others) or `CLAUDE.md` (Claude Code).

## What is in the kit

| File | Who reads it | What it does |
|---|---|---|
| `AGENTS.md` | Most agents | The template's instructions: how to build and run, which SDK functions the template uses, design rules, plus the generated "PEPU dev kit: agent wiring" block. |
| `CLAUDE.md` | Claude Code | One line, `@AGENTS.md`, which imports `AGENTS.md` so both agents read the same text. |
| `.cursor/mcp.json` | Cursor | Declares the `pepu` MCP server under the `mcpServers` key, with `"type": "stdio"`. |
| `.vscode/mcp.json` | VS Code | Declares the `pepu` MCP server under the top-level key `servers`, with `"type": "stdio"`. |
| `.claude/settings.json` | Claude Code | Declares the `pepu` marketplace from `pepu-org/pepu-devkit` and enables `pepu-devkit@pepu`, so Claude Code offers the plugin when you open the project. |

The editor configs all run the same command, `npx -y @pepu-chain/mcp`. See [Install per Client](../mcp/install.md) for the exact shapes and the environment variables.

`.claude/settings.json` carries exactly this:

```json
{
  "extraKnownMarketplaces": {
    "pepu": { "source": { "source": "github", "repo": "pepu-org/pepu-devkit" } }
  },
  "enabledPlugins": { "pepu-devkit@pepu": true }
}
```

What the plugin then gives you is described in [Claude Code Plugin](plugin.md). You still see Claude Code's trust prompt.

## Per-template section versus generated block

`AGENTS.md` has two parts.

1. **Per-template section (hand-written, above the markers).** Build and run commands, the table of SDK functions the template uses and where, the template's own rules (for example, game-app keeps `tap()` non-payable and never grants an unscoped signer; sponsored-demo never labels a send gasless unless a paymaster paid it), the design notes and what the template deliberately does not do. Edit this freely.
2. **Generated block (between the markers).** Everything between `<!-- BEGIN:pepu-agent-kit -->` and `<!-- END:pepu-agent-kit -->` is generated. Do not edit it by hand: the next sync overwrites it and the check fails.

The generated block says:

| Section | Content |
|---|---|
| Header | Template name, title and features (login, session, sponsor). "Use the kit; do not hand-roll what it already provides." |
| Chain facts | Chain `97741`, mainnet only, no testnet switch. RPC, pepuscan, native token PEPU with 18 decimals. Multicall3 at the PEPU-specific `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, never the canonical address. Get everything from the SDK (`pepuMainnet`, `explorerLinks`, `getPepuAddresses`). |
| Use the SDK | The SDK subpaths this template should import from, chosen by its features, then a table of every subpath and what it is for. |
| Use the MCP tools | The `pepu` server, the 32 tools grouped by purpose, the 6 prompts and the resources. `pepu_chain_info` is called first. |
| Skills and the plugin | The plugin install commands (`/plugin marketplace add pepu-org/pepu-devkit`, `/plugin install pepu-devkit@pepu`). |
| Environment | The template's required and optional env vars, its Privy dashboard settings and extra steps, and `npm run doctor`. |
| Never print secrets | Do not print, log, echo, commit or paste `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, any private key or credential-bearing URL. Do not read `.env*` into the conversation: use `npm run doctor`, which prints no values. Only `NEXT_PUBLIC_*` values are safe to show. |

The per-template values come from `packages/create-pepu-app/src/templates.json` (name, title, features, env, Privy dashboard ids, extra steps).

## Sync and check scripts

The shared source is `templates/_agent`: the editor configs, `.claude/settings.json`, `CLAUDE.md` and `AGENTS.base.md` (the generated block's template).

```bash
# After editing anything in templates/_agent or templates.json:
node templates/scripts/sync-agent-kit.mjs     # copies the verbatim files, renders the block into every template's AGENTS.md
node templates/scripts/check-agent-kit.mjs    # fails (exit 1) on any drift
```

`check-agent-kit.mjs` fails when a kit file is missing or does not parse, a kit file differs from `templates/_agent`, the generated block in a template's `AGENTS.md` is missing or stale, or a template lacks the `doctor` npm script or `scripts/doctor.mjs`.

The design system has the same pattern (`sync-design.mjs` and `check-design.mjs`). See `templates/BRAND.md`.

## What to expect

- The agent knows to call `pepu_chain_info` first, to use SDK functions, and to run `npm run doctor` instead of reading `.env.local`.
- With `--skip-agent-files`, none of these files are in the app and the agent has only what you give it.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `check-agent-kit.mjs` reports a stale block | Someone edited the generated block, or `templates.json` or `_agent` changed | Run `node templates/scripts/sync-agent-kit.mjs`, and make hand edits above the markers only. |
| VS Code ignores the MCP config | The file uses `mcpServers` instead of `servers` | Use the shape in `.vscode/mcp.json` shown in [Install per Client](../mcp/install.md). |
| Claude Code does not offer the plugin | The folder is not trusted, or `.claude/settings.json` was removed | Trust the folder, or install by hand with the two `/plugin` commands. |
| The agent reads `.env.local` | It ignored the rules | Point it at the "Never print secrets" section and run `npm run doctor` yourself. |

## Related

- [Claude Code Plugin](plugin.md)
- [Skills Catalog](skills.md)
- [Install per Client](../mcp/install.md)
- [create-pepu-app CLI](../cli/create-pepu-app.md)
- [Template Gallery](../templates/index.md)
