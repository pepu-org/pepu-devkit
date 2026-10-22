# PEPU Gas Sponsorship — Paymaster Service

An ERC-4337 v0.7 **verifying-mode-only** paymaster for Pepe Unchained V2
(chain 97741): an on-chain contract that pays gas on behalf of a
sponsored `UserOperation` after checking a signature, and an off-chain
policy service that decides *whether* to sign, based on Privy
authentication, a destination allowlist, and a set of spend/count caps.

```
services/paymaster/
  contracts/            Solidity: PepuVerifyingPaymasterV7 (Foundry project)
    deploy-paymaster.sh    deploy script -- PLANS by default, --broadcast to send
    deployed-address.txt   written after a real deploy (gitignored via out/ etc.
                            being ignored is NOT relevant here -- this file is
                            NOT currently gitignored; it holds a public address,
                            not a secret)
  policy-service/        TypeScript: the off-chain decision-and-signing service
    src/                   library code (see "Policy rules" below)
    src/cli/                hash-api-key.ts, reset-circuit-breaker.ts,
                             monitor-deposit.ts
    test/                   vitest unit + cross-check tests (328 tests, 24 files)
    integration-test.mjs    live E2E script: Kernel UserOp -> policy-service
                             -> Alto bundler (see "Integration test" below)
    demo/                   sponsor-with-real-privy-login.mjs -- the same
                             flow, but with a REAL (non-stubbed) Privy login
                             obtained headlessly via SIWE; see demo/README.md
                             for the current live-verified stopping point
    config/                 allowlist.json, apps.json
```

The companion Alto bundler that actually submits `UserOperation`s to the
chain lives in `services/bundler/` (a separate service, out of scope here —
see its own README/AGENTS.md).

## Status at a glance

| | State |
|---|---|
| v1 paymaster contract `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | **Retired.** The EntryPoint deposit was withdrawn (deposit is 0); it cannot sponsor anything. Do not deposit to it. |
| v1 policy service + Alto bundler | **Proven live end to end** on the v1 paymaster (history): a zero-balance Kernel smart account transacted on mainnet from a real Privy login, and a real sponsored op later went through the hosted URLs (tx `0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f`). |
| Public hosting | **Hosted and proven.** Bundler `https://bundler.pepeunchained.com`, paymaster service `https://paymaster.pepeunchained.com` (nginx + pm2; see `deploy/hosting`). The ERC-7677 URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`. |
| Tiered sponsorship v2 (free tier + project deposits) | **Deployed as a canary** at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`: internally reviewed 3x, external audit pending, funded in small tranches. Proven through the hosted URLs (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`). See "Tiered sponsorship v2" below and `SPONSORSHIP-SPEC.md`. |

See "Going to production" at the end of this file for what has to change
before this is a hosted service.

## Why a verifying paymaster, and why the contract has no caps

Upstream (`pimlicolabs/singleton-paymaster`)'s `SingletonPaymasterV7`
supports two modes: **verifying** (an off-chain signer approves) and
**ERC-20** (the user pays gas in a token). This fork deletes ERC-20 mode
entirely — see `contracts/src/PepuVerifyingPaymasterV7.sol`'s top-level
NatSpec for the exact diff — because on PEPU, sponsorship is always
free-to-user, and every line implementing a payment mode nobody uses is
just unused attack surface for a fork whose entire security model rests on
"the contract does exactly what the audited upstream code does, verifiably."

The contract's job, after that deletion, is narrow and mechanical: check
that a `paymasterAndData` blob carries a valid ECDSA signature from an
authorized signer, over an approved time window, and if so, pay gas from
its own EntryPoint deposit. **It enforces no spending cap of its own.**
Every economic safeguard — per-user limits, a destination allowlist,
per-app budgets, a circuit breaker — is enforced entirely off-chain, by the
policy service, *before* it ever produces a signature. This is a
deliberate design, not an oversight, and it has a direct consequence for
the threat model below: **the contract's only defense against
over-sponsorship is "the policy service never signs the bad request."**

