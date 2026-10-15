# MCP Tool Reference

All 32 tools of `@pepu-chain/mcp`, derived from the tool registry in `packages/mcp/src/tools`: what each does, its inputs (from the zod schemas), what it returns, the SDK function it uses, its safety properties and an example call. Read this when you are wiring an agent to the server or when you need to know exactly what a tool will and will not do.

> Status: built and tested. The server is at version 0.2.5 and every tool runs against live mainnet RPC and pepuscan. Tools that probe the bundler or paymaster target the hosted bundler (`https://bundler.pepeunchained.com`) and the paymaster service base (`https://paymaster.pepeunchained.com`) by default; `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` override them. Tools that touch the v2 paymaster default to the registry's deployed canary `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (Proven on mainnet as a canary: internally reviewed 3x, external audit pending, funded in small tranches); an explicit `paymaster` address overrides it.

## Prerequisites

- The server is installed in your client. See [Install per Client](install.md).
- For the sponsorship probes: `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` in the server's environment. Local development defaults are `http://localhost:4337` and `http://localhost:8788`. See [Environment Variables](../reference/env-vars.md).
- Mainnet only (chain `97741`). Several tools accept `network: "testnet"` only so they can explain that the testnet is out of scope instead of failing schema validation.

## How to read this page

Every tool declares four MCP annotation hints. A client uses them to decide what to auto-approve.

| Class | `readOnlyHint` | `openWorldHint` | Meaning |
|---|---|---|---|
| Static read | true | false | Pure data or computation. No network, no files. |
| Remote read | true | true | Reads PEPU RPC, pepuscan or a configured bundler or paymaster. Changes nothing. |
| Write | false | true | Writes a file on your machine. Never destructive, never idempotent. Only two tools are in this class. |

Conventions shared by all tools:

