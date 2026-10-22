# @pepu-chain/mcp

An MCP (Model Context Protocol) server exposing **Pepe Unchained (PEPU) V2 specific** tools — not a
generic Blockscout wrapper. `pepuscan.com` is a real, publicly-registered Blockscout instance, and
the [official Blockscout MCP server](https://github.com/blockscout/mcp-server) already covers
generic chain-data lookups well. This server only adds what's PEPU-specific or what meaningfully
composes several Blockscout/RPC calls into one workflow.

Chain facts:

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `97741` | `97740` |
| RPC | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` | `https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` |
| Explorer (Blockscout) | `https://pepuscan.com` | none registered |
| Stack | Arbitrum Orbit / Nitro, ArbOS 51 "Dia" | same |

There are two unrelated chains sharing the "Pepe Unchained" brand. This server only ever talks
about **V2** (above). V1 (chain id `3409`, OP Stack, migrated away from in 2025) is out of scope.

## Install

Requires Node.js >= 18.

```bash
# run without installing (recommended):
npx -y @pepu-chain/mcp
# or install globally:
npm install -g @pepu-chain/mcp
```

### Claude Code / Claude Desktop config

Paste this into your MCP client's config (e.g. `.mcp.json` for Claude Code, or Claude Desktop's
`claude_desktop_config.json`):

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

If you've installed it globally or are developing locally, point `command` at the built entry
point instead:

```json
{
  "mcpServers": {
    "pepu": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"]
    }
  }
}
```

No API key is required. Optional env vars: `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL` (the sponsorship tools; they default to the hosted bundler and paymaster service) and `PEPU_RPC_URL`. Everything else talks to public PEPU RPC endpoints and pepuscan's public REST API.

## Tools

| Tool | What it does | Backed by |
|---|---|---|
| `pepu_chain_info` | Network facts for mainnet/testnet — chain ids, RPCs, explorers, ArbOS version, and which canonical infra contracts (Multicall3, Permit2, EntryPoint, Kernel factory, the verifying paymaster) are and are not deployed — and, for the paymaster, how sponsorship is reached (the hosted bundler and paymaster service, with a project token). Call this first, before writing any PEPU config. | Cached facts + optional live RPC cross-check |
| `pepu_get_address_overview` | One-call composed overview of an address: balance, contract-or-EOA, verification status, tx count, token holdings. | pepuscan (Blockscout), mainnet only |
| `pepu_get_transaction` | A transaction with decoded input (when pepuscan has a matching ABI), PEPU-denominated value/fee, and Arbitrum L1 batch/settlement status. | pepuscan (Blockscout), mainnet only |
| `pepu_read_contract` | Calls a read-only contract method via RPC given an address, ABI fragment, and args. | RPC direct — works on mainnet **and** testnet |
| `pepu_verify_contract_status` | Is this address verified on pepuscan, and if so its ABI/compiler/Sourcify link — correctly distinguishing "unverified contract" from "not a contract at all," which pepuscan's raw API does not. | pepuscan (Blockscout), mainnet only |
| `pepu_estimate_gas_cost` | Estimates a call's, or a contract deployment's, gas cost in PEPU (live `eth_estimateGas`, or a known `gas_limit` priced directly), and explains the chain's unusual ~12,500 gwei-equivalent base fee. | RPC direct — works on mainnet **and** testnet |
| `pepu_search` | Resolves an ambiguous string (address / tx hash / token symbol / block) to the right entity, with a pointer to which tool to call next. | pepuscan (Blockscout), mainnet only |
| `pepu_check_contract_deployed` | Given a name ("Multicall3", "Permit2", ...) or address, makes a *live* `eth_getCode` check and — if you asked about a canonical address with no code here — surfaces the PEPU-specific replacement instead of just saying "not deployed." | RPC direct — works on mainnet **and** testnet |
| `pepu_gas_price` | Current live gas price plus a reference cost table (transfer / ERC-20 transfer / swap / rough deploy) — the fast "what does gas cost right now" check with zero inputs. | RPC direct — works on mainnet **and** testnet |
| `pepu_get_token_info` | An ERC-20's name/symbol/decimals/supply/holders from pepuscan, cross-checked live against the contract itself via RPC (catches a stale pepuscan index), and flagged if it's WPEPU. | pepuscan (Blockscout) + RPC cross-check, mainnet only |
| `pepu_health_check` | Composes RPC + Blockscout reachability into one call and distinguishes "pepuscan is down/behind," "wrong network," and "testnet never had an indexer" — three failure modes a bare RPC ping can't tell apart. | RPC direct + pepuscan (Blockscout) |
| `pepu_known_gotchas` | The curated list of PEPU footguns (Multicall3's address, gas sponsorship status and the tiered v2 facts, self-hosting the bundler and paymaster, Privy policy name limit, denied session-signer transactions, wallet provisioning and active-wallet pinning, scope decisions, testnet's missing indexer, etc.) as one flat, directly-nameable list. Zero network calls. | Cached facts only |
| `pepu_decode_error` | Decodes a 4-byte-selector revert payload — your own contract's errors (via `abi`), Solidity's `Error`/`Panic`, ERC-4337 EntryPoint v0.6/v0.7 errors (with AA-code phase explanations), and a small verified ArbOS precompile error table. | Pure decode, zero network calls |
| `pepu_smart_account_info` | Computes a ZeroDev Kernel v3 smart account's counterfactual address for an owner via the factory's own on-chain `getAddress`, and reports whether it's deployed. Read-only — never signs or sends anything. | RPC direct, mainnet only (factory isn't on testnet) |
| `pepu_verify_contract_guide` | The exact `forge verify-contract`/`hardhat verify` invocation for pepuscan, including the specific `--verifier blockscout --verifier-url .../api` flags Foundry needs. | Static reference, zero network calls |