## The byte-layout cross-check (read this before touching either side)

The single most dangerous failure mode in this system is a one-byte
disagreement between what the contract hashes and what the policy service
hashes: the failure mode isn't a clean error, it's an opaque `AA33
reverted` from the bundler, discovered whenever someone actually tries to
submit a sponsored op. This was cross-checked and pinned with a shared
fixed test vector, verified in both directions in the same session:

- **Contract side:** `contracts/test/PaymasterHashCrossCheck.t.sol` builds a
  fully-specified `PackedUserOperation` + paymaster config and calls the
  real `getHash(0, userOp)` on a real deployed (test-only) instance.
- **Service side:** `policy-service/test/paymasterHashCrossCheck.test.ts`
  calls the real, shipped `buildPaymasterHashPrefix` (`paymasterData.ts`) +
  `computeUserOpHash` + `computeFinalHash` (`userOpHash.ts`) against the
  *identical* vector.
- Both independently produced
  `0x1ed67e1dbe62fb3e76e1fb19b74cc649cdac16c7782ed62714643c9beb88b393`,
  which is now frozen as `EXPECTED_GOLDEN_HASH` in both files. **If either
  implementation's field order, packing, or arithmetic ever drifts, its own
  test fails against this frozen constant** — the two files never need to
  talk to each other or share a build step to catch drift.

The agreed spec, restated plainly: the contract hashes
`sender, nonce, accountGasLimits, preVerificationGas, gasFees,
keccak256(initCode), keccak256(callData), keccak256(paymasterAndData[0:65])`,
then `keccak256(abi.encode(that, chainid))`, EIP-191-signed. The service
emits `paymasterAndData[0:65]` as exactly `paymaster(20) ‖
paymasterVerificationGasLimit(16) ‖ paymasterPostOpGasLimit(16) ‖
mode(1)=0x00 ‖ validUntil(6) ‖ validAfter(6)`. Confirmed, byte for byte, in
this session — not merely re-asserted from the earlier engineering brief.

Run both halves of the cross-check yourself:

```bash
# Solidity side (from services/paymaster/contracts/, via WSL/upstream Foundry):
forge test --match-contract PaymasterHashCrossCheckTest -vv

# TypeScript side (from services/paymaster/policy-service/):
npm test -- test/paymasterHashCrossCheck.test.ts
```

## Running the contracts (Foundry)

```bash
cd services/paymaster/contracts
forge test                 # 18/18 passing: 17 security tests + the cross-check
```

Uses upstream Foundry under WSL (`~/.foundry/versions/stable/{forge,cast}`),
**not** foundry-zksync, which shadows `forge`/`cast` on PATH on this
machine — matching the convention already established by
`contracts/permit2/deploy-permit2.sh` elsewhere in this repo.

### Deploying

```bash
bash services/paymaster/contracts/deploy-paymaster.sh
```

This **only plans** — it rebuilds from source, reconfirms the creation
bytecode hasn't drifted (refuses to proceed if it has), prints the
deployer, owner, manager, initial signer, initial EntryPoint deposit,
initial stake (if any), and verifier config, checks whether a deployment
is already recorded, and exits. It sends **zero transactions** in this
mode. This was run for real (dry-run only) against live PEPU mainnet in
this session — confirmed reading `chain id 97741`, the real deployer's
address and balance (~9,961 PEPU at the time), and a reconfirmed creation
bytecode hash, then exiting without broadcasting.

To actually deploy (real PEPU moves — deposits an initial EntryPoint
balance, optionally adds stake, and verifies on pepuscan):

```bash
bash services/paymaster/contracts/deploy-paymaster.sh --broadcast
```

