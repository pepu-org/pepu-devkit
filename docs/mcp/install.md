# Install the MCP Server per Client

Exact configuration for each supported client, the environment variables the server reads, and how to confirm the connection. Use this page when you want the `pepu` tools in your editor or agent.

> Status: built and tested. `@pepu-chain/mcp` runs over stdio from npm with no clone and no build. It needs no API key.

## Prerequisites

- Node.js 18 or newer. The server runs as `npx -y @pepu-chain/mcp`.
- A client that supports MCP over stdio.
- Optional: the three environment variables below. The server works without any of them.

## Environment variables the server reads

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `PEPU_RPC_URL` | every RPC-backed tool (through the SDK's `resolvePepuEndpoints`) | public Conduit RPC for chain `97741` | Use an authenticated endpoint here. A malformed value falls back to the public default. Mainnet only: the testnet RPC is fixed. |
| `PEPU_BUNDLER_URL` | `pepu_bundler_health`, `pepu_sponsorship_status`, `pepu_health_check`, `pepu_explain_tx` (UserOperation hashes) | `https://bundler.pepeunchained.com` | The hosted bundler. Local default for your own service is `http://localhost:4337`. |
| `PEPU_PAYMASTER_URL` | `pepu_paymaster_health`, `pepu_sponsorship_status`, `pepu_health_check` | `https://paymaster.pepeunchained.com` (service base) | The probes target the hosted paymaster service base. Set this to a full ERC-7677 URL (`.../v2/paymaster/<token>`) to probe a project URL; local default for your own service is `http://localhost:8788`. May embed a credential, so it is only ever reported as a host. |

One more variable exists for development of the server itself, not for normal use: `PEPU_CREATE_APP_BIN` points `pepu_scaffold_app` at a local build of the create-pepu-app CLI. See [Environment Variables](../reference/env-vars.md) for the full list across the kit.

## Claude Code

Plugin (recommended). The plugin wires the MCP server for you and adds the skills, the six slash commands and the builder subagent:

```text
/plugin marketplace add pepu-org/pepu-devkit
/plugin install pepu-devkit@pepu
```

Claude Code asks you to trust the plugin before it loads. The plugin passes `PEPU_RPC_URL`, `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` from your shell environment to the server (empty when unset). See [Claude Code Plugin](../agent-tooling/plugin.md).

Fallback, MCP server only:

```bash
claude mcp add pepu -- npx -y @pepu-chain/mcp
```

To pass environment variables with the fallback:

```bash
claude mcp add pepu -e PEPU_RPC_URL=https://<your-rpc> -- npx -y @pepu-chain/mcp
```

Scaffolded apps from [create-pepu-app](../cli/create-pepu-app.md) also offer the plugin on first open through `.claude/settings.json`. See [AGENTS.md and CLAUDE.md in Templates](../agent-tooling/agents-md.md).

## Cursor

Create `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "pepu": {
      "command": "npx",
      "args": ["-y", "@pepu-chain/mcp"]
    }
  }
}
```

Reload Cursor, then enable `pepu` under Settings, MCP.

## VS Code

Create `.vscode/mcp.json` in the workspace. VS Code uses a top-level key named `servers`, not `mcpServers`:

```json
{
  "servers": {
    "pepu": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@pepu-chain/mcp"]
    }
  }
}
```

Open the file in VS Code and use the Start action above the server entry, then use the tools in Copilot agent mode.

## Windsurf, Claude Desktop, Cline and other clients

Any client that launches a stdio MCP server accepts the same command. The usual shape is a JSON file with an `mcpServers` map:

```json
{
  "mcpServers": {
    "pepu": {
      "command": "npx",
      "args": ["-y", "@pepu-chain/mcp"]
    }
  }
}
```

| Client | Where the config lives |
|---|---|
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Claude Desktop | `claude_desktop_config.json` (Settings, Developer, Edit Config) |
| Cline | The MCP servers panel, "Configure MCP Servers" (`cline_mcp_settings.json`) |
| Anything else | Generic stdio: command `npx`, arguments `-y @pepu-chain/mcp`, no environment variables required |

Config file locations and menu names belong to the clients and can change. If one does not match, the command and arguments above are the part that matters.

To pass environment variables, add an `env` object next to `args`:

```json
{
  "mcpServers": {
    "pepu": {
      "command": "npx",
      "args": ["-y", "@pepu-chain/mcp"],
      "env": { "PEPU_RPC_URL": "https://<your-rpc>" }
    }
  }
}
```

For a global install or local development, replace the command:

```bash
npm install -g @pepu-chain/mcp          # then command: pepu-mcp
```

```json
{ "command": "node", "args": ["/absolute/path/to/packages/mcp/dist/index.js"] }
```

## Verifying the connection

1. Ask your agent: "List the tools from the pepu MCP server." You should see 32 tools whose names start with `pepu_`.
2. Ask it to call `pepu_health_check`. A healthy answer reports the mainnet RPC reachable at chain id `97741` and pepuscan reachable.
3. Ask it to call `pepu_chain_info`. It returns the verified network facts and contract table.
4. In Claude Code, `/mcp` lists the server and its connection state.

From a checkout of the repository you can also list every tool, resource and prompt over stdio with `pnpm smoke` in `packages/mcp` (run `pnpm build` first). It makes real network calls.

## What to expect

- The first launch downloads the package through `npx`, which takes a few seconds. Later launches use the cache.
- Pin a version if you need reproducibility: `npx -y @pepu-chain/mcp@0.2.5`. The plugin pins `@pepu-chain/mcp@^0.2`.
- No tool needs a private key. The server never holds one.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The client shows the server as failed or never connects | Node.js older than 18, or `npx` not on the client's PATH | Install Node 18+, and on Windows try the `npx.cmd` command or an absolute path to `node`. |
| Tools are missing in VS Code | The config uses `mcpServers` instead of `servers`, or lacks `"type": "stdio"` | Use the VS Code shape shown above. |
| `pepu_bundler_health` says "not configured" | The default was cleared or `PEPU_BUNDLER_URL` is empty in the server's environment | Set it in the client's `env` block, or in your shell before launching the client. |
| Env vars set in your shell are ignored | The client does not pass its environment to child processes | Put the variables in the client's `env` block. |
| Stale facts or docs | An old cached package version | Run `npx -y @pepu-chain/mcp@latest`, or clear the npx cache. |

## Related

- [MCP Server Overview](index.md)
- [Tool Reference](tools.md)
- [Claude Code Plugin](../agent-tooling/plugin.md)
- [Build with an AI Coding Agent in 3 Minutes](../get-started/ai-assisted.md)
