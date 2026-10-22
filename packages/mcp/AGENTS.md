# AGENTS.md — @pepu-chain/mcp

Instructions for a coding agent working inside this package.

## What this is

An MCP server exposing tools specific to Pepe Unchained (PEPU) V2 (chain id `97741`, testnet
`97740`, Arbitrum Orbit). It deliberately does **not** duplicate generic Blockscout functionality —
`pepuscan.com` is a real Blockscout instance and the official Blockscout MCP server already covers
generic chain-data lookups. Read `README.md`'s "Tools considered and deliberately rejected"
section before proposing a new tool — if it's a thin proxy for one Blockscout endpoint with no
PEPU-specific composition or interpretation, it probably belongs in that server, not this one.

## Build / test / run

```bash
pnpm install      # from repo root, or `pnpm --filter @pepu-chain/mcp install`
pnpm build        # tsup -> dist/ (ESM only, includes .d.ts)
pnpm typecheck    # tsc --noEmit, strict mode
pnpm test         # vitest — fully mocked, no live network calls, must stay that way
pnpm smoke        # scripts/smoke-test.ts — REAL network calls against pepuscan.com
                  # and the PEPU RPC. Run this manually after any change to
                  # blockscout.ts, rpc.ts, or a tool's request-building logic.
                  # Pace calls if you extend it — pepuscan is a public API.
```

Run `pnpm build && pnpm typecheck && pnpm test` before considering any change done. Run
`pnpm smoke` as well if you touched anything that talks to the network.

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
| `pepu_project_balance` | `readProject`, `computeProjectId` | v2 project state. Reads the registry's deployed v2 canary (`0xdb28528C9399C33c9A0297E8A62F39145acbC30D`, external audit pending) by default; an explicit `paymaster` address overrides it. |
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
| `pepu_prepare_project_tx` | `encodeDeposit`, `encodeClaimProject`, `configureProject` and the other encoders | Unsigned `{ to, data, value }` with one-way-deposit warnings. Never signs. Defaults to the registry's deployed v2 canary; an explicit `paymaster` address overrides it. Advise small deposits. |
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

- No tool returns a secret. `pepu_check_env` reports presence and length only; a canary-secret
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

## Conventions this package holds itself to

1. **This server is read-only.** No tool ever holds or requests a private key or signs a
   transaction. `pepu_read_contract` explicitly rejects non-`view`/`pure` functions. Do not add a
   write/send-transaction tool without discussing scope first — it changes the trust model of the
   whole server.
2. **One file per tool, in `src/tools/`, each exporting a single `register<Name>Tool(server)`
   function.** Wire new tools into `src/tools/index.ts`'s `registerAllTools`. Don't put tool logic
   directly in `server.ts` or `index.ts`.
3. **Every tool description states what it does AND when to use it relative to the other tools**
   (e.g., "call X first if you don't have Y"). This is deliberate — see README's "Tool design
   conventions" section — and copied guidance, not decoration; don't strip it down to a bare verb
   phrase.