Configurable via env vars before running (all optional, sane defaults —
see the script's own header comment for the full list and reasoning):
`PAYMASTER_OWNER_ADDRESS`, `PAYMASTER_MANAGER_ADDRESS` (default: the
deployer — no dedicated admin key exists yet), `PAYMASTER_INITIAL_DEPOSIT_ETH`
(default `0.05`), `PAYMASTER_INITIAL_STAKE_ETH` (default `0`, skipped —
staking isn't required for this contract's correctness, see the script's
comment on EIP-7562 storage rules).

After a real deploy, set `policy-service/.env`'s `PAYMASTER_CONTRACT_ADDRESS`
to the printed address, and add its address to
`policy-service/config/allowlist.json` if the policy service itself will
ever be asked to sponsor calls *to* the paymaster (unlikely, but the
allowlist is checked against whatever the decoded `UserOp` calls).

### Deposit management

Once deployed, `policy-service/src/cli/monitor-deposit.ts` monitors and
tops up the contract's EntryPoint balance:

```bash
cd services/paymaster/policy-service
npm run monitor-deposit -- status              # one-shot, read-only, exit code reflects health
npm run monitor-deposit -- watch                # read-only polling loop, prints ALERT when low
npm run monitor-deposit -- top-up               # PLANS a top-up (no tx sent)
npm run monitor-deposit -- top-up -- --broadcast  # actually sends the top-up
```

`status`/`watch` never touch a private key. `top-up --broadcast` needs
`FUNDING_PRIVATE_KEY` (falls back to `DEPLOYER_PRIVATE_KEY` from
`deploy/.keys.env` if unset — there is no dedicated funding key
provisioned yet). The top-up arithmetic
(`policy-service/src/depositMonitor.ts`, unit-tested in
`test/depositMonitor.test.ts`) is deliberately conservative: it only tops
up when the deposit is *below* `DEPOSIT_LOW_WATER_MARK_WEI` (default
0.02), brings it back to `DEPOSIT_TOP_UP_TARGET_WEI` (default 0.05), and
**never** pushes the balance above `DEPOSIT_MAX_CEILING_WEI` (default
0.10) even if the target is misconfigured above it — the ceiling always
wins. This is the whole point: keep the float small on purpose, so a
signer-key compromise (see "Threat model" below) is bounded by whatever
the ceiling is set to, not by however much happens to be sitting in the
deposit.

Proven live in this session: `monitor-deposit.ts status`, pointed (for
verification purposes only) at the live EntryPoint's own address, made a
real `eth_call` against PEPU mainnet, correctly read a `0` balance, and
printed a correctly-computed `ALERT` line — confirming the chain-reading
and threshold logic work end to end against the real chain, ahead of a
real paymaster deployment to point it at.

## Running the policy service

```bash
cd services/paymaster/policy-service
npm install
cp .env.example .env        # fill in PRIVY_APP_ID/SECRET (from repo-root .env)
                             # and PAYMASTER_CONTRACT_ADDRESS (after deploying)
npm run build && npm start  # or: npm run dev (rebuild+restart on change)
```

**Why `npm run build && node dist/index.js` instead of running the
`.ts` files directly:** this package's source uses `.js`-suffixed relative
imports throughout (e.g. `import ... from "./config.js"` inside a `.ts`
file), which `tsconfig.json`'s `moduleResolution: "Bundler"` accepts at
typecheck time (confirmed: `tsc --noEmit` passes clean) but which Node's
own built-in TypeScript support, on this machine's Node v24.4.1, does
**not** resolve — running `node --experimental-strip-types src/index.ts`
directly fails immediately with `ERR_MODULE_NOT_FOUND`, confirmed directly
in this session with a minimal two-file repro isolating the exact
behavior. `tsup.config.ts` (added this session) builds real `.js` output
via esbuild, which resolves this correctly; `package.json`'s `start`/`dev`
scripts were updated to build-then-run accordingly.

Endpoints (`src/server.ts`):

| Method + path | Purpose |
|---|---|
| `GET /health` | liveness probe |
| `POST /sponsor` | evaluate a sponsorship request (see below) |
| `POST /admin/circuit-breaker/reset` | admin-only (requires `X-Admin-Token` matching `ADMIN_TOKEN`); clears the global circuit breaker |

**Proven live in this session**, against the real compiled `dist/index.js`
(real `PrivyClient` construction, real signer-key load + address
validation against `deploy/.keys.env`, real sqlite db):

```
$ curl http://127.0.0.1:8788/health
{"status":"ok"}                                                     HTTP 200

$ curl -X POST http://127.0.0.1:8788/sponsor -H 'X-Api-Key: whatever' -d '{"userOp": {...}}'
{"status":"denied","reason":"invalid_or_expired_token",
 "message":"Missing or empty Authorization bearer token."}          HTTP 401

$ curl -X POST http://127.0.0.1:8788/sponsor -H 'Authorization: Bearer this.is.not.a.real.jwt' ...
{"status":"denied","reason":"invalid_or_expired_token",
 "message":"The Privy access token is missing, expired, or does not verify."} HTTP 401
```

The third call is the most meaningful proof: it exercised a **real network
round trip to Privy's own JWKS endpoint** (not a local stub) and correctly
rejected a garbage token.

Automated tests (`npm test`, vitest): **328 tests across 24 files, all
passing** at the time of writing. They cover every policy rule below
(`policyEngine.test.ts`), the ERC-7677 surface (`paymasterRpc.test.ts`),
the Kernel call-data decoder, Privy token verification, the allowlist, the
deposit monitor, the byte-layout cross-check, and the v2 sponsorship code
under `test/sponsorship/`.

### A real bug found and fixed while getting this to actually run

`src/db.ts` originally did a plain `import { DatabaseSync } from
"node:sqlite"`. This typechecks fine and runs fine under plain `node`, but
**fails under this exact vitest/vite-node version** (2.1.9 / vite 5.4.21):
vite-node's own builtin-detection (`isNodeBuiltin` in its `utils.mjs`)
hardcodes a short exception list for prefix-only built-ins (`node:test`)
that predates `node:sqlite`'s existence, so it gets misresolved as a
missing bare npm package called `sqlite` and the whole test file fails to
load. Traced this into vite-node's own source in this session; confirmed
no public config option (`server.deps.external`, string or RegExp) changes
the outcome, since the failure happens in a code path that config doesn't
reach. Fixed by fetching the module via `process.getBuiltinModule("node:sqlite")`
(a plain runtime function call, invisible to any bundler/test-runner's
static import analysis) instead of a static `import` — behaviorally
identical in production (confirmed), and the only change needed to make
the existing, already-reviewed `db.ts` logic actually testable. See that
file's doc comment for the full account.

## Policy rules

Enforced in this order by `src/policy.ts`'s `PolicyEngine.evaluate` (every
step, approved or denied, writes an audit-log row — `src/db.ts`'s
`audit_log` table):

