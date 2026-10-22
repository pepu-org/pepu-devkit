# PEPU Alto Bundler

A self-hosted ERC-4337 bundler for PEPU mainnet (chain **97741**), running
[Pimlico's Alto](https://github.com/pimlicolabs/alto) (`@pimlico/alto@0.0.21`,
the current `latest` npm tag as of 2026-09-24 -- there is no newer stable
release to upgrade to).

**This is a bundler, not gas sponsorship.** It lets a Kernel v3 smart account
submit a UserOperation and have it included on-chain. On its own, the
sender pays its own gas (exactly like a normal `eth_sendTransaction`, just
routed through ERC-4337 instead of directly). The paymaster -- the thing that
lets an app pay gas on a user's behalf -- is a separate service
(`services/paymaster/`) and is **not** part of this one. Pairing the two is
what produced the sponsored transaction described below.

## Status at a glance

- **Proven live on PEPU mainnet:** this bundler, together with the paymaster
  policy service, carried a sponsored UserOperation from a zero-balance Kernel
  smart account, paid for by the paymaster's EntryPoint deposit. That is the
  third onboarding pillar (alongside Google login with an embedded wallet and
  Privy session signers) proven end to end.
- **Hosted.** PEPU runs it at `https://bundler.pepeunchained.com` (nginx + pm2; see `deploy/hosting`), and a sponsored operation has gone through it on mainnet (v1 history tx `0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f`; v2 tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`). See "Going to production" at the end of this file.

## Status (verified 2026-09-24)

- **`eth_estimateUserOperationGas` works** against the live EntryPoint v0.7
  (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) for a real, counterfactual
  Kernel v3.1 smart account on PEPU mainnet.
- **`eth_sendUserOperation` works end to end** -- two real UserOperations
  landed on PEPU mainnet during verification, one deploying a Kernel account
  from nothing, one reusing it. See "Proof of life" below for transaction
  hashes.
- Getting there required **finding and working around a real bug in Alto
  0.0.21** (`safe-mode: true` cannot complete `eth_sendUserOperation` at
  all, for any UserOperation, valid or not). See "The safe-mode bug" below
  -- this is the single most important thing to understand about this
  service's current configuration before touching it.

## What this service is

One Alto process, listening on port `4337`, backed by:
- PEPU mainnet's RPC (Conduit, chain 97741) as its view of the chain.
- One executor EOA (`BUNDLER_ADDRESS`,
  `0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e`) that actually signs and
  submits the `handleOps` transactions bundles get wrapped into. This EOA
  pays L1/L2 gas for every bundle; it is reimbursed by each UserOperation's
  sender out of that sender's own EntryPoint deposit -- it is not a
  sponsor, it fronts gas per-bundle and gets paid back per-bundle.

It supports both EntryPoint v0.6 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`)
and v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). Every verification
in this document used v0.7, which is what `packages/sdk`'s Kernel v3.1
integration targets.

## Requirements

- Node.js (verified with v24.4.1; Alto's own engines field is more
  permissive but this is what was actually used).
- Network access to a PEPU mainnet RPC endpoint (Conduit; the URL embeds an
  API key, see Configuration below).
- A funded executor EOA private key (see "What must stay funded").
- No Docker daemon was available in the environment this service was
  developed in, so `docker-compose.yml` is written from verified facts (see
  its own header comment) but has **not** been executed here -- treat it as
  unverified until someone runs it and reproduces the checks below.

## Configuration

Two files carry configuration, split deliberately by sensitivity:

### `alto.config.json` (committed, no secrets)

