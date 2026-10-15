# Agent Tooling: MCP Server and Skills

This is the hub for the PEPU agent tooling: infrastructure that helps coding agents (Claude Code, Cursor, VS Code and similar) build on Pepe Unchained and get PEPU's specific facts right. It is not a claim that PEPU is "an AI chain". It is not one. AI is a feature builders add to their own products. This tooling exists so an agent, or a person using one, does not guess a chain ID, invent an address or use the canonical Multicall3 address that has no code here (see [The Multicall3 Trap](../contracts/multicall3.md)).

> Status: built and tested. The MCP server, 12 skills, 6 plugin commands and the builder subagent all exist on main. The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`) are live and are the defaults; sponsorship needs a project token in the paymaster URL (`PEPU_PAYMASTER_URL`). The v2 paymaster is Proven on mainnet as a canary (external audit pending).

## The pieces

| Piece | What it is | Page |
|---|---|---|
| `pepu` MCP server | `@pepu-chain/mcp`: 32 tools, 6 prompts and 5 resources for chain facts, probes, explainers, scaffolding, env and Privy checks, session policies and SDK snippets | [MCP Server Overview](../mcp/index.md), [Install per Client](../mcp/install.md), [Tool Reference](../mcp/tools.md) |
| Skills | 12 `SKILL.md` playbooks, each built on `@pepu-chain/sdk` and the MCP tools | [Skills Catalog](skills.md) |
| Claude Code plugin | `pepu-devkit`: the MCP server, the 12 skills, 6 slash commands and the `pepu-builder` subagent in one install | [Claude Code Plugin](plugin.md) |
| Template agent kit | `AGENTS.md`, `CLAUDE.md` and editor configs shipped in every scaffolded app | [AGENTS.md and CLAUDE.md in Templates](agents-md.md) |

## Quick start

In Claude Code, install the plugin (recommended):

```text
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

Or add only the MCP server with `claude mcp add pepu -- npx -y @pepu-chain/mcp`. Cursor, VS Code and other clients are covered in [Install per Client](../mcp/install.md).

## How they fit together

- The SDK (`@pepu-chain/sdk`) holds the functions. Skills and tools tell the agent to wire them, not to hand-roll infrastructure.
- The MCP server answers live questions: what is deployed, is sponsorship available, what does this error mean, which env var is missing.
- Skills carry the method: the order of steps, the dashboard settings, the safety rules and the pitfalls.
- Each skill tells the agent to call `pepu_chain_info` or the relevant probe first, so a fact that changed since the skill was written is caught by a live check.

The same line applies to everything here: it makes building on PEPU easier, or it does not belong.

## Related

- [Build with an AI Coding Agent in 3 Minutes](../get-started/ai-assisted.md)
- [create-pepu-app CLI](../cli/create-pepu-app.md)
- [SDK Overview and Reference](../sdk/reference.md)