**Note on testnet coverage**: pepuscan.com only indexes mainnet (confirmed against
`chains.blockscout.com/api/chains` — no entry exists for chain `97740`). Testnet's only explorer
is Conduit's default UI, which self-reports no indexer. The Blockscout-backed tools above
therefore only work on mainnet; asking them for testnet returns an actionable error explaining
this and pointing at an RPC-direct tool instead, rather than a generic schema-validation
rejection. RPC-direct tools (`pepu_read_contract`, `pepu_estimate_gas_cost`,
`pepu_check_contract_deployed`, `pepu_gas_price`) work on both networks; `pepu_smart_account_info`
is RPC-direct but still mainnet-only today because the Kernel factory itself isn't deployed on
testnet — that's a deployment fact, not a Blockscout-coverage one.

## SDK-backed tools, resources and prompts (0.2.0)

Since 0.2.0 this server is built on `@pepu-chain/sdk`: addresses come from its contract registry
(`getPepuAddresses`), chain facts from `pepuMainnet`, error explanations from its error catalog
(`explainError`), and endpoints from `resolvePepuEndpoints`. Every tool below names the SDK
function it calls. Nothing here reimplements SDK infrastructure.

Every tool carries the four MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`). Only the two write tools are not read-only, and neither is destructive.

### Probes, status and explainers

| Tool | SDK function | What it does |
|---|---|---|
| `pepu_bundler_health` | `probeBundler` | Chain id, EntryPoints, supported UserOperation methods, latency, verdict. Defaults to `PEPU_BUNDLER_URL`. |
| `pepu_paymaster_health` | `probePaymaster` | `/health`, `/v2/free-tier` and the v2 ERC-7677 route (a structured JSON-RPC error counts as responding). Defaults to the hosted service. Returns the host only (the URL can embed a token). |
| `pepu_sponsorship_status` | `checkSponsorship` | "Can my app send a gasless transaction right now?" with reasons and fixes. |
| `pepu_project_balance` | `readProject`, `computeProjectId` | v2 project state. Reads the registry's deployed v2 paymaster (`0xdb28528C9399C33c9A0297E8A62F39145acbC30D`) by default; an explicit `paymaster` address overrides it. |
| `pepu_explain_error` | `explainError`, `mapPaymasterReason` | Any error message, paymaster reason code or revert data to cause, fix, retryability and docs link. |
| `pepu_explain_tx` | `explorerLinks`, `formatPepu`, `userOpEventFromReceipt` | EOA transaction vs UserOperation bundle, who paid gas, status, fee. A UserOperation hash works when `PEPU_BUNDLER_URL` is set. |
| `pepu_decode_tx_logs` | `explorerLinks` (decoding by viem) | Any transaction decoded from its hash alone: each event log and the top-level input resolved from your ABI fragments, the contract's verified ABI on pepuscan (proxies included), pepuscan's own decoding, built-in standards (ERC-20/721, WPEPU, EntryPoint, Uniswap V2/V3), then a public signature database. Every result names its `source`; `offline: true` skips lookups. bigints as decimal strings. |

### Generate, scaffold and docs

| Tool | SDK function | What it does |
|---|---|---|
| `pepu_list_templates` | `TEMPLATE_REQUIREMENTS` | The create-pepu-app templates (bundled `templates.json`) with doctor pillars, CLI features, env, Privy settings and when to pick each. |
| `pepu_scaffold_app` | `checkPepuEnv` | Runs the create-pepu-app CLI with `--yes --json`. Absolute directory only, must not exist or be empty. Optionally writes the Privy app id and bundler and paymaster URLs to `.env.local` (never echoed). |
| `pepu_check_env` | `checkPepuEnv` | ok, missing, placeholder or malformed per key, with length and fix. **Never returns a value.** |
| `pepu_check_privy_config` | `checkPrivyDashboardConfig` | Dashboard requirements as pass, fail or unknown, plus the env and code requirements. |
| `pepu_generate_authorization_key` | `generatePrivyAuthorizationKey` | Writes the private half straight to `.env.local`; returns only the public key and a fingerprint. Needs `confirm_write: true`; refuses to replace a key without `overwrite: true`. |
| `pepu_session_policy` | `buildSessionPolicy`, `describeSessionScope`, `buildKernelSessionPolicies`, `describeKernelSessionScope` | A scoped policy in Privy mode (off-chain) or Kernel mode (on-chain), with consent text, selectors, trust notice and snippet. |
| `pepu_encode_calls` | `encodeAggregate3`, `getMulticall3` | Calldata, one `aggregate3` to PEPU's Multicall3, or Kernel v3 ERC-7579 execute callData. |
| `pepu_prepare_project_tx` | `encodeDeposit`, `encodeClaimProject`, `configureProject` and the other encoders | Unsigned `{ to, data, value }` with one-way-deposit warnings. Never signs. Defaults to the registry's deployed v2 paymaster; an explicit `paymaster` address overrides it. |
| `pepu_get_docs` | the bundled docs snapshot | Search or fetch pages of the repo's `docs/` folder, bundled at build time. |
| `pepu_sdk_snippet` | `@pepu-chain/sdk` | Canonical code per pillar and combination (provider, ensure-wallet route, sessions, sponsorship, sponsored session, multicall, v2 deposit). Imports are checked against the export list in tests. |
| `pepu_sdk_exports` | `@pepu-chain/sdk` | Every import path and its exports with summaries, generated from the SDK build. |

The original tools (`pepu_chain_info` and the rest, listed above) are unchanged in behavior. They
now read the SDK registry, add the Kernel policy modules, `TapScore` and paymaster v1 and v2 rows
(`pepu_chain_info` detailed mode), add bundler and paymaster rows to `pepu_health_check` when the
URLs are configured, and `pepu_decode_error` and `pepu_known_gotchas` carry the SDK catalog.
`pepu_decode_error` stays for custom errors from your own ABI; `pepu_explain_error` is the first
call for any failure.

### Resources and prompts

Resources: `pepu://chain-facts`, `pepu://addresses`, `pepu://docs/{slug}`, `pepu://skills/{name}`,
`pepu://sdk/exports`. Prompts: `new-pepu-app`, `add-google-login`, `add-session`,
`add-sponsorship`, `add-sponsored-session`, `debug-tx`.

