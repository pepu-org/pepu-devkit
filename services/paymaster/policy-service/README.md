# PEPU paymaster policy service

The off-chain brain behind `PepuVerifyingPaymasterV7` (see
`../README.md` for the on-chain contract, the byte-layout
cross-check, and Foundry tests — this file is the policy-service half
only). The contract enforces **no on-chain spending cap of its own**: it
checks a signature from an authorized signer and pays gas from its own
EntryPoint deposit, full stop. Every economic safeguard — who can ask,
what they can call, how much they can spend, and a global kill switch —
lives here, in this service, and is enforced **before** it ever produces a
signature.

Concretely, this service takes a proposed ERC-4337 v0.7 UserOperation and
either (a) signs `paymasterAndData` for it, or (b) refuses and says
exactly why. Nothing here can move funds anywhere except by *paying gas*
for a call to a pre-approved contract — see "Threat model" below for what
that does and doesn't bound.

## How an app is identified

A caller proves it's a registered app with a raw API key — never a
client-declared app id taken at face value. This service never stores the
raw key: `config/apps.json` stores `sha256(rawKey)` hex, and every
incoming key is hashed and compared (`src/appRegistry.ts`, constant-time
compare via `node:crypto`'s `timingSafeEqual`) against the stored hashes.
Mint a new key with (from this directory, `services/paymaster/policy-service/`):

```bash
npm run hash-api-key -- <your-raw-key>
```

That prints the hash to paste into `config/apps.json`'s `apiKeyHashHex`
field — never the raw key. (Pre-build, the equivalent is
`node --experimental-strip-types src/cli/hash-api-key.ts <raw-key>`, but
`npm run hash-api-key --` is the one that actually exists as a script —
it lives in *this* package's `package.json`, not the repo root's or
`services/paymaster`'s.)

The raw key itself is a credential with two live uses:
- `X-Api-Key` header on `POST /sponsor`.
- The `<appToken>` path segment of `POST /paymaster/<appToken>` (see
  below) — Privy's dashboard "Paymaster URL" field is a bare URL with no
  separate header/secret field, so the key travels in the URL itself for
  that path. **Treat that full URL as a secret**: anyone who has it can
  request sponsorship as that app, subject to every cap below.

## Endpoints (`src/server.ts`)

| Method + path | Purpose |
|---|---|
| `GET /health` | liveness probe, `{"status":"ok"}` |
| `POST /sponsor` | evaluate a sponsorship request directly (this app's own frontend calls this with a Privy access token) |
| `POST /admin/circuit-breaker/reset` | admin-only (`X-Admin-Token` must match `ADMIN_TOKEN`); clears the global circuit breaker |
| `POST /paymaster/:appToken` | ERC-7677 paymaster JSON-RPC — what Privy's smart-wallet SDK (and any other ERC-7677-speaking client) calls directly from the end user's browser |
| `OPTIONS /paymaster/:appToken` | CORS preflight for the above |

### `POST /sponsor`

Body: `{"userOp": {...}}` (v0.7 "unpacked" shape, numeric fields as
`0x`-prefixed hex — see `src/requestSchema.ts`). Headers:
`Authorization: Bearer <privy-access-token>`, `X-Api-Key: <raw-key>`.
Returns `{"status":"approved", ...paymasterData...}` (200) or
`{"status":"denied","reason":"...","message":"..."}` (4xx/5xx — see
"Policy rules" for every `reason` value and its HTTP status).

### `POST /paymaster/:appToken` — ERC-7677 paymaster JSON-RPC

Implements exactly two methods, per [ERC-7677](https://eips.ethereum.org/EIPS/eip-7677)
(`src/paymasterRpc.ts`; method/param/response shapes independently
cross-checked against Pimlico's `permissionless.js` docs and Base's docs
when this was built):

- **`pm_getPaymasterStubData`** — called before gas estimation. Returns a
  syntactically valid but cryptographically meaningless dummy signature
  (a real ECDSA signature over an unrelated hash, from a fresh throwaway
  key — needed because the contract's `ECDSA.recover` reverts on a
  malformed signature rather than failing closed) so
  `eth_estimateUserOperationGas` can simulate without reverting. **This
  path never calls the policy engine, and never resolves or validates the
  `<appToken>` at all** (`src/paymasterRpc.ts`'s `handleStubData` takes no
  `apiKey`/context parameter, by design) — no cap is consumed, no audit row
  is written, because nothing is being approved yet, only estimated. It
  cannot itself ever cause a real sponsorship: a client that skips the
  follow-up call just gets a clean on-chain `sigFailed=1`, never a paid
  transaction.

  **Is this a hole? No — confirmed against ERC-7677's spec text directly**
  (`ethereum/ERCs`, `ERCS/erc-7677.md`, re-read in full, not
  taken on trust): the spec defines `pm_getPaymasterStubData` purely as a
  gas-estimation aid ("Returns stub values ... for gas estimation") and
  `pm_getPaymasterData` as the one call whose result "will be used during
  user operation submission" — i.e. the spec itself draws the
  authorization line at the second call, not the first. The spec does say
  services "SHOULD do validations on incoming user operations during
  `pm_getPaymasterStubData` execution and reject the request at this stage
  if it would not sponsor the operation" — a SHOULD-level UX
  recommendation (fail fast instead of estimating gas for a request that
  will be denied later), not a MUST-level security requirement, and
  nowhere does the spec frame the stub call as an authentication point.
  Concretely: **an unrecognized or deleted `<appToken>` gets the exact same
  dummy stub data as a valid one** — observed directly —
  and that is spec-compliant, not a bug, because the dummy signature can
  never be exchanged for real sponsorship. It fails on-chain
  (`sigFailed=1`) regardless of who requested it, for a reason nothing
  about the app token controls: the dummy key is thrown away, per-call, and
  `PepuVerifyingPaymasterV7`'s `signers` mapping only ever recognizes
  `PAYMASTER_SIGNER_PRIVATE_KEY`'s real address. The 2,000 PEPU deposit
  this endpoint guards is therefore never at risk from the stub path
  regardless of app-token validity — the real gate, the one actually worth
  scrutinizing, is `pm_getPaymasterData`, which **was independently
  verified to reject an unknown/deleted app key** with
  `unknown_or_invalid_app_credential` (confirmed live in the audit log —
  see "Cap sizing incident" verification below). Implementing the spec's
  SHOULD-level early-validation for stub calls (resolve the app token,
  return a clean JSON-RPC error immediately on an unknown one) would be a
  reasonable UX polish — faster, clearer feedback to an integrator with a
  typo'd or revoked key, instead of a dummy response that only reveals
  itself as unusable at submission time — but it is a nice-to-have, not a
  fix to a security gap, and is left as a documented option rather than
  implemented here (see "Known gaps") so this task's numeric-caps-only
  scope doesn't also touch the auth path.
- **`pm_getPaymasterData`** — called right before submission to a bundler.
  This is the one that matters: it maps 1:1 onto the exact same
  `PolicyEngine.evaluate()` that `/sponsor` calls — every cap, the
  destination allowlist, the per-app budget, the circuit breaker, and the
  signing step all run unmodified.

**The auth trade-off on this path, stated plainly** (full reasoning in
`src/paymasterRpcAuth.ts`'s module doc comment): Privy's smart-wallet SDK
calls this URL directly from the end user's browser, as a bare,
unauthenticated JSON-RPC POST — there is no Privy access token attached,
because there's no Privy backend in that call path. `/sponsor`'s ownership
check (`sender_not_owned_by_token_user` — proving `userOp.sender` is a
smart wallet actually owned by the calling Privy user) is therefore
**not available** on this path; the `<appToken>` URL segment is the only
per-caller credential. Every OTHER unmodified check still runs in full —
the destination allowlist, per-app budget, and global circuit breaker —
but per-"user" caps here are keyed off the UserOperation's own **sender
address**, not a verified Privy identity. See "Threat model" below for
exactly what this does and doesn't expose.

## Running it

```bash
cd services/paymaster/policy-service
npm install
cp .env.example .env        # fill in PRIVY_APP_ID/SECRET (same values as repo-root .env)
                             # and PAYMASTER_CONTRACT_ADDRESS (after deploying)
npm run build && npm start  # or: npm run dev (rebuild+restart on change)
```

**Why `npm run build && node dist/index.js` instead of running the `.ts`
files directly**: this package's source uses `.js`-suffixed relative
imports throughout (`import ... from "./config.js"` inside a `.ts` file),
which typechecks fine (`moduleResolution: "bundler"`) but which Node's own
built-in TypeScript stripping does **not** resolve — running
`node --experimental-strip-types src/index.ts` directly fails with
`ERR_MODULE_NOT_FOUND`. `tsup` builds real `.js` output via esbuild, which
resolves this correctly; the `start`/`dev`/`hash-api-key`/
`monitor-deposit`/`reset-circuit-breaker` npm scripts all build-then-run
for this reason.

Other CLIs in this package (`src/cli/`, same "build first" rule applies —
i.e. run these as `npm run <script> [-- args]`, never
`node src/cli/<file>.ts` directly):

- `npm run reset-circuit-breaker` — clears the global circuit breaker
  directly against the sqlite file, no running server needed. Same
  underlying `PolicyDb.manuallyResetCircuitBreaker` as
  `POST /admin/circuit-breaker/reset`.
- `npm run reset-spend-counters` — clears per-user/per-sender AND per-app
  spend/count history (`PolicyDb.resetSpendEvents`, deleting rows from
  `sponsorship_events` — the one table every rolling-window per-user cap
  and every per-app/calendar-day sum is computed from; see "Rolling vs.
  calendar-day windows" above). **Never touches `audit_log`** (the
  permanent approved+denied decision history) **or `circuit_breaker_state`**
  (use `reset-circuit-breaker` above for the global breaker — this is its
  per-user/sender/app equivalent, not a replacement for it). Exists for
  the same reason `reset-circuit-breaker` does: during cap-sizing
  debugging, failed *and* partial attempts made under a too-low cap can
  leave `sponsorship_events` rows that keep counting against the
  trailing-hour/day windows even after the caps themselves are fixed,
  reproducing the same denial for reasons that have nothing to do with
  real usage (see "Cap sizing incident" below).
  ```bash
  npm run reset-spend-counters                              # clear EVERYTHING
  npm run reset-spend-counters -- --user sender:0x1b75...    # scope to one user/sender id
  npm run reset-spend-counters -- --app sponsored-demo       # scope to one app id
  npm run reset-spend-counters -- --user sender:0x1b75... --app sponsored-demo   # both (AND)
  ```
- `npm run monitor-deposit -- status` — read-only: prints the paymaster's
  current EntryPoint deposit and whether it's below the configured
  low-water mark. `... watch [--interval-sec N]` polls the same check on a
  loop. `... top-up [--broadcast]` plans (default) or sends (with
  `--broadcast`) a top-up transaction back to a target balance, never past
  a hard ceiling — see that file's doc comment for the full "keep the
  float small" reasoning, which is the main practical mitigation for the
  signer-key-compromise risk below.

Automated tests: `npm test` (vitest) — **328 tests across 24 files**, all
passing as of this writing. The v1 suites include `policyEngine.test.ts`
(every policy rule below), `paymasterRpc.test.ts` (the ERC-7677 JSON-RPC
surface), `kernelDecoder.test.ts`, `privyAuth.test.ts`,
`depositMonitor.test.ts`, `db.test.ts`, `allowlist.test.ts`,
`paymasterRpcAuth.test.ts`, `dummyPaymasterSignature.test.ts` and
`paymasterHashCrossCheck.test.ts` (the shared golden-hash vector with the
Solidity side — see `../README.md`). The v2 code is covered under
`test/sponsorship/`.

## Policy rules

Enforced in this order by `src/policy.ts`'s `PolicyEngine.evaluate`
(shared, unmodified, by both `/sponsor` and `/paymaster/:appToken` — only
the auth step differs between them). Every step, approved or denied,
writes an audit-log row (`src/db.ts`'s `audit_log` table); denials never
consume budget.

1. **Token verification** (`src/privyAuth.ts` for `/sponsor`;
   always-succeeds sender-keyed stand-in for `/paymaster/:appToken`, see
   above) → `invalid_or_expired_token`.
2. **Sender ownership** (`/sponsor` only — see the ERC-7677 auth
   trade-off above for why this step is skipped, not failed, on the
   paymaster-JSON-RPC path) → `sender_not_owned_by_token_user`.
3. **App resolution** — `X-Api-Key` header or `<appToken>` URL segment,
   hashed and matched against `config/apps.json` → `unknown_or_invalid_app_credential`.
4. **CallData decode** (`src/kernelDecoder.ts`) — must be a Kernel v3
   `execute(bytes32,bytes)` call, single or batch only (static-call/
   delegatecall-flavored execute is always denied) → `calldata_decode_failed`.
5. **Destination allowlist** (`src/allowlist.ts`) — every decoded target
   must be on **both** the global allowlist (`config/allowlist.json`,
   hard backstop) **and** the app's own `allowedDestinations`
   (`"*"` = defer to global; an app can only narrow, never widen) →
   `destination_not_globally_allowed`, `destination_not_allowed_for_app`.
6. **Per-user count caps** (rolling windows: trailing hour / day /
   all-time — `USER_HOURLY_COUNT_CAP` / `USER_DAILY_COUNT_CAP` /
   `USER_LIFETIME_COUNT_CAP`) → `user_hourly_count_cap_exceeded`,
   `user_daily_count_cap_exceeded`, `user_lifetime_count_cap_exceeded`.
7. **Per-user spend caps** (same rolling windows, wei —
   `USER_HOURLY_SPEND_CAP_WEI` / `USER_DAILY_SPEND_CAP_WEI` /
   `USER_LIFETIME_SPEND_CAP_WEI`, checked against `src/cost.ts`'s
   **worst-case** cost ceiling, not eventual actual cost) →
   `user_hourly_spend_cap_exceeded`, `user_daily_spend_cap_exceeded`,
   `user_lifetime_spend_cap_exceeded`.
8. **Per-app spend caps** (calendar-day UTC + optional lifetime, each
   app's own `dailySpendCapWei` / `lifetimeSpendCapWei`, `null` lifetime =
   uncapped; scoped strictly per app) → `app_daily_spend_cap_exceeded`,
   `app_lifetime_spend_cap_exceeded`.
9. **Global circuit breaker** — `GLOBAL_DAILY_SPEND_CEILING_WEI`, summed
   across **every** app, user, AND sender combined (calendar-day UTC, or
   since the last manual reset, whichever is later). Last line of
   defense: even if every per-user/per-app cap has room, aggregate spend
   across the whole service cannot cross this ceiling →
   `global_circuit_breaker_tripped` (HTTP 503). Clear it with
   `POST /admin/circuit-breaker/reset` or `npm run reset-circuit-breaker`.
10. **Validity window** — every approval carries `validUntil`/`validAfter`
    (`VALIDITY_WINDOW_SECONDS`, default 90s), bounding how long a
    captured-but-unsubmitted signature stays usable. Encoded into
    `paymasterData`, enforced by EntryPoint itself on submission — not a
    revert this service produces.
11. **Sign** — only after every check above passes, atomically with the
    cap-recording DB write (one SQL transaction, no `await` in between;
    safe under concurrency because `node:sqlite`'s `DatabaseSync` is
    synchronous and Node is single-threaded).

Rolling vs. calendar-day windows is a deliberate asymmetry: per-user caps
use a trailing window (can't "reset" early by waiting for UTC midnight);
per-app spend and the global breaker use calendar-day UTC (simpler to
reason about operationally, and an explicit allowance per the original
brief).

### Config files

- `config/allowlist.json` — `{"destinations": ["0x...", ...]}`. Every
  sponsored destination is denied until it's listed here. Currently lists
  TapScore (`0x261eA5971B93237a56990206A46Bc80318e4d078`) only.
- `config/apps.json` — one entry per registered app: `id`,
  `apiKeyHashHex` (see "How an app is identified" above),
  `allowedDestinations` (`"*"` or an address array — narrows, never
  widens, the global list), `dailySpendCapWei`, `lifetimeSpendCapWei`
  (or `null` for uncapped). Every entry here should be a real, deliberately
  registered app — there is no example/placeholder entry checked in.

### Environment variables (`src/config.ts`, defaults shown; see `.env.example` for the full annotated list)

| Variable | Default | Meaning |
|---|---|---|
| `PAYMASTER_SIGNER_PRIVATE_KEY` | *(required, from repo-root `deploy/.keys.env`)* | The signer whose ECDSA signature the contract's `signers` mapping trusts. Startup fails fast if this doesn't derive the known-good `EXPECTED_PAYMASTER_SIGNER_ADDRESS`. |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | *(required)* | Same app as this project's frontends — used to verify access tokens and (on `/sponsor` only) confirm smart-wallet ownership. |
| `PORT` | `8787` | HTTP listen port (this deployment runs it on `8788` — see this package's own `.env`). |
| `CHAIN_ID` | `97741` | PEPU mainnet. `97740` (testnet) has none of this infrastructure deployed. |
| `ENTRY_POINT_ADDRESS` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Canonical EntryPoint v0.7. |
| `PAYMASTER_CONTRACT_ADDRESS` | *(required)* | The deployed `PepuVerifyingPaymasterV7`. |
| `DB_PATH` | `./data/policy.db` | sqlite file — event log + audit trail + circuit-breaker state. |
| `PAYMASTER_VERIFICATION_GAS_LIMIT` / `PAYMASTER_POST_OP_GAS_LIMIT` | `100000` / `50000` | Returned in every approval; tune against real measured gas. |
| `VALIDITY_WINDOW_SECONDS` | `90` | How long a signed approval stays valid before EntryPoint rejects it. |
| `USER_HOURLY_COUNT_CAP` / `USER_DAILY_COUNT_CAP` / `USER_LIFETIME_COUNT_CAP` | `20` / `100` / `2000` | Per-user sponsorship-count caps, rolling windows. |
| `USER_HOURLY_SPEND_CAP_WEI` / `USER_DAILY_SPEND_CAP_WEI` / `USER_LIFETIME_SPEND_CAP_WEI` | `25` / `100` / `1000` PEPU | Per-user worst-case spend caps, rolling windows. **Fixed 2026-09-30** — see "Cap sizing incident" below; the code fallback (used whenever `.env` leaves one of these unset) was previously `0.1` / `1` / `10` PEPU, low enough to deny 100% of sponsorships. |
| `GLOBAL_DAILY_SPEND_CEILING_WEI` | `1000` PEPU (code fallback) | **This deployment sets `500000000000000000000` (500 PEPU/day) instead** — raised from a prior `200` PEPU/day alongside the per-user fix above (200 PEPU/day left too little headroom once a realistic 25 PEPU/hour per-user cap was in play). See "Threat model" below for why the code default is too permissive for a public paymaster-JSON-RPC endpoint. |
| `ADMIN_TOKEN` | *(unset = endpoint disabled)* | Required to call `POST /admin/circuit-breaker/reset`. |
| `ALLOWLIST_CONFIG_PATH` / `APPS_CONFIG_PATH` | `config/allowlist.json` / `config/apps.json` | Override the config file locations. |
| `PAYMASTER_RPC_ALLOWED_ORIGINS` | *(unset = any origin)* | Comma-separated exact `Origin` values allowed to call `/paymaster/:appToken`. A browser-side speed bump only — see `src/paymasterRpcAuth.ts`; real enforcement is the app token + policy engine. |
| `NODE_ENV` | *(unset)* | `production` (set by the Docker image): `deploy/.keys.env` is not read, `PAYMASTER_SIGNER_ADDRESS` and `RPC_URL` become required, the dev apps profile is refused, and an apps file containing the local-dev key hash is rejected. |
| `PAYMASTER_SIGNER_ADDRESS` | dev address | Address the signer key must derive. Required in production (a fresh hosted key has a different address; register it with `addSigner`). |
| `*_FILE` for `PAYMASTER_SIGNER_PRIVATE_KEY`, `PRIVY_APP_SECRET`, `ADMIN_TOKEN`, `RPC_URL` | unset | Docker-secret style: read the value from the file at that path. A directly set variable wins. |
| `RPC_URL` | unset (required in production) | Chain JSON-RPC for `GET /ready` and the executed-marker reconciler. Embeds a provider key: a secret. |
| `PEPU_APPS_PROFILE` | unset | `dev` loads `config/apps.dev.json` (adds the documented local-dev key for `templates/sponsored-session-app`). Default and production use `config/apps.json`. Local testing now needs `PEPU_APPS_PROFILE=dev`. |
| `PAYMASTER_RPC_ALLOW_MISSING_ORIGIN` | `false` | With an origin allowlist set, also accept requests with no `Origin` header (server-side callers). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful-shutdown deadline before connections are cut and the process exits 1. |
| `READY_MIN_DEPOSIT_WEI` / `READY_MAX_DEPOSIT_WEI` | `0` (off) | `/ready` fails below the minimum and warns above the maximum paymaster deposit. |
| `RECONCILER_ENABLED`, `_INTERVAL_MS`, `_CHUNK_BLOCKS`, `_LOOKBACK_BLOCKS`, `_START_BLOCK`, `_CONFIRMATIONS` | `true`, 30000, 2000, 100000, unset, 2 | v1 executed-marker reconciler (`src/executedReconciler.ts`): marks approvals executed from the EntryPoint's `UserOperationEvent` logs so caps stop under-counting after `valid_until`. Needs `RPC_URL`. |
| `PAYMASTER_RPC_ALLOW_ACCOUNT_DEPLOYMENT` | `true` | Whether to sponsor a UserOperation that also deploys a brand-new Kernel account (`factory`/`factoryData` present) through the public paymaster-JSON-RPC endpoint. `true` is required for a real first-time user's first transaction to be sponsored; it is also exactly what makes the sybil risk below possible — see there before flipping this. |

## Spend accounting: idempotency and expiry voiding

Spend is booked at **signing time** (`pm_getPaymasterData`), at the worst-case
cost, before anything is on-chain. Two rules keep that from over-counting:

1. **Idempotency by `userOpHash`.** `sponsorship_events.user_op_hash` has a
   partial UNIQUE index. If a non-voided event already exists for the same
   hash and its `valid_until` has not passed, `recordApprovalIfWithinCaps`
   skips the cap checks and the insert and returns ok, so the caller signs the
   same hash again. This matters because a browser (Privy's smart-wallet SDK)
   can run the prepare flow twice in parallel, producing two
   `pm_getPaymasterData` calls with an identical hash 10-300 ms apart. Within
   the process the method is fully synchronous (node:sqlite), so check and
   insert cannot interleave; the unique index plus a `UNIQUE constraint`
   catch is the backstop for a second connection or process.
2. **Expired, unexecuted approvals stop counting.** `sponsorship_events.valid_until`
   (unix seconds) is stored per event. The trailing-hour, daily, lifetime,
   per-app and circuit-breaker sums (and count caps) only include events that
   are `voided = 0` AND (`executed = 1` OR `valid_until IS NULL` OR
   `valid_until * 1000 > now`).

**Why voiding expired approvals is safe:** the paymaster signature commits to
`validUntil`, and the EntryPoint enforces it during validation. After
`validUntil` that signature can no longer be used on-chain, so an approval
that has expired without executing can never cost the paymaster anything.
Not counting it cannot let an attacker spend more than the caps.

**Trade-off (be honest about it):** within the validity window (default 90s)
an approval counts at full worst-case cost even if it ends up never being
submitted, and an executed op is, after expiry, currently *dropped* from the
sums too, because nothing yet marks it `executed`. That means a user who
really executes can have their real spend fall out of the caps after 90s.
The `executed` column exists for this: the follow-up is a reconciler that
reads the EntryPoint `UserOperationEvent` for each hash, sets `executed = 1`
and replaces the worst-case `cost_wei` with `actualGasCost`. Until then the
caps are a rate limiter on *signatures issued per validity window*, with the
on-chain deposit and the global circuit breaker's window as the hard stop.
Legacy rows (pre-migration, NULL `valid_until`) keep counting forever, which
is conservative. The migration is additive (`ALTER TABLE ADD COLUMN`), so
existing DBs keep working.

## Threat model

The contract enforces **no on-chain spending cap.** Every safeguard below
lives in this service. Read this as a description of what actually stops
each attack, not a scorecard.

- **Drain via loops** (one actor repeatedly requesting sponsorship):
  stopped by per-user hourly/daily/lifetime count AND spend caps (rolling
  windows — no "reset by waiting for midnight"), backstopped by the
  global circuit breaker if many users/senders coordinate.
- **Griefing** (sponsored ops designed to revert or waste gas): the
  destination allowlist limits *what* can be called at all; per-user/app
  caps limit *how much* gas any actor can consume regardless of success.
  `cost.ts`'s worst-case accounting books the full gas ceiling at approval
  time, before knowing whether the op succeeds on-chain — a griefer can't
  rely on "it reverted, so it was free."
- **Sponsored-tx spam**: the same per-user/per-app count caps, plus the
  destination allowlist, plus the API-key-gated app registry (a valid,
  hashed, registered app credential is required at all).
- **Stolen Privy tokens** (`/sponsor` path): a stolen-but-valid access
  token alone is not enough — sender-ownership verification independently
  confirms `userOp.sender` is actually owned by that token's user,
  fail-closed on any error. Bounds a stolen token to sponsoring gas only
  for wallets that user actually owns, under that user's own caps.
- **Permissionless Kernel factories → sybil caps on the paymaster-JSON-RPC
  path (`/paymaster/:appToken`)** — the risk this deployment's
  `GLOBAL_DAILY_SPEND_CEILING_WEI` is specifically tuned against. Kernel
  v3 smart-account factories are public infrastructure: anyone can deploy
  their own Kernel account through the exact same factory/ECDSA validator
  this project uses, with themselves as owner. "Sender is a Kernel
  account from our factory" proves nothing about WHO controls it — unlike
  `/sponsor`'s Privy ownership check, this path cannot distinguish a real
  app user from an attacker's own freshly-deployed smart account. A caller
  who knows a registered app's paymaster URL can mint unlimited fresh
  sender addresses (each deployment itself sponsored, if
  `PAYMASTER_RPC_ALLOW_ACCOUNT_DEPLOYMENT` is `true`), each getting its
  own fresh set of per-sender caps — so no single sender/app ever trips
  ITS OWN limit, while the fleet collectively drains the shared daily
  budget. The backstops that still apply in full: the per-app daily/
  lifetime cap (bounds any one app's total exposure), the destination
  allowlist (a drained budget can only ever pay for calls to already-
  approved contracts, e.g. TapScore, never move value anywhere else), and
  — the actual last line of defense against a fleet of sybil senders —
  the **global circuit breaker**, which sums spend across every
  app/user/sender combined and halts ALL sponsorship once tripped,
  regardless of how many distinct senders were involved. **Worst case from
  this is denial-of-service on sponsorship — bounded (by the ceiling) and
  resettable (UTC rollover or an admin `POST /admin/circuit-breaker/reset`)
  — never fund theft**, since every sponsored call still has to clear the
  destination allowlist first. This is why `GLOBAL_DAILY_SPEND_CEILING_WEI`
  is set to `500000000000000000000` (500 PEPU/day) here rather than the
  code's more permissive 1000 PEPU fallback: roughly 40 fresh account
  deployments (~12 PEPU worst-case each — see "Cap sizing incident" below)
  or a much larger number of ~3 PEPU follow-up ops, and 25% of the
  paymaster's ~2,000 PEPU EntryPoint deposit — enough headroom for real
  multi-user traffic without letting one sybil fleet (or one runaway bug)
  burn a meaningful fraction of the deposit before anyone notices. (This
  was raised from an earlier 200 PEPU/day at the same time as the per-user
  fix below, once 200 PEPU/day was found to leave too little headroom
  above the realistic per-user/per-app caps it's meant to backstop, not
  bind ahead of.)

### Cap sizing incident (2026-09-30) — how low is "too low"?

This service's per-user spend caps (`USER_HOURLY_SPEND_CAP_WEI` /
`USER_DAILY_SPEND_CAP_WEI` / `USER_LIFETIME_SPEND_CAP_WEI`) were, until this
fix, left unset in `.env`, so `src/config.ts`'s fallback defaults applied
instead: `0.1` / `1` / `10` PEPU. In production, this denied **every single
sponsorship attempt**, first-time or not, confirmed live against a real
UserOperation:

```
Sponsorship denied: user sender:0x1b75a60f670e50fc163b69c8a6e70f67ddda49e7
trailing-hour spend 0 + 11972835000000000000 would exceed cap 100000000000000000
```

The root cause is sizing, not logic: that UserOperation carried
`factory`/`factoryData` — it was **deploying the user's Kernel smart
account**, a one-time cost of the account deployment itself plus its first
call, measured at ~11.97 PEPU worst-case on PEPU mainnet (chain 97741,
base fee ~12,500 gwei). A subsequent UserOp from that same, now-deployed
sender costs roughly ~3 PEPU. **Any per-user cap must comfortably exceed
the one-time deployment cost, or every new user is blocked on their very
first action** — the worst possible place for a cap to bind, since the
hourly check runs before the daily/lifetime checks (`src/db.ts`'s
`recordApprovalIfWithinCaps`) and a first-time user's very first
UserOperation is, definitionally, always this expensive one.

Fixed values (now set explicitly in `.env`, not left to the code
fallback — see `src/config.ts`'s and `.env`'s own inline comments for the
full reasoning):

| Cap | Old (denied everything) | New | Why |
|---|---|---|---|
| Per-user hourly | 0.1 PEPU | **25 PEPU** | Clears one ~12 PEPU deployment with headroom for several ~3 PEPU follow-ups the same hour. |
| Per-user daily | 1 PEPU | **100 PEPU** | PEPU's requested ballpark: one deployment plus ~29 subsequent ops/day. |
| Per-user lifetime | 10 PEPU | **1000 PEPU** | 10x the daily cap, so it's never the practical binding constraint for sustained real use; still bounded at half the paymaster's 2,000 PEPU deposit. |
| Per-app daily (`sponsored-demo`) | 50 PEPU | **200 PEPU** | Was below the per-user daily cap (100 PEPU) — the app cap would have bound before a single well-behaved user reached their own limit. |
| Global daily ceiling | 200 PEPU | **500 PEPU** | 200 PEPU left too little headroom above the corrected per-user/per-app caps above; 500 PEPU keeps the breaker a backstop against a sybil-sender fleet, not an accidental limiter on legitimate multi-user traffic. |

The lesson generalizes: **a spend cap sized without reference to the
actual cost of the cheapest thing a legitimate user must do (here, one-time
account deployment) isn't a safety margin — it's an outage.** Any future
change to gas limits, EntryPoint version, or account-deployment mechanics
that shifts the ~12 PEPU / ~3 PEPU cost split above should be re-checked
against these caps before being deployed.
- **Signer-key compromise**: **the one thing the contract cannot stop at
  all.** The contract's `signers` mapping is the entire on-chain trust
  boundary — any signature from an authorized signer key is honored up to
  the deposit's balance, with no on-chain check of who requested it or
  what it's for. If `PAYMASTER_SIGNER_PRIVATE_KEY` is compromised, the
  attacker signs arbitrary approvals directly, bypassing this service (and
  every cap above) entirely, limited only by the current EntryPoint
  deposit balance — a total-deposit-loss event, bounded only by how small
  the float is kept. `MultiSigner.sol` lets a manager revoke a compromised
  signer without a redeploy, but that's a *response* after detection, not
  prevention. The practical mitigation is operational: keep the deposit
  small (`monitor-deposit.ts`'s ceiling/top-up workflow) and treat the
  signer key with the same care as a hot wallet holding exactly the
  deposit's balance — because that is precisely what it is.

## Known gaps

- **No on-chain reconciliation** between `cost.ts`'s worst-case accounting
  and actual on-chain `UserOperationSponsored` events — a signer-key-
  compromise pattern (approved volume diverging from on-chain volume)
  isn't automatically detected yet. Needs the contract's events indexed.
- **No dedicated funding key** for `monitor-deposit.ts top-up`; it falls
  back to the deploy key.
- **No sender-level sybil detection** beyond the caps described above
  (e.g. rate-limiting by IP, or requiring a minimum "account age" before a
  freshly-deployed sender is sponsored) — the global circuit breaker is
  the sole backstop for a coordinated multi-sender attack on the
  paymaster-JSON-RPC path today.
- **`pm_getPaymasterStubData` doesn't resolve/validate the `<appToken>`**
  (confirmed intentional and spec-compliant, not a security gap — see
  "Paymaster JSON-RPC" above for the full ERC-7677-sourced reasoning). An
  unknown or revoked app token gets the same dummy stub data a valid one
  would, which cannot itself be exchanged for real sponsorship. Adding
  early app-token validation here (matching the spec's SHOULD-level
  recommendation) would only improve error-message latency for an
  integrator with a bad token — a real, low-risk polish, but not
  implemented in this pass.

See `services/paymaster/README.md` for the contract-side threat model
(the byte-layout cross-check, Foundry security tests, and deploy
mechanics) and `services/paymaster/AGENTS.md` for the hard rules an agent
working in this directory must follow (never print a private key, never
broadcast a deploy without explicit `--broadcast`, never invent an ABI).

## Status and tiered sponsorship v2

- **v1 (this README's subject) is proven live but its paymaster is retired.** With a real Privy login and Smart Wallets configured in the Privy Dashboard, a zero-balance Kernel smart account sent a transaction on PEPU mainnet that this service sponsored. The v1 paymaster contract (`0x2B6F...`) has since been retired (deposit withdrawn). The service is hosted at `https://paymaster.pepeunchained.com`.
- **v2 is deployed as a canary** (`0xdb28528C9399C33c9A0297E8A62F39145acbC30D`: internally reviewed 3x, external audit pending, funded in small tranches). `src/sponsorship/` implements the tiered model behind `SPONSORSHIP_V2_ENABLED=true`, under `/v2/*`, with its own SQLite file, and it now serves production at `https://paymaster.pepeunchained.com/v2/*`. A project-sponsored operation from a fresh 0-PEPU Kernel account ran through the hosted URLs (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`). The API is specified in `openapi.yaml`; the design, threat model, decisions and remaining open items are in `../SPONSORSHIP-SPEC.md`.
  What it enforces:
  - **Free tier (100 PEPU per user per day, 50 per hour in production config): verified Privy accounts only.**
    Every free-tier request must carry a Privy access token the service
    verifies (`Authorization: Bearer` on `/v2/sponsor`, or
    `context.privyAccessToken` on the ERC-7677 route). A bare or
    Privy-linked wallet address proves nothing and gets nothing. There is no
    anonymous tier and no chain-wide daily ceiling.
  - **Project budgets sponsor any wallet** (Privy users, non-Privy users,
    native/EOA wallets behind smart accounts); the free tier never pays for
    them. A project's budget is spent only with its **server API key** (secret,
    backend use, `X-Api-Key`, no origin restriction) or its publishable
    **client token** (the ERC-7677 URL token) from one of its **allowed
    origins**. A project with no allowed origins can only be used with the
    server key. The contract independently enforces the destination allowlist,
    a per-wallet daily limit and a project daily limit.
  - **Deposits are one-way, claims are attested.** Anyone can deposit into any
    project (claimed or not) and nobody can withdraw. A project id is
    `keccak256(appId)`: one project per Privy app. Settings ownership comes from
    an on-chain claim backed by an EIP-712 attestation from this service's
    signer, issued by `POST /v2/projects/verify` after it checks the developer's
    Privy app secret against Privy's REST API (`GET /v1/users?limit=1`). The
    secret is used for one outbound request and is never stored, logged or
    echoed (tests assert this); the endpoint is rate limited per IP and by a
    failure budget per (app id, signed-in address), charged only when Privy
    rejects the credentials, so a stranger cannot lock the real owner out. The
    first claim is immediate and sets only the owner: the owner then configures
    the allowlist and limits (nothing is sponsorable before that). A re-claim of
    an owned project is timelocked on-chain (>= 48h). When the on-chain owner
    changes, the engine revokes the previous owner's server key and client token
    (denial `project_owner_changed`); the new owner rotates to get fresh ones.
    The paymaster mode byte is always 0x02 and the bundler gate cannot be
    disabled by the signer. The `/v2` API is otherwise a convenience layer
    (calldata encoding, indexing, credential issue).

## Going to production

A ready-made hosting kit (Dockerfile, Caddy proxy with TLS/rate limits/Origin allowlist, secrets, monitor, backups, rotation) lives in `../../../deploy/hosting/`; start with its [RUNBOOK](../../../deploy/hosting/RUNBOOK.md). `GET /ready` checks DB, RPC and deposit; `/health` stays a cheap liveness probe. Admin token comparison is constant-time. Run exactly one replica.

See "Going to production" in `../README.md` for the full list. The points
specific to this service:

- Run it under a process supervisor on a host with a stable hostname and TLS,
  not behind a tunnel. Set `TRUST_PROXY` correctly when behind a reverse proxy
  so rate limiting sees real client IPs; the client is taken from the
  `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` (default 1) from the right,
  never the client-controlled leftmost entry. v2 only: Privy app ids are used
  exactly as given (case-sensitive; do not lower-case them).
- Keep `PAYMASTER_SIGNER_PRIVATE_KEY`, `PRIVY_APP_SECRET`, `ADMIN_TOKEN` and
  the Conduit API key in a secrets manager. Never commit `.env`, the SQLite
  files, or a raw app key; only `sha256(rawKey)` goes in `config/apps.json`.
- Treat each full `/paymaster/<appToken>` URL as a secret, and set
  `PAYMASTER_RPC_ALLOWED_ORIGINS` once frontend origins are known.
- Monitor the EntryPoint deposit (`npm run monitor-deposit -- watch`), the
  circuit breaker, and error rates. Keep the deposit and
  `GLOBAL_DAILY_SPEND_CEILING_WEI` small enough that a signer-key compromise
  or a sybil fleet is a bounded loss.
- Back up `DB_PATH` (event log, audit trail, circuit-breaker state). Spend
  accounting assumes a single process.
- Audit the v2 contract before it holds real deposits.
