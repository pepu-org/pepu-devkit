# MCP Server Overview

`@pepu-chain/mcp` is a Model Context Protocol server that gives a coding agent a way to check PEPU-specific facts and run PEPU-specific checks instead of guessing. It has 33 tools, 6 prompts and 5 resources. This page explains what it is for, what it will and will not do, and where the details live.

The sponsorship probes target the hosted bundler and paymaster service by default. The v2 paymaster tools default to the registry's deployed paymaster.

## What and why

Coding agents are strong at generic EVM patterns and weak at chain-specific facts. A wrong chain ID, an invented contract address, or the canonical Multicall3 address (which has no code on PEPU) are all failures an agent can produce with confidence. See [The Multicall3 Trap](../contracts/multicall3.md).

The server answers those questions from the source of truth:

- Addresses, chain facts and endpoints come from `@pepu-chain/sdk` (`getPepuAddresses`, `pepuMainnet`, `resolvePepuEndpoints`).
- Failures are explained from the SDK's shared error catalog (`explainError`).
- Env and Privy checks use the SDK's doctor (`checkPepuEnv`, `checkPrivyDashboardConfig`).
- Generated code comes from export-checked SDK snippets, so an agent wires the SDK instead of hand-rolling infrastructure.

It is not a generic Blockscout wrapper. pepuscan is a Blockscout instance, and the official Blockscout MCP server covers generic chain-data lookups well. This server adds only what is PEPU-specific or what composes several RPC and Blockscout calls into one answer. PEPU is a chain, not "an AI chain": this is tooling that helps builders, human or agent-assisted, get PEPU facts right.

## What it contains

| Part | Count | Page |
|---|---|---|
| Tools | 33 | [Tool Reference](tools.md) |
| Prompts | 6 | [Resources and Prompts](resources-and-prompts.md) |
| Resources | 5 (`pepu://chain-facts`, `pepu://addresses`, `pepu://docs/{slug}`, `pepu://skills/{name}`, `pepu://sdk/exports`) | [Resources and Prompts](resources-and-prompts.md) |

## Security model

- **No tool returns a secret.** `pepu_check_env` reports presence and length only. A secret-leak test in the package checks tool outputs for leaks. URLs that may carry a credential, such as the paymaster URL, are reduced to their host.
- **No private key, ever.** The server holds no key and has no tool that signs or sends a transaction. `pepu_prepare_project_tx` and `pepu_encode_calls` return unsigned data. There is no `pepu_send_transaction` tool, by design.
- **Local execution.** The server runs on your machine over stdio, started by your client. It talks to the public PEPU RPC, pepuscan's public API and, if you configure them, your bundler and paymaster. Docs, skills, template metadata and the SDK export list are bundled into the package, so those lookups make no network call.
- **File access is narrow.** Only two tools touch your filesystem, and both take absolute paths only, refuse `..`, filesystem roots and system folders, and refuse to overwrite. `pepu_generate_authorization_key` writes only `.env*` files and never returns the private key.
- **Annotations on every tool.** All four MCP hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set, so a client can auto-approve reads and ask before writes.
- **Mainnet only.** Chain `97741`. Some tools accept `network: "testnet"` only to explain that it is out of scope.

## Read versus write tools

| Class | Tools |
|---|---|
| Read-only, no network | `pepu_known_gotchas`, `pepu_decode_error`, `pepu_explain_error`, `pepu_verify_contract_guide`, `pepu_list_templates`, `pepu_check_env` (reads local env files), `pepu_session_policy`, `pepu_encode_calls`, `pepu_prepare_project_tx`, `pepu_get_docs`, `pepu_sdk_snippet`, `pepu_sdk_exports` |
| Read-only, remote | `pepu_chain_info`, `pepu_health_check`, `pepu_gas_price`, `pepu_estimate_gas_cost`, `pepu_read_contract`, `pepu_check_contract_deployed`, `pepu_get_token_info`, `pepu_get_address_overview`, `pepu_get_transaction`, `pepu_search`, `pepu_smart_account_info`, `pepu_verify_contract_status`, `pepu_bundler_health`, `pepu_paymaster_health`, `pepu_sponsorship_status`, `pepu_project_balance`, `pepu_explain_tx`, `pepu_decode_tx_logs`, `pepu_check_privy_config` |
| Write (local files only) | `pepu_scaffold_app` (creates a new project folder), `pepu_generate_authorization_key` (writes one env key) |

Neither write tool is destructive. Neither can overwrite an existing project or an existing authorization key without an explicit flag.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| An agent still uses the canonical Multicall3 address | The server is not connected or the agent did not call it | Check the connection ([Install per Client](install.md)) and have the agent call `pepu_check_contract_deployed` or `pepu_chain_info`. |
| An agent says sponsorship works or does not work from memory | It skipped the live check | Call `pepu_sponsorship_status` and report what it says. |

## Related

- [Install per Client](install.md)
- [Tool Reference](tools.md)
- [Resources and Prompts](resources-and-prompts.md)
- [MCP Server and Skills (overview)](../agent-tooling/mcp-and-skills.md)
- [Skills Catalog](../agent-tooling/skills.md)
- [Claude Code Plugin](../agent-tooling/plugin.md)