### Safety

- No tool returns a secret. `pepu_check_env` reports presence and length only; a secret-leak
  test checks the outputs. URLs that may carry credentials are reduced to their host.
- File-touching tools accept absolute paths only, refuse `..`, filesystem roots and system
  folders, and refuse to overwrite. `pepu_generate_authorization_key` only writes `.env*` files.
- Read-only by default. The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service
  (`https://paymaster.pepeunchained.com`) are live and are what `pepu_bundler_health`,
  `pepu_paymaster_health`, `pepu_sponsorship_status` and `pepu_health_check` probe by default; the
  service base is probed, since the ERC-7677 URL embeds a project token. Set `PEPU_BUNDLER_URL` and
  `PEPU_PAYMASTER_URL` to override (local dev defaults `http://localhost:4337` and
  `http://localhost:8788`).

### Build-time snapshots

`pnpm build` runs `scripts/build-snapshots.mjs` first, which bundles the repo's `docs/`, the
`skills/*/SKILL.md` files, create-pepu-app's `templates.json` and the SDK export list into
`src/generated/` (committed, so tests work on a fresh checkout). Build the SDK first
(`pnpm --filter @pepu-chain/sdk build`). `session/kernel` tools use the optional peers
`@zerodev/sdk`, `@zerodev/permissions` and `@zerodev/ecdsa-validator`; without them
`pepu_session_policy` kernel mode still describes the scope but does not build policy objects.

`pnpm smoke` (after `pnpm build`) lists every tool, resource and prompt over stdio.

### Tools considered and deliberately rejected (too generic)