1. **Privy token verification** (`src/privyAuth.ts`) — the bearer token
   must verify against Privy's JWKS. Missing/invalid/expired →
   `invalid_or_expired_token`.
2. **Sender ownership** — the decoded `userOp.sender` must be a smart
   wallet actually owned by the authenticated Privy user (a real API call
   to Privy, `getBySmartWalletAddress`, fail-closed on *any* error —
   a stolen-but-valid token cannot sponsor gas toward an attacker-chosen
   sender it doesn't own). Denial: `sender_not_owned_by_token_user`.
3. **App resolution** — the caller's `X-Api-Key` is hashed (sha256) and
   matched against `config/apps.json`'s stored hashes (never a raw key
   comparison, never a client-declared app id taken at face value).
   Denial: `unknown_or_invalid_app_credential`.
4. **CallData decode** (`src/kernelDecoder.ts`) — must be a Kernel v3
   `execute(bytes32,bytes)` call, single or batch, `CALLTYPE_SINGLE`/`BATCH`
   only (static-call/delegatecall-flavored execute is always denied
   regardless of destination). Anything else: `calldata_decode_failed`.
5. **Destination allowlist** (`src/allowlist.ts`) — every decoded target
   must be on the **global** allowlist (`config/allowlist.json` — hard
   backstop, config-driven) **AND** on the requesting app's own list
   (`config/apps.json`'s `allowedDestinations`, `"*"` = defer to global).
   This is an AND, not an OR: an app can only narrow the global list, never
   widen it. Denials: `destination_not_globally_allowed`,
   `destination_not_allowed_for_app`.
6. **Per-user count caps** (rolling windows: trailing hour / trailing day
   / all-time) — `USER_HOURLY_COUNT_CAP` / `USER_DAILY_COUNT_CAP` /
   `USER_LIFETIME_COUNT_CAP`. Denials: `user_hourly_count_cap_exceeded`,
   `user_daily_count_cap_exceeded`, `user_lifetime_count_cap_exceeded`.
7. **Per-user spend caps** (same rolling windows, wei) —
   `USER_HOURLY_SPEND_CAP_WEI` / `USER_DAILY_SPEND_CAP_WEI` /
   `USER_LIFETIME_SPEND_CAP_WEI`, checked against a computed
   **worst-case** cost (`src/cost.ts`:
   `(verificationGasLimit + callGasLimit + preVerificationGas +
   paymasterVerificationGasLimit + paymasterPostOpGasLimit) *
   maxFeePerGas` — a ceiling booked at approval time, not the eventual
   actual on-chain cost, which is typically lower due to gas refunds).
   Denials: `user_hourly_spend_cap_exceeded`, `user_daily_spend_cap_exceeded`,
   `user_lifetime_spend_cap_exceeded`.
8. **Per-app spend caps** (calendar-day UTC + optional lifetime, each
   app's own `dailySpendCapWei` / `lifetimeSpendCapWei` in
   `config/apps.json`, `null` lifetime = uncapped). Scoped strictly per
   app — one app's spend never counts against another's cap. Denials:
   `app_daily_spend_cap_exceeded`, `app_lifetime_spend_cap_exceeded`.
9. **Global circuit breaker** — `GLOBAL_DAILY_SPEND_CEILING_WEI`, summed
   across **every** app and user (calendar-day UTC, or since the last
   manual reset, whichever is later). This is the last line of defense:
   even if every per-user/per-app cap has room, aggregate spend across the
   whole service cannot cross this ceiling. Denial:
   `global_circuit_breaker_tripped` (HTTP 503). Manually clearable via
   `POST /admin/circuit-breaker/reset` (needs `X-Admin-Token`) or
   `npm run reset-circuit-breaker` (works directly against the db file,
   no running server needed).
10. **Validity window** — every approval carries `validUntil` /
    `validAfter` (`VALIDITY_WINDOW_SECONDS`, default 90s), bounding how
    long a captured-but-unsubmitted signature stays usable. This is
    *encoded*, not enforced by a revert: the contract packs it into
    `validationData` per ERC-4337 and EntryPoint itself rejects an
    out-of-window op — confirmed by two dedicated Solidity tests
    (`test_TimeWindow_ExpiredIsEncodedNotReverted`,
    `test_TimeWindow_NotYetValidIsEncodedNotReverted`).
11. **Sign** — only after every check above passes, atomically with the
    cap-recording DB write (`recordApprovalIfWithinCaps`, one SQL
    transaction, no `await` between the check and the write — safe under
    concurrency because `node:sqlite`'s `DatabaseSync` is synchronous and
    Node is single-threaded, not because of any lock).

**Denials never consume budget.** A denied request never writes a
`sponsorship_events` row — proven directly by a dedicated test
(`policyEngine.test.ts`: "a denied request does not record a
sponsorship_events row").

Rolling vs. calendar-day windows is a deliberate asymmetry: per-user caps
use a trailing window (a user can't "reset" their cap early by waiting for
UTC midnight); per-app spend and the global breaker use calendar-day UTC
(an explicit, documented allowance, simpler to reason about operationally).

### Configuring it

All caps/thresholds are env vars with defaults in `src/config.ts` — see
`.env.example` for the full list with current defaults. The two config
files:

- `config/allowlist.json` — `{ "destinations": ["0x...", ...] }`. **Ships
  empty.** Every sponsored destination is denied until real, verified
  contract addresses are added here.
- `config/apps.json` — one entry per registered app: `id`,
  `apiKeyHashHex` (compute with `node --experimental-strip-types
  src/cli/hash-api-key.ts <raw-key>`, or after building,
  `npm run hash-api-key -- <raw-key>`), `allowedDestinations` (`"*"` or an
  array), `dailySpendCapWei`, `lifetimeSpendCapWei` (or `null`). Ships with
  one documented example entry (key `example-dev-key-CHANGE-ME`) — replace
  or remove before real use.

## Integration test

`policy-service/integration-test.mjs` builds a real counterfactual Kernel
v3.1 `UserOperation` on PEPU mainnet, requests sponsorship from the policy
service, and (if granted) submits it to the live Alto bundler and polls
for a receipt. Run it from `services/paymaster/policy-service/` (so it
resolves that package's own `viem`):

```bash
node integration-test.mjs
# or, once further along:
PRIVY_ACCESS_TOKEN=eyJ... node integration-test.mjs
```

**Observed result of this script** against the deployed paymaster
(EntryPoint deposit `2000.05 PEPU` at the time, staked) and Alto running on
`:4337` with `safe-mode:false`, without a `PRIVY_ACCESS_TOKEN`:

- **Step 1** (build the counterfactual Kernel account via a real
  `eth_call` to the live `KERNEL_FACTORY`) — **succeeded**, zero balance
  confirmed.
- **Step 2a** (`eth_estimateUserOperationGas` WITH the paymaster fields
  attached, using a well-formed-but-unregistered dummy signature so
  EntryPoint checks the *paymaster's* deposit instead of the sender's zero
  balance) — **succeeded**: `preVerificationGas: 0xd12d`,
  `verificationGasLimit: 0x4897e`, `callGasLimit: 0x78fb`. This is the fix
  for the `AA21 didn't pay prefund` result an earlier version of this
  script hit when it estimated with no paymaster attached at all — see the
  script's header comment for the full explanation of why the dummy
  signature must be well-formed rather than reusing the account-side dummy
  constant.
- **Step 2b** (`POST /sponsor`) — **stopped here**, exactly as designed:
  `401 invalid_or_expired_token` without a real Privy token. Confirmed
  live via `curl` against the same running process, and via this script.

**This script stops at the Privy login by design.** The full flow is proven
elsewhere: with Smart Wallets enabled in the Privy Dashboard (Kernel, chain
97741, bundler URL and paymaster URL), the `sponsored-demo` template ran a
real sponsored transaction in a browser from a zero-balance smart account on
mainnet. The headless `demo/sponsor-with-real-privy-login.mjs` script predates
that run; its `demo/README.md` records the earlier gate it hit
(`403 sender_not_owned_by_token_user`, because Smart Wallets was then off in
the Dashboard). The destination allowlist is no longer empty:
`config/allowlist.json` lists the deployed TapScore contract, which is what
the scripts and the demo call.

## Tiered sponsorship v2 (deployed canary, external audit pending)

A second, separate contract and a set of `/v2/*` routes implement the model
PEPU decided on for public sponsorship:

- **Free tier:** 100 PEPU per user per day and 50 PEPU per user per hour (service config; the original design said 50/day), funded by a free pool the chain
  holds, for **users with a Privy account only** (a verified Privy access
  token is required; there is no anonymous tier). There is no chain-wide daily
  ceiling on the pool: it is bounded by the per-user limit, the 40 PEPU
  per-op cap, an on-chain per-wallet backstop and the pool balance.
- **Project tier:** deposits are one-way: anyone can deposit into any project
  (claimed or not) and nobody can ever withdraw them. A project is one Privy
  app (`keccak256(appId)`); its settings belong to the owner who claims it
  on-chain with a signer attestation (issued after the policy service checks
  the Privy app secret). Pausing is a project's exit.
  A project may sponsor **any wallet**, Privy or not, and the free tier never
  pays for those wallets. Requests are authorised by a project-issued server
  API key (or a publishable token bound to allowed origins), on top of the
  on-chain destination allowlist and per-wallet/daily limits.
- **Ownership:** the deployer owns the contract by default (two-step
  transfer, renounce supported); nothing a project needs depends on the owner.
- **Surplus:** every unused prepay goes back to the exact sponsor that was
  charged; unattributable residue goes to the free pool, never to the owner.

Status, plainly: it is implemented with unit, fuzz and invariant tests
(see the spec for current counts), but **nothing has been deployed to
mainnet, it has not been exercised against the real EntryPoint and Alto
(a fork test is required first), and it has not had an external audit.** The
v1 paymaster above is untouched and remains the only deployed one.

Read next: `SPONSORSHIP-SPEC.md` (design, threat model, numbered open
questions, migration plan) and `policy-service/openapi.yaml` (the API).
`contracts/deploy-sponsored-paymaster.sh` plans by default and only sends
transactions with `--broadcast`. The v2 routes are mounted only when
`SPONSORSHIP_V2_ENABLED=true`.

## Threat model

The contract enforces **no on-chain spending cap.** Every safeguard below
lives in the off-chain policy service. Read this section as a description
of what actually stops each attack — not a scorecard.

- **Drain via loops** (one actor repeatedly requesting sponsorship to
  exhaust the deposit): stopped by the per-user hourly/daily/lifetime
  count AND spend caps (rolling windows — a user cannot "reset" by
  waiting for a calendar boundary), backstopped by the global circuit
  breaker if many users coordinate. Bounded further by keeping the
  EntryPoint deposit itself small (see "Deposit management").
- **Griefing** (submitting sponsored ops that are designed to revert or
  waste gas without doing anything useful for the sponsoring app): the
  destination allowlist limits *what* can be called at all; per-user/app
  caps limit *how much* gas any single actor can consume regardless of
  whether the call succeeds. The worst-case-cost accounting in `cost.ts`
  books the full gas ceiling at approval time, before knowing whether the
  op will actually succeed on-chain, specifically so a griefer can't rely
  on "it reverted, so it was free."
- **Sponsored-tx spam**: the same per-user/per-app count caps, plus the
  destination allowlist (an attacker can't get sponsorship for calls to
  arbitrary contracts, only pre-approved ones), plus the API-key-gated app
  registry (an attacker needs a valid, hashed, registered app credential
  to request sponsorship at all).
- **Stolen Privy tokens**: a stolen-but-valid access token alone is not
  enough — step 2 of the pipeline (`sender_not_owned_by_token_user`)
  independently confirms the `userOp.sender` is actually a smart wallet
  owned by that token's user, fail-closed on any error from that check
  (a network blip is treated as "not proven," never as "assume owned").
  This bounds a stolen token to sponsoring gas only for wallets that user
  actually owns, under that user's own caps — not an open-ended drain.
- **Signer-key compromise**: **this is the one the contract cannot stop
  at all.** The contract's `signers` mapping is the *entire* on-chain
  trust boundary — any signature from an authorized signer key is honored
  up to the deposit's balance, with no additional on-chain check of who
  requested it, what it pays for, or how much. If
  `PAYMASTER_SIGNER_PRIVATE_KEY` is compromised, the attacker can sign
  arbitrary approvals directly, bypassing the policy service (and every
  cap it enforces) entirely, limited only by the EntryPoint deposit's
  current balance. **This is a total-deposit-loss event, bounded only by
  how small the float is kept.** The multi-signer design
  (`MultiSigner.sol`) lets a manager revoke a compromised signer without a
  redeploy — proven by a dedicated Solidity test
  (`test_RemoveSigner_InvalidatesPreviouslyValidSignature`) — but that is a
  *response* after detecting compromise, not a prevention, and detection
  itself depends on operational monitoring that does not exist yet (see
  "Known gaps"). The practical mitigation available today is entirely
  operational: keep the deposit small (`monitor-deposit.ts`'s ceiling),
  top it up incrementally rather than funding it once with a large
  amount, and treat the signer key with the same care as a hot wallet
  holding exactly the deposit's balance — because that is precisely what
  it is.

## Known gaps

- **No on-chain reconciliation.** `cost.ts`'s worst-case accounting is
  never compared against actual on-chain `UserOperationSponsored` events —
  a signer-key-compromise pattern (approved volume diverging from
  on-chain volume) would not be automatically detected. Needs the contract
  deployed and an indexer; explicitly out of scope for this pass.
- **No dedicated funding key** for `monitor-deposit.ts top-up`; it falls
  back to the deploy key. Fine for now (same trust level, already funded),
  worth separating later so the deploy key isn't a routine hot wallet.
- **The global allowlist lists only TapScore** and the app registry holds
  one registered demo app (`sponsored-demo`). Both must be populated with
  real, deliberately chosen values before any other app can be sponsored.
- **Hosted** at paymaster.pepeunchained.com (nginx + pm2). See "Going to production" for what a hosted deployment still needs.
- **`eth_estimateUserOperationGas` ordering** — resolved: both
  `integration-test.mjs` and `demo/sponsor-with-real-privy-login.mjs` now
  attach the paymaster fields (with a well-formed dummy signature) to the
  *first* gas estimate, so EntryPoint checks the paymaster's deposit
  instead of demanding the sender pay its own prefund. See "Integration
  test" above.

## Going to production

Everything above describes a development deployment. To offer sponsorship to
app developers, PEPU needs to decide an owner for each of these:

- **Stable hosting instead of tunnels.** The policy service and the bundler
  need fixed public hostnames with TLS. Tunnel URLs change on restart, and a
  paymaster URL pasted into a Privy Dashboard stops working when they do.
- **A process supervisor.** Run the policy service (`npm run build && node
  dist/index.js`) under systemd, a container restart policy, or equivalent.
  It keeps its state in a SQLite file (`DB_PATH`); put that on durable storage
  and back it up, or move to a managed database before running more than one
  instance (the spend accounting relies on a single process).
- **Secrets management.** `PAYMASTER_SIGNER_PRIVATE_KEY`, `PRIVY_APP_SECRET`,
  `ADMIN_TOKEN`, the Conduit API key and any funding key belong in a secrets
  manager, not in `.env` files on a laptop. The signer key is effectively a
  hot wallet for the whole deposit (see the threat model); plan rotation using
  the contract's multi-signer support, and give deposit top-ups their own key
  instead of the deploy key.
- **Monitoring and alerting.** Alert on `monitor-deposit.ts` low-water
  readings, on a tripped circuit breaker, on policy-service errors, and on a
  divergence between approved volume and on-chain `UserOperationSponsored`
  volume (there is no automatic reconciliation for v1; v2 includes a
  reconciler).
- **Spend ceilings.** Keep the EntryPoint deposit small on purpose, keep the
  global daily ceiling and per-user and per-app caps sized against the real
  cost of an account deployment (about 12 PEPU worst case) and a follow-up
  operation (about 3 PEPU), and keep the allowlist as narrow as the demo
  needs. Registering a new app is a deliberate act, not a default.
- **An origin and rate-limit story.** The ERC-7677 route is called directly
  from browsers with the app token in the URL. Set
  `PAYMASTER_RPC_ALLOWED_ORIGINS` once frontend origins are known, put a
  reverse proxy with rate limiting in front, and treat the full paymaster URL
  as a secret.
- **Audit before v2.** The v2 contract holds third-party money in an
  immutable deployment and has had no external audit. Do not deploy it with
  meaningful deposits, or point Privy at `/v2/paymaster/<token>`, until an
  audit is done and the open questions in `SPONSORSHIP-SPEC.md` (section 14)
  are closed (the decided values are recorded there). Run the canary described in the spec first.