| Key | Value | Why |
|---|---|---|
| `entrypoints` | v0.7 + v0.6 addresses | Both are deployed and reachable on PEPU mainnet (confirmed live via `eth_supportedEntryPoints`); v0.7 is the one every other verification in this doc uses. |
| `deterministic-deployer-address` | `0x4e59...4956` | The standard Nick's-method CREATE2 deployer. Alto uses this to deploy its own simulation contracts (`EntryPointSimulations`, `PimlicoSimulations`) to deterministic addresses the first time it runs against a chain. |
| `deploy-simulations-contract` | `true` | Required so Alto self-deploys those simulation contracts on first run rather than expecting them pre-deployed. Confirmed working: the bundler's startup log shows `"Contracts used for simulation"` followed by successful reads against them. |
| `chain-type` | `"arbitrum"` | PEPU is an Arbitrum Orbit (Nitro) chain. This flag exists specifically so Alto accounts for Nitro's dual-fee gas model (L2 execution gas *and* a separate L1 data-posting fee) when estimating and pricing UserOperations, instead of treating it like a plain single-fee L2/L1. This is the reason Alto was chosen over a naive bundler implementation in the first place. |
| `arbitrum-base-fee-multiplier` | `"150"` | A 1.5x safety multiplier Alto applies on top of the L2 base fee it reads from the chain when it's in `arbitrum` chain-type mode, so a fee spike between estimation and inclusion doesn't strand an already-signed UserOperation. `150` (not `1.5`) because Alto's own flag takes an integer percentage. Not independently load-tested against PEPU's real fee volatility -- carried over as a sane starting default, flagged here as unverified under load. |
| `eip-7702-support` | `true` | Costs nothing to enable and future-proofs against EOA-as-smart-account flows; not otherwise exercised by anything in this verification. |
| `legacy-transactions` | `false` | PEPU mainnet supports EIP-1559 transactions (used throughout this doc's real transactions, e.g. `maxFeePerGas`/`maxPriorityFeePerGas`); no reason to fall back to legacy gas pricing. |
| `is-gas-free-chain` | `false` | PEPU is not gas-free -- every real transaction in "Proof of life" below cost real PEPU. |
| `safe-mode` | **`false`** | **Was `true`. Changed 2026-09-24 after discovering it makes `eth_sendUserOperation` completely non-functional on this Alto version -- see "The safe-mode bug" below before changing this back.** |
| `dangerous-skip-user-operation-validation` | `false` | Never enable this outside of throwaway local testing -- it disables UserOperation validation entirely. |
| `enable-debug-endpoints` | `false` | Debug RPC methods (mempool dumps, manual bundling triggers, etc.) are not needed for normal operation and shouldn't be exposed. |
| `enable-cors` | **`true`** | **Was `false`. Changed 2026-09-30 after confirming the browser demo calls this bundler directly (Privy's smart-account client hits `eth_estimateUserOperationGas` from `http://localhost:3000`) and the missing preflight response was the entire cause of a `Failed to fetch` blocking the first sponsored transaction -- see "The CORS bug" below before changing this back. |
| `multicall3-address` | canonical Multicall3 deployment | Used internally by Alto for batched reads during simulation/estimation. |
| `refilling-wallets` | `false` | There is currently only one executor key and no separate funded treasury/utility wallet in scope to refill it from (see `.env.example`'s note on `ALTO_UTILITY_PRIVATE_KEY`). Documented gap, not an oversight -- see "Known gaps." |
| `port` | `4337` | The bundler's JSON-RPC port. Standard ERC-4337 bundler port convention. |
| `block-time` | `5000` | How often (ms) Alto polls for new blocks / re-evaluates its mempool. 5s is a reasonable default; not tuned against PEPU's actual observed block time. |
| `log-level` | `"info"` | Verbose enough to see every request/response and validation trace (essential for the debugging in this document) without debug-level noise in steady state. |
| `json` | `true` | Structured JSON logs, so they're machine-parseable for any future log shipping. |

### `.env` (gitignored, never committed -- copy `.env.example` to create it)

| Variable | What it is | Why it's a secret |
|---|---|---|
| `ALTO_RPC_URL` | PEPU mainnet RPC URL | The Conduit API key is embedded as a URL path segment, so the whole URL is a secret, not just "a config value." |
| `ALTO_EXECUTOR_PRIVATE_KEYS` | Comma-separated executor EOA private key(s) | Controls real funds and can submit real transactions. Currently one key (`BUNDLER_PRIVATE_KEY` from `../../deploy/.keys.env`). The architecture review (sec 1.4) recommends 3-5 executor keys in production so one bundle-in-flight doesn't block the next; only one funded key exists in scope today -- documented gap, see "Known gaps." |
| `ALTO_UTILITY_PRIVATE_KEY` | Refills executor wallets below `--min-executor-balance` | Deliberately unset in `.env.example`'s guidance (no separate funded treasury key exists yet); if your local `.env` has it set, that's a later addition -- wire it up alongside setting `refilling-wallets: true` once a real treasury key exists, don't just set the env var alone. |

Alto's CLI is built on yargs with `.env("ALTO")` enabled (verified in
`src/cli/alto.ts` of `pimlicolabs/alto@0.0.21`), so every `ALTO_`-prefixed
environment variable maps automatically onto the matching
`--kebab-case-flag`. This is the *only* mechanism used to hand Alto its RPC
URL and private keys -- never written into `alto.config.json` (committed)
and never passed as CLI arguments (would leak into `ps`/shell history).

## Running it

```bash
cp .env.example .env
# edit .env: fill in ALTO_RPC_URL and ALTO_EXECUTOR_PRIVATE_KEYS

npm install
npm start          # alto run --config alto.config.json, listens on :4337
```

Confirm it's alive:

```bash
npm run healthcheck
```

or manually:

```bash
curl -s -X POST http://localhost:4337 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# -> {"jsonrpc":"2.0","id":1,"result":"0x17dcd"}   (97741, PEPU mainnet)
```

### Docker

The image is now built from `Dockerfile`: npm `@pimlico/alto` **0.0.21** (the
version proven live in this README) on `node:24.4.1-bookworm-slim`, non-root,
with secrets accepted as `ALTO_RPC_URL_FILE` / `ALTO_EXECUTOR_PRIVATE_KEYS_FILE`
(`docker-entrypoint.sh`). The earlier `ghcr.io/pimlicolabs/alto:v1.2.8` image is
alto 0.0.20 and is no longer used. `docker-compose.yml` here is for local use
(loopback port, healthcheck on the real port 4337; the old probe hit 3000 and
could never pass). For production hosting behind TLS, rate limits and an Origin
allowlist use `../../deploy/hosting/docker-compose.yml` and its
[RUNBOOK](../../deploy/hosting/RUNBOOK.md). None of it has been executed yet
(no Docker daemon was available): reproduce the checks in this README first.

## The safe-mode bug

This is the most important thing in this document. **Do not flip
`safe-mode` back to `true` without reading this first.**

### What happened

With `safe-mode: true` (Alto's default, and this service's original
setting), `eth_estimateUserOperationGas` worked correctly, but
**`eth_sendUserOperation` failed for every UserOperation tested, including
fully valid, correctly-signed ones.** The failure wasn't a normal
JSON-RPC error -- it was an HTTP 500 with a raw decode exception:

```
"Encoded error signature \"0x99410554\" not found on ABI.
Make sure you are using the correct ABI and that the error exists on it. ..."
```

### Root cause (traced to the exact line, in the exact installed version)

`0x99410554` is the selector for EntryPoint v0.7's own
`DelegateAndRevert(bool success, bytes ret)` error -- confirmed by hashing
the signature directly (`keccak256("DelegateAndRevert(bool,bytes)")`).
This is not a real failure signal; `delegateAndRevert` is EntryPoint's
documented pattern for running a simulation without persisting its state
changes: it always reverts, wrapping whatever the simulation actually
returned (success *or* failure) inside that error.

Alto's own `PimlicoSimulations.sol` contract (bundled in
`node_modules/@pimlico/alto/contracts/src/PimlicoSimulations.sol`,
`_simulateEntryPoint`) is supposed to catch this at the Solidity level,
unwrap it, and return normally on success. But the *decoding* Alto's
Node.js side does over the raw `debug_traceCall` trace, in
`node_modules/@pimlico/alto/esm/rpc/validation/SafeValidator.js`
(`getValidationResultWithTracerV07`, around the
`decodeErrorResult({ abi: pimlicoSimulationsAbi, data: resultData })`
call), uses `pimlicoSimulationsAbi`
(`node_modules/@pimlico/alto/esm/types/contracts/PimlicoSimulations.js`)
to decode it -- and **that ABI defines zero error types.** Confirmed by
loading it directly:

```js
const { pimlicoSimulationsAbi } = await import(
  "./node_modules/@pimlico/alto/esm/types/contracts/PimlicoSimulations.js"
);
pimlicoSimulationsAbi.filter(x => x.type === "error").length; // 0
```

So `decodeErrorResult` throws `AbiErrorSignatureNotFoundError` for the
outermost trace frame's revert data on *every* call through this path --
regardless of whether the underlying UserOperation was valid -- and
because that thrown error is a plain `Error`, not Alto's own `RpcError`
class, it isn't caught as a structured JSON-RPC error. It bubbles all the
way up to the generic top-level handler in
`node_modules/@pimlico/alto/esm/rpc/server.js` (the `else if (err
instanceof Error)` branch, logged as `"error reply (non-rpc)"`), which just
serializes `err.message` as a 500.

**This is confirmed still present on the `pimlicolabs/alto` `main` branch
as of 2026-09-24** (fetched live from GitHub during this investigation --
`src/rpc/validation/SafeValidator.ts` line ~486 and
`src/types/contracts/PimlicoSimulations.ts` are structurally identical to
the installed 0.0.21 build in this respect). `0.0.21` is also still npm's
`latest` tag -- there is no newer stable release to upgrade to that might
fix this.

### How this was proven (not assumed)

1. Built a real, correctly-signed UserOperation (see "Proof of life"
   below) and sent it through the production bundler (port `4337`,
   `safe-mode: true` at the time) -- got exactly the `0x99410554` decode
   failure above.
2. Started a second, isolated Alto instance on port `4338` with
   `safe-mode: false` and every other setting identical
   (`alto.config.unsafe-diagnostic.json` -- kept in this repo as a
   ready-made way to spin up an isolated second instance for future
   comparisons like this one without touching the production process).
3. Sent the *exact same* signed UserOperation to that instance. It was
   accepted, bundled, and landed on-chain successfully (see "Proof of
   life"). This is what proves the signature/UserOperation construction
   was correct all along, and that `safe-mode: true` was the actual
   blocker -- not chain-specific gas estimation, not the signature scheme,
   not the Kernel account.

### The trade-off of `safe-mode: false`

`safe-mode: true` runs each incoming UserOperation through Alto's ERC-7562
storage-access-rule tracer before accepting it -- rejecting ops that touch
storage slots or opcodes outside what the spec allows for a public,
adversarial mempool (this exists to stop a UserOperation that's valid at
submission time from being crafted to behave differently at inclusion
time, griefing a shared mempool). With it off, that extra check is gone;
Alto still runs full validation (signature, prefund, gas), just without
the ERC-7562 storage/opcode tracer layer on top.

For a bundler like this one -- not gossiping to a public p2p mempool,
receiving UserOperations directly and only from this monorepo's own
backend -- the attack this protects against (a third party crafting an op
that grief a shared mempool of other bundlers/relayers) largely doesn't
apply yet. It becomes a real concern the moment this bundler's RPC is
exposed to untrusted submitters. **Re-enabling `safe-mode: true` should be
retried the next time `@pimlico/alto` cuts a release past 0.0.21** (check
`https://github.com/pimlicolabs/alto/releases` and the npm `latest` tag)
-- if `pimlicoSimulationsAbi` has been given real error definitions, or
`SafeValidator`'s decode call is wrapped defensively, this bug is likely
fixed and safe-mode should go back on and be re-verified with
`scripts/estimate-kernel-userop.mjs --send`.

## The CORS bug

### What happened

A browser at `http://localhost:3000` calling this bundler through a
temporary public tunnel failed with `Failed to fetch` during `eth_estimateUserOperationGas` -- the first
step of the first sponsored transaction. This was confirmed to be a CORS
problem and nothing else, before touching any config:

- A plain `curl` POST through the same tunnel worked (`eth_chainId` ->
  `0x17dcd`), proving the tunnel and Alto itself were healthy -- not a
  tunnel interstitial page or a dead process.
- A CORS preflight (`OPTIONS` with `Origin: http://localhost:3000` and
  `Access-Control-Request-Method: POST`) returned **HTTP 404 with no
  `access-control-*` headers at all**. Alto wasn't refusing the preflight
  with a CORS-specific denial; it had no route for `OPTIONS` whatsoever, so
  the browser never got permission to send the real `POST` and gave up.

### Root cause

`enable-cors` was `false`. Verified against the exact installed version
(`pimlicolabs/alto@0.0.21`, `node_modules/@pimlico/alto`) rather than
assumed:

- `esm/cli/config/options.js` defines `enable-cors` as a plain
  `{ type: "boolean", default: false }` yargs flag ("Enable CORS for local
  bundler access") -- there is no origin-list or string form to opt into
  instead of the boolean in this version.
- `esm/rpc/server.js` shows exactly what the flag controls:
  `if (config.enableCors) { this.fastify.register(cors, { origin: true }) }`.
  `@fastify/cors` with `origin: true` reflects whatever `Origin` header the
  caller sent (and, as a side effect of registering the plugin at all,
  answers `OPTIONS` preflights correctly) -- it is not a configurable
  allowlist. With the flag off, `@fastify/cors` is never registered, so
  Fastify has no handler for `OPTIONS` at all, which is exactly the bare
  404 observed.

### The fix

1. `alto.config.json`: `"enable-cors": false` -> `true`.
2. Restarted the Alto process so it picked up the change. **Killed by PID
   via the port**, not `pkill`: `Get-NetTCPConnection -LocalPort 4337` to
   find the `OwningProcess`, then `Stop-Process -Id <pid> -Force`. On this
   Windows setup, `pkill` from Git Bash does not reliably terminate
   Windows-native `node.exe` processes and has previously left stale
   servers running on the port while a *new* process also started,
   silently serving old config from behind it. Confirmed the replacement
   process's `Get-Process -Id <pid> | Select StartTime` postdates the
   config file's `LastWriteTime` before treating the restart as real.
3. Did **not** touch the tunnel. A tunnel is a dumb TCP/HTTP forwarder with
   no opinion on CORS; the fix lives entirely on the Alto side, and the public
   URL was unchanged -- restarting the tunnel would have invalidated the URL
   already pasted into Privy's dashboard as this app's bundler endpoint.

### Verified after the fix

`OPTIONS` through the tunnel's public URL, `Origin: http://localhost:3000`:

```
HTTP/1.1 204 No Content
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Origin: http://localhost:3000
Vary: Origin, Access-Control-Request-Headers
```

A normal `POST` through the same public URL still returns a correct
JSON-RPC result with `Access-Control-Allow-Origin` echoed back, so a
browser can both send the request and read the response.

The paymaster service (`services/paymaster/policy-service`) is *also*
called directly from the browser -- Privy's SDK posts to whatever
paymaster URL is configured in its dashboard, client-side, exactly like the
bundler. It already had an explicit `OPTIONS` handler for
`/paymaster/:appToken` (see `policy-service/src/server.ts`'s
`applyPaymasterCorsHeaders`) from earlier work, independent of this fix.
Re-verified live through its own tunnel
(`https://<tunnel-host>/paymaster/<appToken>`): the
preflight returns `204` with `Access-Control-Allow-Origin: *` (its
documented default until `PAYMASTER_RPC_ALLOWED_ORIGINS` is set to a known
frontend origin -- see that service's own README), and a POST against it
returns a normal JSON-RPC body with the same header present. It did not
have this bug.

### Security scope: why `origin: true` (reflect-any-origin) here, and why that's acceptable for now

Enabling CORS on a bundler reachable through a public tunnel means any
website's JavaScript can now get a browser to complete a cross-origin
`eth_estimateUserOperationGas` / `eth_sendUserOperation` call against it,
not just this project's own frontend. Two things bound how much that
actually matters:

- **CORS was never the access boundary.** `Access-Control-Allow-Origin`
  only controls whether a *browser* lets its own page's JS read a
  cross-origin response -- it does nothing to stop a direct HTTP client
  (`curl`, a bot, a script) from calling this endpoint regardless of what
  the header says, and the tunnel already accepted such calls before this
  fix (that's exactly how the `eth_chainId` `curl` check above worked).
  Turning CORS on does not newly expose the RPC endpoint to non-browser
  callers; it only lets *browser*-based callers succeed too.
- **What actually gates cost and abuse sits below this layer, not in
  CORS.** Every UserOperation this bundler accepts still has to pass
  EntryPoint's own signature/nonce/prefund validation -- a browser calling
  from an arbitrary origin cannot forge a valid signature for an account it
  doesn't control, so it cannot get someone else's smart account to move
  funds. The executor wallet only spends real gas on bundles it chooses to
  submit after that validation passes; an invalid or spam op is rejected
  before the executor ever pays for it. Separately, sponsorship itself
  (the part that actually costs PEPU on this project's behalf) is decided
  entirely by the policy service, not by this bundler -- it's gated by a
  per-app URL token, a destination allowlist, and a global daily spend
  ceiling (see `services/paymaster/policy-service/README.md`), and this
  bundler has no visibility into or control over that decision either way.
  Worst case from opening this bundler's CORS is someone using it to relay
  UserOperations it would have accepted from `curl` anyway -- not a new
  way to drain funds or bypass sponsorship policy.

**Could this be scoped to specific origins instead of reflect-any?**
Checked, rather than assumed: no, not through Alto's own config in the
installed `0.0.21`. `enable-cors` is a boolean-only flag (see "Root cause"
above) and `esm/rpc/server.js` hardcodes `{ origin: true }` whenever it's
on -- there is no origin-list form to pass instead. Narrowing this further
would mean either patching the vendored `@pimlico/alto` package (fragile,
lost on every dependency update) or fronting port `4337` with a reverse
proxy that filters the `Origin` header before a request ever reaches Alto
(real option, but a separate piece of infrastructure -- out of scope for
this fix). Revisit if a future `@pimlico/alto` release adds a real origin
allowlist (check `https://github.com/pimlicolabs/alto/releases` the same
way "The safe-mode bug" section above tracks that package).

**This is a development posture, not a production one.** The bundler was
sitting behind a manually-created tunnel with a URL that had been
hand-pasted into Privy's dashboard for one demo app -- reflect-any-origin
CORS is a reasonable trade for getting that demo working today. A real
production deployment should not inherit this as-is: put a real reverse
proxy or gateway in front of the bundler port with an explicit origin
allowlist (or run a future Alto version that supports one natively) before
this bundler is fronting anything other than a single known demo frontend.

## Proof of life

Verified live against PEPU mainnet (chain 97741) on 2026-09-24, using
`scripts/estimate-kernel-userop.mjs`.

**Setup:** a fresh, disposable owner key
(`0xd3df66D9a5098a941579EaCc3549e1d2415e8688`, cached in the gitignored
`.throwaway-owner-key.json`) controlling a counterfactual Kernel v3.1
account computed via the live factory's own `getAddress(...)`
(`0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419`) -- not a re-implemented
CREATE2 hash. That account
(`0xA43CDA364c524551640206A5A22906dBD989F373`) was funded with 20 PEPU from
the bundler EOA (`scripts/fund-address.mjs`) so it could pay its own
EntryPoint prefund; there is no paymaster, so this funding step is
mandatory.

**Gas estimation** (`eth_estimateUserOperationGas`, EntryPoint v0.7),
for the UserOperation that deploys the account and executes a trivial
zero-value self-call:

```
preVerificationGas:    0xc769   (51,049)
verificationGasLimit:  0x51e44  (335,428)
callGasLimit:          0x3fc3   (16,323)
```

**First send** -- deploying the account + validating a real ECDSA
signature (validator `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57`) +
executing the self-call, all in one UserOperation:

- userOpHash: `0xc20a1c642b0b61d4c545de2ec5d333b37440ff8a0b0ec9307b8e64cfe3c6e0f8`
- transaction: `0x8232872612eb500033faf8ef605f7c14f4fef556defdbb4d7c67c1731d0b00d3`
- block: `10521799`
- receipt: `success: true`
- actual gas used: `309,023`; actual cost: `7.725575 PEPU`
- submitted by the bundler's own executor EOA
  (`0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e`), as expected

**Second send** -- re-running the same script against the now-already-
deployed account (proving the script, and the account, are reusable, not
one-shot):

- userOpHash: `0x5154a651b55fc404dd3517243ca052b81652a5e2c2e004845f45dabb8c774620`
- transaction: `0x65ccefc6eafa07c3b0bf2b69c5ef9272b5b93eda3b8b99fd950154035dd569ec`
- block: `10521805`
- receipt: `success: true`
- actual gas used: `126,496`; actual cost: `3.1624 PEPU`
- gas estimate for this non-deploying op was correspondingly smaller:
  `preVerificationGas: 0xbbd8` (48,088), `verificationGasLimit: 0x1573d`
  (87,869)

Both sends happened through an Alto instance with `safe-mode: false` (see
"The safe-mode bug" above for why). The production instance's config now
matches that setting.

**Important caveat on re-running this yourself:** if a long-lived
`alto run --config alto.config.json` process was already running *before*
this config was changed, it is still holding the *old* `safe-mode: true`
config in memory -- Alto reads its config file once at startup, there is no
hot reload. **Restart the bundler process after pulling this change**
(`Ctrl+C` it, then `npm start` again) before trusting `eth_sendUserOperation`
against it.

## Re-running the end-to-end test

`scripts/estimate-kernel-userop.mjs` is written to be run again --
including after the paymaster (`services/paymaster/`) lands, to confirm
the bundler side still works before layering sponsorship on top.

```bash
node scripts/estimate-kernel-userop.mjs            # estimate only, no funds needed beyond gas
node scripts/estimate-kernel-userop.mjs --send     # estimate, then actually submit + poll for a receipt
```

It reuses the same cached throwaway owner key/account across runs
(`.throwaway-owner-key.json`, gitignored) and detects whether that account
is already deployed, so it's safe to run repeatedly -- it won't try to
redeploy an already-deployed account, and will pick up whatever the
account's real current nonce is. It needs the target account to hold a
little PEPU to pay for its own prefund (`scripts/fund-address.mjs` can top
it up from the bundler EOA); it does **not** need or use
`ALTO_EXECUTOR_PRIVATE_KEYS` itself -- that's the bundler's own secret, not
this script's.

## Monitoring

```bash
npm run healthcheck
```

runs `scripts/healthcheck.js`, which checks four independent things and
reports each one separately (so "bundler down" and "RPC down" and
"executor wallet broke" don't get collapsed into one vague alert):

1. **Bundler responding** -- `eth_chainId` against the bundler's own port,
   and that it's actually PEPU mainnet (`0x17dcd`).
2. **Chain RPC reachable** -- `eth_blockNumber` against `ALTO_RPC_URL`
   directly, bypassing the bundler, to isolate a Conduit RPC outage from a
   bundler-process outage.
3. **EntryPoint reachable** -- `eth_supportedEntryPoints` returns both
   expected addresses (v0.6 and v0.7).
4. **Executor EOA funded** -- every key in `ALTO_EXECUTOR_PRIVATE_KEYS` is
   resolved to its public address only (the key itself is never printed,
   logged, or returned) and that address's real on-chain PEPU balance is
   compared against a minimum threshold (default 500 PEPU, override with
   `ALTO_HEALTHCHECK_MIN_EXECUTOR_BALANCE_PEPU`). 500 was chosen because
   every real UserOperation observed in "Proof of life" cost 3-8 PEPU in
   gas -- 500 PEPU is dozens of operations of runway, meant to fire an
   alert with time to react, not as a "you're about to fail" tripwire.

Exit code `0` = healthy, `1` = at least one check failed. Wire this into
whatever this deployment's process supervisor/uptime checker is (cron +
alert, a systemd `ExecStartPost`, a container healthcheck, etc.) --
`docker-compose.yml`'s own `healthcheck:` block does the equivalent
`eth_chainId` check from inside the container.

### What to alert on

- Any `healthcheck` failure (see above) -- especially executor balance,
  since a broke executor EOA means the bundler silently stops being able
  to submit bundles even though it keeps answering `eth_estimateUserOperationGas`
  successfully (estimation doesn't need the executor to have funds; sending
  does).
- Alto process exit/crash (process supervisor should restart and alert).
- A sustained rise in `eth_sendUserOperation` error rate -- especially
  anything resembling the `0x99410554`/`AbiErrorSignatureNotFoundError`
  signature from "The safe-mode bug" above, which would mean `safe-mode`
  got flipped back to `true` (accidentally or otherwise) without the
  upstream fix having landed.

### What breaks for users when the bundler is down

Every UserOperation-based flow stops -- nothing can be estimated or
submitted through ERC-4337. This does **not** affect a Kernel account's
ability to receive funds or be read (balance checks, `getAddress`
computations) -- those go straight to the chain RPC and don't touch this
service at all. It only affects *sending* UserOperations.

### What must stay funded

- **The executor EOA** (`0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e`) --
  pays real gas for every bundle up front, is reimbursed per-UserOperation
  by each sender's EntryPoint deposit. If it runs dry, `eth_sendUserOperation`
  will still be *accepted* by the bundler but bundles will fail to land.
  This is exactly what `healthcheck` check 4 watches.
- **Each smart account that sends a UserOperation without a paymaster** --
  the sender must hold enough native PEPU (either in its own balance or
  already deposited in the EntryPoint) to cover its own prefund. This is a
  per-account concern, not something this service can fix. A sponsored
  UserOperation instead draws on the paymaster's EntryPoint deposit; see
  `services/paymaster/README.md`.

## Known gaps

- **Only one executor key.** The architecture review (sec
  1.4) recommends 3-5 so an in-flight bundle on one nonce can't block the
  next bundle. Only one funded key (`BUNDLER_PRIVATE_KEY`) exists in scope
  today.
- **No utility/refill wallet.** `refilling-wallets: false` and
  `ALTO_UTILITY_PRIVATE_KEY` deliberately unset -- there's no separate
  funded treasury key yet for Alto to refill executor wallets from
  automatically. Today, topping up the executor EOA is a manual step
  (`scripts/fund-address.mjs`, or any normal transfer to
  `0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e`).
- **`safe-mode: false`, tracked as a to-revisit item** -- see "The
  safe-mode bug" above. Not a permanent design decision; a deliberate,
  evidenced, temporary trade-off pending an upstream Alto fix.
- **`docker-compose.yml` unexecuted.** Written from verified image/tag
  facts but never run end-to-end (no Docker daemon in this environment).
- **`arbitrum-base-fee-multiplier: "150"` and `block-time: 5000` are sane
  defaults, not load-tested** against PEPU's actual fee volatility or
  block cadence.
- **No paymaster in this service.** This service, by itself, never sponsors
  gas for anyone. Sponsorship comes from the paymaster contract and policy
  service (`services/paymaster/`) -- do not represent this bundler as
  providing gasless transactions on its own.

## Going to production

What exists today is a development deployment. Before PEPU publishes a
bundler URL for app developers, each of these needs an owner:

- **Stable hosting instead of tunnels.** A server (or container platform)
  with a fixed hostname, TLS, and a reverse proxy in front of Alto. The
  tunnels used so far change URL on restart, which breaks every Privy
  Dashboard that has the old URL pasted in.
- **A process supervisor.** Alto is a plain Node process that reads its
  config once at startup and does not restart itself. Run it under systemd,
  a container restart policy, or equivalent, with `npm run healthcheck` wired
  into the supervisor or an uptime checker. `docker-compose.yml` is written
  but has never been executed (see "Docker"); prove it before relying on it.
- **Secrets management.** `ALTO_RPC_URL` embeds the Conduit API key and
  `ALTO_EXECUTOR_PRIVATE_KEYS` holds a funded key. Keep them in a secrets
  manager or the host's protected environment, never in the repository.
  Plan for key rotation and for more than one executor key.
- **An origin allowlist.** `enable-cors` is boolean-only in Alto 0.0.21 and
  reflects any origin. Put a reverse proxy in front that filters `Origin`,
  or move to an Alto release that supports an allowlist natively.
- **Monitoring and alerting.** Alert on every `healthcheck` failure
  (especially executor balance), process exits, and a sustained rise in
  `eth_sendUserOperation` errors. Ship the JSON logs somewhere searchable.
- **Spend ceilings.** The executor EOA fronts gas for every bundle. Keep its
  balance bounded, top it up on a schedule, and decide who is paged when it
  runs low. Sponsorship spend limits live in the policy service, not here.
- **`safe-mode` decision.** It is off because of the upstream Alto bug
  described above. Re-test on each Alto release, and do not expose the RPC to
  untrusted submitters while it is off without the proxy controls above.