4. **Errors are actionable, not opaque.** Use `actionableError(what, why, fix)` from
   `src/errors.ts` (or throw `PepuToolError` directly) — never throw a raw `Error` with just a
   status code, and never let a tool return a bare stack trace. `McpServer` converts any thrown
   `Error` from a tool handler into an `isError: true` tool result automatically (see
   `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`'s tool handler) — this is what
   makes throwing safe and correct here, not a workaround.
5. **`network` parameters on Blockscout-backed tools must accept `"testnet"` in the Zod schema**
   (not just `"mainnet"`), even though testnet isn't actually supported — call
   `assertBlockscoutNetwork(network)` from `src/blockscout.ts` inside the handler instead. This
   produces a specific, actionable explanation ("no registered Blockscout instance for testnet")
   instead of a generic schema-validation rejection. This was a real bug caught during
   development (see git history / the smoke-test transcript in README.md) — don't reintroduce it
   by narrowing the enum back down.
6. **Never fabricate a PEPU/USD price.** pepuscan reports no `exchange_rate` for PEPU (no on-chain
   oracle), and PEPU's USD price is volatile across exchanges. `pepu_estimate_gas_cost` and any
   future tool must not hardcode or compute a dollar figure — say so explicitly instead (see its
   `usdConversionNote`).
7. **Don't hand-roll facts that belong in `src/constants.ts`.** If you need a new chain fact
   (an address, a version number, a URL), verify it live the same way the existing ones were
   verified (see README's "Verification log") and add it there with a comment citing how you
   checked it — don't inline a magic string in a tool file.
8. **stdio is the only wired-up transport.** If you add HTTP, add a new entry point that reuses
   `createPepuMcpServer()` from `server.ts` — do not change tool registration to be
   transport-aware; tools must stay transport-agnostic.
9. **Prefer calling a contract's own on-chain logic over reimplementing it off-chain.**
   `pepu_smart_account_info` computes a counterfactual Kernel account address by calling the
   factory's own `getAddress(bytes,bytes32)` view function via RPC, rather than replicating CREATE2
   hashing (initcode hash, salt encoding, etc.) locally — whatever the factory says the address is
   IS correct by construction, since that's what `createAccount` will actually deploy to. Reach for
   this pattern before hand-rolling address/hash derivation for any other factory-style contract.
10. **Compute selectors, don't hardcode them.** `pepu_decode_error`'s EntryPoint/ArbOS error tables
    are plain ABI fragments (human-readable signatures); `viem`'s `decodeErrorResult` computes each
    one's 4-byte selector at call time. Never paste a memorized selector hex constant into this
    codebase — a transcription slip would silently misdecode. If you must hardcode one anyway
    (e.g. asserting an expected value in a test), verify it by computing it, or by triggering it
    live on-chain and checking the two match, the way `InvalidBlockNumber`'s selector was confirmed
    (see README's 2026-09-24 verification log entry) — don't paste a value you merely recall.

## Things that will bite you if you assume them

- **Multicall3 is not deployed on PEPU and cannot be at its canonical address** (the original
  pre-signed deployment tx has a 1M gas limit; Nitro chains need ~14.3M gas for the same bytecode).
  Don't write any helper that assumes it exists.
- **pepuscan (Blockscout) only covers mainnet.** There is no Blockscout instance registered for
  testnet as of the last check in README.md. Don't add a Blockscout-backed tool call on the
  testnet code path without re-verifying this hasn't changed.
- **The public PEPU RPC rate-limits and gates `debug_`/`trace_`** behind an authenticated Conduit
  API key. Don't build a tool around those namespaces assuming the public endpoint supports them.
  This is also why `pepu_decode_error` exists: a revert from the public RPC is often nothing but an
  opaque 4-byte selector, with no trace to fall back on.
- **PEPU's base fee is ~12,500 gwei-equivalent, not a bug.** Don't add logic that treats a high
  gwei number as an error condition or tries to "fix" it.
- **Chain state here changes.** Permit2 and both EntryPoint versions were "not deployed" facts in
  this server's first verification pass and are deployed now — a prior negative in `constants.ts`,
  a README note, or your own memory of an earlier session is not evidence something is still true.
  Re-verify live (a real `eth_getCode`/`eth_call`, not an assumption) before trusting or repeating a
  "not deployed" claim, and before removing a `pepu_check_contract_deployed` staleWarning code path
  that exists specifically to catch this.
- **Gas sponsorship is live, through a canary paymaster.** PEPU hosts the bundler
  (`https://bundler.pepeunchained.com`) and the paymaster service (`https://paymaster.pepeunchained.com`).
  The full ERC-4337 stack (EntryPoint v0.6/v0.7, Kernel v3 factory/MetaFactory/ECDSA validator) and the v2
  paymaster `PepuSponsoredPaymasterV7` (`0xdb28528C9399C33c9A0297E8A62F39145acbC30D`) are deployed on mainnet,
  and a project-sponsored operation from a fresh zero-balance Kernel account has transacted through the hosted
  URLs. Always use the honest label: deployed as a canary, internally reviewed 3x, external audit pending,
  funded in small tranches. Never say audited; advise small deposits. The v1 paymaster
  (`0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0`) is retired (deposit withdrawn): never deposit to it. The
  ERC-7677 URL always embeds a token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`), so an app
  needs a project: a client token (`ppt_`) only works from the project's allowed origins
  (`project_origin_not_allowed` otherwise), server code uses the secret server key (`ppk_`). The free tier
  (100 PEPU/day and 50 PEPU/hour per user, TapScore targets only) needs a verified Privy token from
  PEPU's own Privy app; a third-party app's Privy token does not unlock it. The Google login + Kernel session
  key + sponsorship combination runs on mainnet against the hosted bundler and v2 paymaster. Never let a
  tool's success in computing a smart-account address imply that deploying that account is gas-free for any app
  without a funded project.

- **`KNOWN_GOTCHAS` is the agent-facing checklist; keep it in sync with the docs.** Besides Multicall3,
  explorers and sponsorship, it carries: self-hosting the sponsorship stack (Alto `safe-mode` false,
  `enable-cors` true, idempotent paymaster calls, unauthenticated stub data, `data.reason`), the Privy
  policy name limit (at most 49 characters, not 50), denied session-signer transactions, wallet
  provisioning and active-wallet pinning, and the scope decisions (no Telegram Mini App template,
  Global Wallet deferred). Every gotcha has a test in `src/constants.test.ts` and is listed in
  `src/tools/knownGotchas.test.ts`; add both when you add one. The sponsorship gotcha must keep
  saying "canary" and "audit" for the tiered v2, and only the stable facts (the free-tier numbers, projects
  keyed by Privy app id, anyone can deposit, deposits one-way).

## Scope boundary

This package's brief was to work only inside `packages/mcp/` and `skills/`. Do not edit
`packages/sdk`, `docs/`, `templates/`, or `contracts/` from within this package's tooling or
scripts — other work happens there independently.