Per the design brief ("if a tool would just be a thin proxy for 'get transactions by address,' it
does not belong here"), the following were considered and cut:

- **`pepu_get_transactions_by_address`** — a raw list-transactions proxy. `pepu_get_address_overview`
  already gives the composed signal (tx count, balance, holdings) needed to decide whether to dig
  further; fetching a specific transaction is `pepu_get_transaction`. A bulk history dump is
  exactly what the generic Blockscout MCP server / pepuscan's own explorer UI already do well.
- **`pepu_get_block`** — no PEPU-specific behavior over a generic block lookup; not composed with
  anything else. Left to the generic Blockscout MCP server.
- **`pepu_get_logs` / raw event-log queries** — a direct proxy for `eth_getLogs` with no PEPU-specific
  interpretation; PEPU's own 2,000-block range cap on this RPC method is exactly generic
  RPC-provider behavior, not something worth a bespoke tool over.
- **`pepu_estimate_deployment_cost`** as a separate tool — folded into `pepu_estimate_gas_cost`
  instead (omit `to`, pass init bytecode as `data`) rather than shipping a second tool that's 90%
  the same code path.
- **A `pepu_send_transaction` / write tool** — deliberately out of scope. This server never holds
  a private key; it is read-only tooling by design (see AGENTS.md).

Note: `pepu_get_token_info` was originally on this rejected list ("fully covered by `pepu_search`
plus `pepu_get_address_overview`"). In practice, neither of those actually surfaces decimals/total
supply/holder count cross-checked against a live RPC read, or flags the wrapped-native token
specifically — so it was reinstated as a real tool. Leaving this note so the reasoning for the
reversal is visible rather than silently disappearing from history.

## Tool design conventions

Followed across every tool, per current MCP tool-design guidance (see
modelcontextprotocol.io and Anthropic's "Writing tools for agents" post):

- **High-signal output only.** Internal Blockscout ids (`watchlist_address_id`, private tags,
  etc.) are stripped before anything reaches the model.
- **`response_format: "concise" | "detailed"`** on every tool that could return a lot. Concise is
  the default and answers "what do I need to not break something"; detailed adds full ABI arrays,
  proxy/implementation info, and Arbitrum batch/settlement detail.
- **Pagination with guidance, not silent truncation.** Lists are capped (5 concise / 20–25
  detailed) and an explicit note explains how many were omitted and how to narrow the query.
- **Actionable errors as tool-execution errors, not protocol errors.** Every thrown error follows
  a what/why/fix template (see `src/errors.ts`) and surfaces as `isError: true` tool output the
  model can read and self-correct from — never a raw JSON-RPC protocol failure. This matches the
  MCP spec's own guidance (input-validation errors should be Tool Execution Errors, not
  protocol-level errors) and is exercised directly in the test suite.
- **Descriptions state what AND when.** Every tool description says what it does and when to call
  it relative to the other tools in this server (e.g. "call `pepu_verify_contract_status` first if
  you don't already have the ABI" on `pepu_read_contract`).

## Architecture / adding HTTP transport later

```
src/
  constants.ts   verified static chain facts (addresses, ArbOS version, gotchas)
  blockscout.ts  thin pepuscan REST client + a small request throttle
  rpc.ts         viem chain definitions + cached PublicClients (mainnet/testnet)
  format.ts      shared response shaping (PEPU formatting, pagination)
  errors.ts      actionable-error helper
  server.ts      createPepuMcpServer() — transport-agnostic McpServer factory
  index.ts       stdio entry point (the only wired-up transport today)
  tools/         one file per tool, each a register*Tool(server) function
```

Every tool is registered onto a plain `McpServer` instance via `registerAllTools()` in
`src/server.ts`, independent of transport. Today only stdio is wired up (`src/index.ts`), matching
the brief's "support stdio first." To add Streamable HTTP later: create a new entry point that
calls `createPepuMcpServer()` and connects a `StreamableHTTPServerTransport` (from
`@modelcontextprotocol/sdk/server/streamableHttp.js`) instead of `StdioServerTransport` — no tool
code changes required.

## Development

```bash
pnpm install
pnpm build       # tsup -> dist/
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest — all unit tests mock fetch, no live network calls
pnpm smoke       # scripts/smoke-test.ts — spawns the built server for real and
                 # makes live calls against pepuscan.com + the PEPU RPC
```


## Dependencies

- `@modelcontextprotocol/sdk` `^1.30.0`: the high-level `McpServer` API (`server.registerTool(name, { description, inputSchema }, handler)`) and `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. Errors thrown inside a tool handler are converted by `McpServer` into a `CallToolResult` with `isError: true`.
- `viem` `^2.56.8`: `defineChain`, `createPublicClient`, `http()` transport.
- `zod` `^4.6.5`: tool input schemas, as a plain object of per-field Zod schemas (not a wrapping `z.object()`).