- `response_format` is `"concise"` (default) or `"detailed"` wherever output can be large.
- Results are JSON text. Big integers are returned as decimal strings.
- Errors are actionable: what happened, why, and the fix.
- No tool returns a secret. URLs that may carry a credential are reduced to their host. See [MCP Server Overview](index.md#security-model).

## Tool index

| Tool | Group | Class | SDK function or source |
|---|---|---|---|
| `pepu_chain_info` | Chain and lookups | Remote read | `getPepuAddresses` |
| `pepu_known_gotchas` | Chain and lookups | Static read | `PEPU_ERROR_CATALOG` |
| `pepu_health_check` | Chain and lookups | Remote read | `resolvePepuEndpoints`, `probeBundler`, `probePaymaster` |
| `pepu_gas_price` | Chain and lookups | Remote read | RPC (viem) |
| `pepu_estimate_gas_cost` | Chain and lookups | Remote read | RPC (viem) |
| `pepu_read_contract` | Chain and lookups | Remote read | RPC (viem) |
| `pepu_check_contract_deployed` | Chain and lookups | Remote read | RPC (`eth_getCode`) and the SDK registry |
| `pepu_get_token_info` | Chain and lookups | Remote read | pepuscan plus RPC cross-check |
| `pepu_get_address_overview` | Chain and lookups | Remote read | pepuscan |
| `pepu_get_transaction` | Chain and lookups | Remote read | pepuscan |
| `pepu_search` | Chain and lookups | Remote read | pepuscan |
| `pepu_smart_account_info` | Chain and lookups | Remote read | Kernel factory `getAddress` over RPC |
| `pepu_decode_error` | Chain and lookups | Static read | `explainError` |
| `pepu_verify_contract_guide` | Chain and lookups | Static read | static reference |
| `pepu_verify_contract_status` | Chain and lookups | Remote read | pepuscan |
| `pepu_bundler_health` | Probe, status, explain | Remote read | `probeBundler` (`/aa`) |
| `pepu_paymaster_health` | Probe, status, explain | Remote read | `probePaymaster` (`/aa`) |
| `pepu_sponsorship_status` | Probe, status, explain | Remote read | `checkSponsorship` |
| `pepu_project_balance` | Probe, status, explain | Remote read | `readProject`, `computeProjectId` (`/paymaster`) |
| `pepu_explain_error` | Probe, status, explain | Static read | `explainError`, `mapPaymasterReason` |
| `pepu_explain_tx` | Probe, status, explain | Remote read | `explorerLinks`, `formatPepu`, `userOpEventFromReceipt` |
| `pepu_list_templates` | Generate, scaffold, docs | Static read | `TEMPLATE_REQUIREMENTS` (`/doctor`) |
| `pepu_scaffold_app` | Generate, scaffold, docs | Write | create-pepu-app CLI, `checkPepuEnv` |
| `pepu_check_env` | Generate, scaffold, docs | Static read | `checkPepuEnv` (`/doctor`) |
| `pepu_check_privy_config` | Generate, scaffold, docs | Remote read | `checkPrivyDashboardConfig` (`/privy`) |
| `pepu_generate_authorization_key` | Generate, scaffold, docs | Write | `generatePrivyAuthorizationKey` (`/doctor`) |
| `pepu_session_policy` | Generate, scaffold, docs | Static read | `buildSessionPolicy`, `buildKernelSessionPolicies` and the `describe*` helpers |
| `pepu_encode_calls` | Generate, scaffold, docs | Static read | `encodeAggregate3`, `getMulticall3` |
| `pepu_prepare_project_tx` | Generate, scaffold, docs | Static read | the `encode*` helpers and `configureProject` (`/paymaster`) |
| `pepu_get_docs` | Generate, scaffold, docs | Static read | bundled docs snapshot |
| `pepu_sdk_snippet` | Generate, scaffold, docs | Static read | bundled, export-checked snippets |
| `pepu_sdk_exports` | Generate, scaffold, docs | Static read | bundled SDK export list |

The groups follow the registry: the original lookups first, then the SDK-backed probes and explainers, then generate, scaffold and docs.

---

## Chain facts and lookups

### `pepu_chain_info`

Verified network facts: chain ids, RPC and explorer URLs, native currency, ArbOS version, and which infrastructure contracts are deployed (Multicall3, Permit2, EntryPoint, Kernel factory, the verifying paymaster), including the sponsorship status. Call it first, before writing any PEPU chain config.

| Input | Type | Default | Notes |
|---|---|---|---|
| `network` | `mainnet`, `testnet`, `both` | `both` | |
| `verify_live` | boolean | `false` | Adds a live `eth_chainId` and `eth_gasPrice` call to confirm the cached facts. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds canonical-contract notes and the gotchas list. |

Returns network facts and the registry rows from `getPepuAddresses`. Safety: remote read. It lists the v2 paymaster canary as deployed (external audit pending) and the v1 paymaster as retired.

```json
{ "network": "mainnet", "verify_live": true }
```

### `pepu_known_gotchas`

The curated list of PEPU footguns as one flat list, with no network calls: the Multicall3 address, sponsorship status, the two-address model, Privy's server-side `eth_sendTransaction` limit on chain 97741, Privy setup traps, scope decisions and more.

| Input | Type | Default | Notes |
|---|---|---|---|
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the full canonical-contract table and the SDK error catalog (`PEPU_ERROR_CATALOG`). |

Safety: static read. Call `pepu_check_contract_deployed` for a live check of one address and `pepu_explain_error` for a specific failure.

```json
{ "response_format": "detailed" }
```

### `pepu_health_check`

Is the RPC (mainnet and or testnet) and pepuscan's Blockscout API (mainnet only) reachable right now, with chain id and latest block. When a bundler or paymaster URL is configured it adds those rows. It separates "pepuscan is behind", "wrong network" and "testnet has no explorer".

| Input | Type | Default | Notes |
|---|---|---|---|
| `network` | `mainnet`, `testnet`, `both` | `both` | Blockscout is only ever checked for mainnet. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds latency and full error text. |

Safety: remote read. Use it to rule out chain-side unavailability before assuming a bug in your code.

```json
{ "network": "mainnet" }
```

### `pepu_gas_price`

The current live gas price and what it costs in PEPU for a transfer, an ERC-20 transfer, a swap and a rough contract deploy. No other inputs needed.

| Input | Type | Default | Notes |
|---|---|---|---|
| `network` | `mainnet`, `testnet` | `mainnet` | RPC-direct, so testnet works. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the raw wei value and block number. |

Safety: remote read. The base fee is about 12,500 gwei. That is high in gwei terms and not an error. The tool never returns a USD figure.

```json
{ "response_format": "detailed" }
```

### `pepu_estimate_gas_cost`

Estimates the PEPU cost of a call (live simulation), of a contract deployment (pass init bytecode as `data` and omit `to`), or of a `gas_limit` you already know.

| Input | Type | Default | Notes |
|---|---|---|---|
| `network` | `mainnet`, `testnet` | `mainnet` | |
| `to` | string | none | Recipient or contract. Omit for a deployment estimate. |
| `from` | string | none | Sender to simulate from. |
| `data` | string | `0x` | Calldata, or init bytecode for a deployment. |
| `value` | string | `0` | Wei, as a decimal string. |
| `gas_limit` | string or number | none | Skip simulation and price this gas amount. |
| `response_format` | `concise`, `detailed` | `concise` | |

Safety: remote read. No USD figure: there is no on-chain price oracle for PEPU, so bring your own price feed.

```json
{ "to": "0x261eA5971B93237a56990206A46Bc80318e4d078", "data": "0x" }
```

### `pepu_read_contract`

Calls a view or pure function over RPC, given the address, a minimal ABI fragment and the arguments. Works on testnet too.

| Input | Type | Default | Notes |
|---|---|---|---|
| `address` | string | required | 0x address of the contract. |
| `abi` | array of objects | required | At least one ABI item. Only the function you call is needed. |
| `functionName` | string | required | Must match a function in `abi`. |
| `args` | array | `[]` | Positional. uint and int values may be strings or numbers. |
| `network` | `mainnet`, `testnet` | `mainnet` | |

Safety: remote read. Sends no transaction and needs no key. Use `pepu_verify_contract_status` first if you do not know the ABI.

```json
{
  "address": "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
  "abi": [{ "type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint8" }] }],
  "functionName": "decimals"
}
```

### `pepu_check_contract_deployed`

A live `eth_getCode` check by well-known name ("Multicall3", "Permit2", "EntryPoint v0.7", "Kernel Factory", "WPEPU", "TapScore") or by address. When you ask about a canonical address that has no code on PEPU, it surfaces the PEPU-specific replacement. It is the guardrail against assuming Multicall3 sits at its usual address. See [The Multicall3 Trap](../contracts/multicall3.md).

| Input | Type | Default | Notes |
|---|---|---|---|
| `query` | string, min 1 char | required | Address or partial, case-insensitive name. |
| `network` | `mainnet`, `testnet` | `mainnet` | Works on both. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed lists every matching known contract. |

Safety: remote read.

```json
{ "query": "multicall" }
```

### `pepu_get_token_info`

An ERC-20's name, symbol, decimals, supply and holder count from pepuscan, cross-checked against the contract over RPC, and flagged when it is WPEPU. Never returns a USD value.

| Input | Type | Default | Notes |
|---|---|---|---|
| `address` | string | required | ERC-20 contract address. |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet works; testnet returns an explanation. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the raw RPC cross-check and reputation metadata. |

Safety: remote read. Use `pepu_search` first if you only have a symbol.

```json
{ "address": "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8" }
```

### `pepu_get_address_overview`

One call for an address: native balance, contract or EOA, verification status, transaction count and token holdings.

| Input | Type | Default | Notes |
|---|---|---|---|
| `address` | string | required | 40 hex characters. |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet works. |
| `response_format` | `concise`, `detailed` | `concise` | Concise shows the top 5 holdings; detailed up to 25 plus proxy information. |

Safety: remote read, mainnet only. Internal Blockscout ids are stripped from the output.

```json
{ "address": "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd" }
```

### `pepu_get_transaction`

A transaction with its decoded call when pepuscan has the ABI, and PEPU-denominated value and fee. Detailed adds the gas breakdown, nonce and Arbitrum L1 batch status. The server deliberately has no bulk transaction-history tool.

| Input | Type | Default | Notes |
|---|---|---|---|
| `hash` | string | required | 64 hex characters. |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet works. |
| `response_format` | `concise`, `detailed` | `concise` | |

Safety: remote read, mainnet only. For an EOA versus UserOperation breakdown use `pepu_explain_tx`.

```json
{ "hash": "0x<64-hex-transaction-hash>", "response_format": "detailed" }
```

### `pepu_search`

Resolves an ambiguous string (address, transaction hash, block number, token or contract name) to an entity and points to the next tool to call.

| Input | Type | Default | Notes |
|---|---|---|---|
| `query` | string, min 1 char | required | Anything you would type into an explorer search box. |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet works. |
| `response_format` | `concise`, `detailed` | `concise` | Top 5 versus top 20 matches. |

Safety: remote read, mainnet only.

```json
{ "query": "WPEPU" }
```

### `pepu_smart_account_info`

The counterfactual address of a ZeroDev Kernel v3 account (single EOA owner) for an owner and salt, taken from the factory's own on-chain `getAddress(bytes,bytes32)` and checked with `eth_getCode` for deployment. This is the smart account address, which is not the owner address. See [The Two-Address Model](../onboarding/two-address-model.md).

| Input | Type | Default | Notes |
|---|---|---|---|
| `owner` | string | required | The EOA that controls the account. |
| `salt` | string | `"0"` | Integer string or a full 0x 32-byte value. |
| `network` | `mainnet`, `testnet` | `mainnet` | The factory exists on mainnet only. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the encoded init data and assumptions. |

Safety: remote read. Never deploys, never holds a key. It does not imply sponsorship works.

```json
{ "owner": "0x<owner-address>", "salt": "0" }
```

### `pepu_decode_error`

Decodes revert data into an error name and arguments: your own custom errors (pass `abi`), Solidity `Error` and `Panic`, ERC-4337 EntryPoint v0.6 and v0.7 errors with AA-code phase explanations, and a small ArbOS precompile table. The public RPC does not expose `debug_traceCall`, so this is often the only way to read a failure.

| Input | Type | Default | Notes |
|---|---|---|---|
| `data` | string | required | Revert payload, 0x hex. Bare selector or selector plus args. |
| `abi` | array of objects | none | Your contract's error fragments. Checked first. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds which table matched. |

Safety: static read. For the PEPU-specific cause and fix of any failure prefer `pepu_explain_error`; keep this tool for decoding custom errors from your own ABI.

```json
{ "data": "0x08c379a0..." }
```

### `pepu_verify_contract_guide`

The exact command to verify a contract on pepuscan: Foundry (`--verifier blockscout` with the `--verifier-url` ending in `/api`) and or the Hardhat `customChains` and `verify.blockscout` configuration.

| Input | Type | Default | Notes |
|---|---|---|---|
| `tool` | `foundry`, `hardhat`, `both` | `both` | |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet is verifiable. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the Hardhat config, failure modes and proxy handling. |

Safety: static read. Call it right after deploying, then `pepu_verify_contract_status` to check the result. See [Deploy and Verify a Contract](../contracts/deployment.md).

```json
{ "tool": "foundry" }
```

### `pepu_verify_contract_status`

Is this address a verified contract on pepuscan, and if so its ABI, compiler and Sourcify link. It tells an unverified contract apart from an address that is not a contract at all.

| Input | Type | Default | Notes |
|---|---|---|---|
| `address` | string | required | |
| `network` | `mainnet`, `testnet` | `mainnet` | Only mainnet works. |
| `response_format` | `concise`, `detailed` | `concise` | Detailed adds the full ABI, license and proxy information. |

Safety: remote read, mainnet only.

```json
{ "address": "0x261eA5971B93237a56990206A46Bc80318e4d078" }
```

---

## Probes, status and explainers

### `pepu_bundler_health`

Probes an ERC-4337 bundler with `probeBundler` from `@pepu-chain/sdk/aa`: chain id (must be `97741`), supported EntryPoints (must include v0.7), which UserOperation methods exist, latency, and a verdict with a fix. Defaults to `PEPU_BUNDLER_URL`.

| Input | Type | Default | Notes |
|---|---|---|---|
| `url` | URL string | `PEPU_BUNDLER_URL` | Never echoed back, only its host. |

Safety: remote read. Sends nothing on-chain. The default is the hosted bundler; an explicitly cleared or unreachable value is reported with next steps.

```json
{}
```

### `pepu_paymaster_health`

Probes an ERC-7677 paymaster with `probePaymaster`: `GET /health`, the free-tier endpoint and a `pm_getPaymasterStubData` round trip. A JSON-RPC denial still counts as alive, because the probe has no credential. Defaults to `PEPU_PAYMASTER_URL`.

| Input | Type | Default | Notes |
|---|---|---|---|
| `url` | URL string | `PEPU_PAYMASTER_URL` | The ERC-7677 endpoint, often `https://host/paymaster/<token>`. Returns only the host. |

Safety: remote read. The URL can embed a credential and is never returned.

```json
{}
```

### `pepu_sponsorship_status`

Answers "can my app send a gas-sponsored transaction right now?" with `checkSponsorship`: resolves the URLs with `resolvePepuEndpoints`, probes both, optionally reads the paymaster's EntryPoint deposit, and returns `available`, a reason and fixes. Always run this before making any claim about sponsorship.

| Input | Type | Default | Notes |
|---|---|---|---|
| `bundlerUrl` | URL string | `PEPU_BUNDLER_URL` | |
| `paymasterUrl` | URL string | `PEPU_PAYMASTER_URL` | Never echoed back. |
| `include_deposit` | boolean | `true` | Reads the paymaster's EntryPoint v0.7 deposit (the v2 canary from the registry). An empty deposit makes sponsorship unavailable. |

Returns `available`, `transport`, `reason`, `fixes`, a bundler section, a paymaster section (host, health, ERC-7677 stub result, free tier, deposit) and notes. Safety: remote read. The notes always state that the hosted bundler and paymaster service are live and that the v2 paymaster is a canary with the external audit pending. Without a token URL the paymaster service is probed at its base.

```json
{ "include_deposit": true }
```

### `pepu_project_balance`

Reads a v2 sponsorship project on-chain with `readProject`: owner, claimed, balance, spendable limits, spent today, paused and pending re-claim. The project id is `computeProjectId`, which is `keccak256(bytes(appId))` and case-sensitive.

| Input | Type | Default | Notes |
|---|---|---|---|
| `appId` | string | none | Privy app id. Give `appId` or `projectId`. |
| `projectId` | string | none | 32-byte id, 0x plus 64 hex. |
| `paymaster` | string | none | Address of a v2 paymaster you have verified. Required today. |

Safety: remote read. Status: Proven on mainnet (canary, external audit pending). With no `paymaster` argument the tool reads the registry's deployed v2 canary (`0xdb28528C9399C33c9A0297E8A62F39145acbC30D`); an explicit `paymaster` overrides it, and only if neither exists does it return the computed project id and say so. Deposits are one-way and cannot be withdrawn. See [Sponsorship Tiers](../onboarding/sponsorship-tiers.md).

```json
{ "appId": "<your-privy-app-id>" }
```

### `pepu_explain_error`

Explains any PEPU failure from the SDK's shared error catalog (`explainError`): an error message or stack text, a paymaster denial reason code (mapped with `mapPaymasterReason`, for example `project_not_claimed_onchain`), or raw revert data. Returns the catalog code, cause, fix, whether a retry can help, the HTTP status the SDK route factories use and a docs link.

| Input | Type | Default | Notes |
|---|---|---|---|
| `error` | string, 1 to 20,000 chars | required | Pass the text exactly as given. It is never echoed back. |

Safety: static read, pure and offline. It is the first call for any failure and a superset of `pepu_decode_error`. See [SDK Error Catalog](../sdk/errors.md).

```json
{ "error": "AA21 didn't pay prefund" }
```

### `pepu_explain_tx`

Explains a transaction or ERC-4337 bundle from the RPC alone: EOA transaction or UserOperation bundle, sender, who paid gas (the EOA, a paymaster, or the smart account's own deposit), success or revert, fee in PEPU and pepuscan links. Each `UserOperationEvent` is decoded with `userOpEventFromReceipt`. A UserOperation hash also works when `PEPU_BUNDLER_URL` is set.

| Input | Type | Default | Notes |
|---|---|---|---|
| `hash` | string | required | Transaction hash, or a UserOperation hash when a bundler URL is configured. |

Safety: remote read. Use `pepu_get_transaction` for pepuscan's decoded input and L1 batch status.

```json
{ "hash": "0x<64-hex-transaction-hash>" }
```

---

## Generate, scaffold and docs

### `pepu_list_templates`

Lists the create-pepu-app templates with their doctor pillars (login, wallet, session, sponsorship, gate, mint) and, separately, `features` (the CLI display tags login, session, sponsor), required and optional env vars, Privy dashboard settings (`TEMPLATE_REQUIREMENTS`), when to pick each, and the exact scaffold and run commands. Metadata comes from the bundled `templates.json`. Takes no inputs. Safety: static read. Call it before `pepu_scaffold_app`. See [Template Gallery](../templates/index.md).

```json
{}
```

### `pepu_scaffold_app`

Creates a PEPU Next.js app by running the create-pepu-app CLI with `--yes --json`. It never reimplements the CLI. Optionally writes the Privy app id and the bundler and paymaster URLs into the new `.env.local`, then reports which env vars are still missing with `checkPepuEnv`. See [create-pepu-app CLI](../cli/create-pepu-app.md).

| Input | Type | Default | Notes |
|---|---|---|---|
| `template` | string | required | A name from `pepu_list_templates`. |
| `directory` | string | required | ABSOLUTE path. Must not exist or must be empty; the parent must exist. Relative paths and `..` are refused. |
| `packageManager` | `npm`, `pnpm`, `yarn`, `bun` | auto-detected | Used in the printed commands (CLI `--pm`). |
| `privyAppId` | string | none | Written as `NEXT_PUBLIC_PRIVY_APP_ID`. Public value. Format-checked. |
| `bundlerUrl` | URL string | none | Written as `PEPU_BUNDLER_URL`. Never echoed. |
| `paymasterUrl` | URL string | none | Written as `PEPU_PAYMASTER_URL`. Can embed a credential. Never echoed. |
| `dry_run` | boolean | `false` | Validates and shows the command without creating anything. |

Safety: write class (not read-only, not destructive, not idempotent). It refuses a non-empty directory, so nothing is overwritten. It runs `npx -y create-pepu-app@latest` unless a local build is found, and falls back to the human-readable CLI output if an older CLI lacks `--json`. Returns the created path, top-level entries, env keys written, env still missing (key names and fixes only) and next steps.

```json
{ "template": "sponsored-session-app", "directory": "C:/projects/my-pepu-app", "dry_run": true }
```

### `pepu_check_env`

Checks a project's environment with `checkPepuEnv` and `TEMPLATE_REQUIREMENTS` from `@pepu-chain/sdk/doctor`. Reads `.env` and `.env.local` (the latter wins) or pasted text, and reports each key as ok, missing, placeholder or malformed, with whether it is a secret, its value length and the fix.

| Input | Type | Default | Notes |
|---|---|---|---|
| `projectDir` | string | none | ABSOLUTE path. Give `projectDir`, `envText` or both (`envText` wins). |
| `envText` | string, max 100,000 chars | none | Pasted dotenv text. Values are never echoed. |
| `template` | string | none | Selects required and optional keys. Omit for the base Privy keys. |
| `pillars` | array of `login`, `wallet`, `session`, `sponsorship`, `gate`, `mint` | none | Extra pillars to require, for example `["sponsorship"]` adds `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL`. |

Safety: static read that reads local files. It never returns or logs a value, only presence and length. The result includes `valuesReturned: false`.

```json
{ "projectDir": "C:/projects/my-pepu-app", "template": "game-app" }
```

### `pepu_check_privy_config`

Checks the Privy dashboard settings an app needs with `checkPrivyDashboardConfig` from `@pepu-chain/sdk/privy`, using Privy's public app-config endpoint (no secret): allowed origin with the exact port, create-on-login, Google login, Smart Wallets with bundler and paymaster URLs, and session signers. Each requirement comes back `pass`, `fail` or `unknown` with a fix. `unknown` means Privy did not report it, not that it failed. The result also carries the full `PEPU_PRIVY_REQUIREMENTS` table, including env and code requirements that cannot be checked remotely.

| Input | Type | Default | Notes |
|---|---|---|---|
| `appId` | string, min 1 char | required | `NEXT_PUBLIC_PRIVY_APP_ID`, a public value. |
| `origin` | URL string | none | The origin including the port, such as `http://localhost:3000`. A different dev port is the usual cause of login failure. |
| `pillars` | array of `login`, `session`, `sponsor` | all | Only report requirements that matter for these pillars. |

Safety: remote read. It needs network access to `auth.privy.io`. See [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

```json
{ "appId": "<your-privy-app-id>", "origin": "http://localhost:3000", "pillars": ["login", "session"] }
```

### `pepu_generate_authorization_key`

Generates the P-256 Privy authorization key for session signers with `generatePrivyAuthorizationKey`. The private half is written straight to the env file as `PRIVY_AUTHORIZATION_KEY` and is never returned. Only the public key and a short fingerprint come back, with the next dashboard step: register the public key as a key quorum, then set `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. See [Authorization Keys and Key Quorums](../privy/authorization-keys.md).

| Input | Type | Default | Notes |
|---|---|---|---|
| `envFile` | string | required | ABSOLUTE path, normally `<project>/.env.local`. Created if missing; the folder must exist. Must be named `.env` or `.env.<something>`. |
| `confirm_write` | boolean | `false` | Must be `true` to generate and write. When false the tool only reports what it would do. |
| `overwrite` | boolean | `false` | Required to replace an existing non-empty key. Replacing invalidates sessions granted under the old quorum. |

Safety: write class. Refuses an existing key without `overwrite: true`, refuses to write anything but an `.env*` file, and returns `privateKeyReturned: false`.

```json
{ "envFile": "C:/projects/my-pepu-app/.env.local", "confirm_write": true }
```

### `pepu_session_policy`

Builds a scoped session policy for one contract and a list of functions. Mode `privy` uses `buildSessionPolicy` and `describeSessionScope` from `@pepu-chain/sdk/session`: an off-chain Privy policy, the user pays gas, value is always zero. Mode `kernel` uses `buildKernelSessionPolicies` and `describeKernelSessionScope` from `@pepu-chain/sdk/session/kernel`: on-chain call and timestamp policies on a Kernel account, which compose with sponsorship.

| Input | Type | Default | Notes |
|---|---|---|---|
| `mode` | `privy`, `kernel` | required | |
| `contract` | string | required | The one contract the session may call. |
| `functions` | array of strings or ABI fragments, min 1 | required | Solidity signatures such as `tap()` or `transfer(address to, uint256 amount)`, or JSON ABI function fragments. |
| `minutes` | positive number | 15 | Clamped to 1 to 1440. |
| `valueLimitWei` | decimal string | `0` | Kernel mode only. Privy mode always requires zero value. |

Returns the policy, a consent summary, selectors, the trust notice (`SESSION_TRUST_NOTICE`) and a paste-ready snippet. Safety: static read, pure; nothing is signed or sent. In kernel mode the `@zerodev/*` optional peers must be installed to build the policy objects; without them the tool still describes the scope and says so. See [Session Keys](../onboarding/session-keys.md) and [Sponsored Session](../onboarding/sponsored-session.md).

```json
{ "mode": "kernel", "contract": "0x261eA5971B93237a56990206A46Bc80318e4d078", "functions": ["tap()"], "minutes": 15 }
```

### `pepu_encode_calls`

ABI-encodes contract calls with viem's `encodeFunctionData` from a signature or an ABI and optionally wraps them. `multicall3` builds one `aggregate3` call to PEPU's own Multicall3 with `encodeAggregate3` and `getMulticall3`, never the canonical `0xcA11...` address. `kernel-execute` and `userop-callData` build the Kernel v3 ERC-7579 execute calldata for a UserOperation (single or batch mode).

| Input | Type | Default | Notes |
|---|---|---|---|
| `calls` | array of 1 to 50 call objects | required | See below. |
| `as` | `calldata`, `multicall3`, `kernel-execute`, `userop-callData` | `calldata` | `kernel-execute` and `userop-callData` produce the same bytes; the second name is what goes in a UserOperation. |

Each call object:

| Field | Type | Default | Notes |
|---|---|---|---|
| `to` | string | required | Target contract. |
| `signature` | string | none | Solidity signature. Give `signature`, or `abi` plus `functionName`. |
| `abi` | array of objects | none | Full or single-function ABI. |
| `functionName` | string | none | Function to call in `abi`. |
| `args` | array | `[]` | In order. |
| `value` | decimal string | `0` | Wei. |
| `allowFailure` | boolean | `false` | `multicall3` only. |

Returns hex, a decoded echo and a gas hint. Safety: static read, pure; nothing is signed or sent.

```json
{
  "as": "multicall3",
  "calls": [
    { "to": "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8", "signature": "balanceOf(address account)", "args": ["0x<holder-address>"] }
  ]
}
```

### `pepu_prepare_project_tx`

Encodes unsigned transactions for a v2 sponsorship project with the helpers in `@pepu-chain/sdk/paymaster`: `encodeDeposit` (`depositFor`), `encodeClaimProject` and `encodeReclaimProject` (from a claim attestation), `encodeExecuteReclaim`, `encodeCancelReclaim`, `configureProject` (`setTargets`, `setDailyLimit`, `setSenderDailyLimit`) and `encodeSetPaused`. Returns `{ to, data, value }` and a plain-English warning.

| Input | Type | Default | Notes |
|---|---|---|---|
| `action` | `deposit`, `claim`, `reclaim`, `executeReclaim`, `cancelReclaim`, `configure`, `setPaused` | required | `claim` and `reclaim` need the attestation from `requestClaimAttestation` (server). |
| `paymaster` | string | none | The v2 contract address you have verified. Required today. |
| `appId` | string | none | Case-sensitive. Give `appId` or `projectId`. |
| `projectId` | string | none | bytes32. |
| `amountPepu` | string | none | `deposit`: decimal PEPU such as `"2.5"`. |
| `amountWei` | decimal string | none | `deposit`: wei. Give `amountPepu` or `amountWei`. |
| `attestation` | object | none | `claim` and `reclaim`: `{ appId, newOwner, nonce, deadline, signature }`, the EIP-712 `ProjectClaim` attestation. |
| `targets` | array of up to 50 strings | none | `configure`: destination contracts to sponsor. |
| `dailyLimitPepu` | string | none | `configure`: total daily budget. |
| `senderDailyLimitPepu` | string | none | `configure`: per-wallet daily budget. |
| `paused` | boolean | none | `setPaused`. |

Safety: static read. It never signs or sends. Status: Proven on mainnet (canary, external audit pending). With no `paymaster` argument it uses the registry's deployed v2 canary; an explicit verified address overrides it. Deposits are one-way, the app id is case-sensitive, and a claim sets the owner only: the owner must then call `configure` (a claim of a project that already holds funds is pending for the 48-hour admin delay and needs `executeReclaim`). See [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md).

```json
{ "action": "deposit", "paymaster": "0x<verified-v2-paymaster>", "appId": "<your-privy-app-id>", "amountPepu": "2.5" }
```

### `pepu_get_docs`

Reads the PEPU developer docs from a snapshot of this repository's `docs/` folder, bundled at build time (no network). `query` returns the best-matching sections with their `guide.pepeunchained.com` URL, `slug` returns a whole page, and no arguments lists every page.

| Input | Type | Default | Notes |
|---|---|---|---|
| `query` | string, min 2 chars | none | A few words, for example `privy allowed origins port`. |
| `slug` | string | none | A page slug such as `onboarding/session-keys`. Long pages are truncated; then ask for a section with `query`. |

Safety: static read. The snapshot is only as new as the installed server version. Docs describe the SDK; for exact exports use `pepu_sdk_exports` and for working code `pepu_sdk_snippet`.

```json
{ "query": "sponsored session" }
```

### `pepu_sdk_snippet`

Canonical code that uses `@pepu-chain/sdk` for one task. Each snippet names its file, peer packages, env vars and caveats, and every import is checked against the SDK export list in the package's tests. Omit `task` to list them all.

| Input | Type | Default | Notes |
|---|---|---|---|
| `task` | enum, optional | list all | One of the ids below. |

Snippet ids: `privy-provider`, `ensure-wallet-route`, `wagmi-privy`, `grant-session`, `session-routes`, `session-action-route`, `kernel-session-policy`, `sponsored-send`, `sponsored-send-server`, `check-sponsorship`, `sponsored-session`, `sponsored-session-client`, `multicall-read`, `permit2-permit`, `v2-deposit`.

Safety: static read. The `v2-deposit` snippet targets the v2 paymaster canary (external audit pending); keep deposits small.

```json
{ "task": "sponsored-session" }
```

### `pepu_sdk_exports`

Lists the exports of `@pepu-chain/sdk` per import path with one-line summaries, from an export list generated from the SDK build and bundled with the server. Use it to find the right function before writing code. Omit `subpath` to list the paths with export counts.

| Input | Type | Default | Notes |
|---|---|---|---|
| `subpath` | string | none | `@pepu-chain/sdk/session` or just `session`. |
| `search` | string | none | Name or summary contains this text, case-insensitive. |
| `kind` | `function`, `value`, `type`, `class`, `enum` | none | Only this kind of export. |

Safety: static read. The same data is available as the `pepu://sdk/exports` resource.

```json
{ "subpath": "session/kernel", "kind": "function" }
```

---

## What to expect

- Every tool returns one JSON text block, or an actionable error with what, why and fix.
- Tools that depend on a service you have not configured say so. They do not guess and they do not invent a hosted URL.
- The two write tools (`pepu_scaffold_app`, `pepu_generate_authorization_key`) are the only ones that touch your filesystem, and both accept absolute paths only.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| A Blockscout-backed tool says testnet is not supported | pepuscan does not index testnet `97740` | Use mainnet, or an RPC-direct tool (`pepu_read_contract`, `pepu_gas_price`, `pepu_estimate_gas_cost`, `pepu_check_contract_deployed`). |
| `pepu_bundler_health` or `pepu_paymaster_health` reports "not configured" | A default was cleared, or the URL you passed is empty | The hosted bundler and paymaster service are the defaults. Set `PEPU_BUNDLER_URL` / `PEPU_PAYMASTER_URL` in the server env, or pass `url`. |
| `pepu_scaffold_app` refuses the directory | Not absolute, contains `..`, or exists and is not empty | Pass an absolute path to a folder that does not exist yet. |
| `pepu_generate_authorization_key` refuses | An existing key is set, or `confirm_write` is false | Pass `confirm_write: true`; add `overwrite: true` only if you mean to rotate (that invalidates existing sessions). |
| `pepu_project_balance` or `pepu_prepare_project_tx` asks for a paymaster address | The registry has no `paymasterV2` address for the chain in use | On mainnet the registry holds the canary and both tools default to it. Pass an address you have verified to override. |
| `pepu_session_policy` kernel mode warns about missing packages | The optional `@zerodev/*` peers are not installed next to the server | Install `@zerodev/sdk`, `@zerodev/permissions` and `@zerodev/ecdsa-validator`, or accept the scope description only. |
| `pepu_check_privy_config` shows `unknown` rows | Privy's public config did not report that setting | Check the dashboard by hand; `unknown` is not a failure. |

## Related

- [MCP Server Overview](index.md)
- [Install per Client](install.md)
- [Resources and Prompts](resources-and-prompts.md)
- [Skills Catalog](../agent-tooling/skills.md)
- [SDK Overview and Reference](../sdk/reference.md)
