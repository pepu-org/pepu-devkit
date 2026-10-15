# Policy, Caps and the Circuit Breaker

What the policy service checks before it signs a sponsorship: the destination allowlist, per-user, per-app and per-project caps, the free-tier numbers and the global circuit breaker, plus how spend is booked. Read it to size caps correctly and to understand a denial.

> Status: **v2 rules proven on mainnet** (canary, external audit pending), served by the policy service at `https://paymaster.pepeunchained.com`. **v1 rules** were proven live (246 service tests; real sponsored transactions) and are history: the v1 paymaster is retired.

## v1 pipeline

Enforced in this order; every step, approved or denied, writes an audit row. **A denied request never consumes budget.**

1. Token verification (Privy JWT on `/sponsor`; sender-keyed stand-in on the ERC-7677 route) then `invalid_or_expired_token`.
2. Sender ownership (`/sponsor` only) then `sender_not_owned_by_token_user`.
3. App resolution by hashed key then `unknown_or_invalid_app_credential`.
4. Call data decode (Kernel v3 `execute`, single or batch only) then `calldata_decode_failed`.
5. Destination allowlist.
6. Per-user count caps.
7. Per-user spend caps.
8. Per-app spend caps.
9. Global circuit breaker.
10. Validity window encoded into the approval (90 seconds).
11. Sign, atomically with the cap-recording write.

## Allowlist

- **v1:** a destination must be on **both** the global list (`config/allowlist.json`, a hard backstop) and the app's own `allowedDestinations` (`"*"` defers to global). An app can only narrow, never widen. The global list currently holds only TapScore (`0x261eA5971B93237a56990206A46Bc80318e4d078`). Empty means everything is denied. Denials: `destination_not_globally_allowed`, `destination_not_allowed_for_app`.
- **v2:** the allowlist lives **on chain** per sponsor (`setTargets`), decoded from Kernel call data inside the contract, so it binds even a compromised signer. An empty list sponsors nothing. Account self-calls are denied unless the owner allowlists the account. Denial: `target_not_allowed_onchain`. A project can also pin the sender's account codehash (`setRequiredAccountCodehash`) so that only that account code is sponsored.

## Caps

All figures are configurable; spend is measured at the **worst case** (five gas limits times `maxFeePerGas`), not the eventual actual cost.

| Cap | v1 default | v2 |
|---|---|---|
| Per-user count (hour, day, lifetime) | 20, 100, 2,000 | free tier: 20 an hour, 40 a day |
| Per-user spend (hour, day, lifetime) | 25, 100, 1,000 PEPU | free tier, as enforced by the live service: **50 PEPU an hour, 100 PEPU a day** (the old spec numbers were 30 an hour and 50 a day) |
| Per-app | daily and lifetime per app in `apps.json` | per project: service per-user daily cap, default 200 PEPU, adjustable up to 5,000 PEPU |
| Per-operation | none | free pool: 40 PEPU (`free_pool_op_too_large`) |
| Per-wallet daily (on chain) | none | project: required, above 0. Free pool: default 100 PEPU per smart account per day |
| Project daily (on chain) | none | project `dailyLimit`, above 0 |
| Gas price | none | on-chain `maxFeePerGas` cap per sponsor (deploy default 40,000 gwei) plus service bounds against the live base fee |
| Global daily ceiling | 1,000 PEPU code default (deployment: 500) | none for the free pool; bounded by the pool balance |

Per-user caps use a **trailing window** (cannot reset by waiting for midnight); per-app spend and the global ceiling use calendar-day UTC.

### Free-tier numbers (v2)

Live allowance: 100 PEPU per Privy user per rolling day and 50 PEPU per hour (the older spec design was 50 PEPU a day), enforced by the service. Privy users only (a verified access token is required; there is no anonymous tier), 40 PEPU maximum per operation, **no chain-wide daily ceiling**. The first operation (deploying the account) is about 12 PEPU worst case and later operations about 3 PEPU, so the daily allowance covers a deployment plus many operations. The honest residual risk is that N Privy accounts get N times the daily allowance, bounded by the pool balance. See [Sponsorship Tiers](../../onboarding/sponsorship-tiers.md).

### Size caps above the cheapest legitimate action

On 2026-09-30 the v1 per-user caps (0.1, 1, 10 PEPU) denied every sponsorship, because a user's first operation deploys their account and costs about 12 PEPU. A cap smaller than that is an outage, not a safety margin. Raise caps above the deployment cost and re-check them whenever gas limits or account mechanics change. The session flow is costlier: the first operation of a sponsored session (deploy plus enabling the permission) reserved about 20.5 PEPU and later ones about 6.9 PEPU.

## Spend accounting

- Booked at signing at worst-case cost. **Idempotent by `userOpHash`**: a duplicate `pm_getPaymasterData` for a live approval is not booked twice (Privy can call twice in parallel).
- Approvals that expire unexecuted stop counting (the signature is dead after `validUntil`). Trade-off: in v1, until a reconciler marks executed operations, an executed operation also drops out of the sums after the window, so v1 caps are effectively a rate limit on signatures per window, with the deposit and the circuit breaker as hard stops.
- v2 reconciles from on-chain `UserOpSettled`, replacing worst-case with the actual charge, and subtracts outstanding approvals from the chain balance so concurrent requests cannot all pass on one balance. Client-token reservations are capped: 2 live approvals per wallet, 5% of budget per IP, 25% in total (the server key is exempt).

## Circuit breaker

`GLOBAL_DAILY_SPEND_CEILING_WEI` sums spend over every app, user and sender (calendar-day UTC, or since the last manual reset). When it trips, **all** sponsorship stops with `global_circuit_breaker_tripped` (HTTP 503). It is the last defence against a fleet of fresh sender addresses, each with fresh per-sender caps (Kernel factories are permissionless, so the ERC-7677 path cannot tell an attacker's own account from a real user's). Worst case is denial of service, bounded and resettable, never fund theft, because each call still has to clear the allowlist. Clear it with `POST /admin/circuit-breaker/reset` (`X-Admin-Token`) or `npm run reset-circuit-breaker` in the policy service, which works directly on the database file. `npm run reset-spend-counters` clears per-user and per-app history without touching the audit log.

`PAYMASTER_RPC_ALLOW_ACCOUNT_DEPLOYMENT` (default `true`) controls whether the public ERC-7677 route sponsors new-account deployments. Turning it off raises the cost of a sybil fleet and breaks sponsored first transactions.

## Draw order (v2)

1. Project path if the credential is a project's and it can pay (`balance - outstanding` covers worst case, within limits).
2. Otherwise the free tier, only with a verified Privy token and allowance.
3. Otherwise denied, with the reason per tier in `detail`. An operation is never split between tiers, and the free tier never pays for a project's non-Privy wallets.

## Reason codes

The full catalog with HTTP statuses is in [REST API v2](rest-api-v2.md#denial-reason-catalog) (v2) and [REST API v1](rest-api-v1.md#status-and-reason-table) (v1). The SDK maps them to typed errors; see [Error Reference](../../reference/errors.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Every first transaction denied on spend cap | Cap below the account deployment cost | Raise per-user caps above about 12 PEPU (session flow about 20.5) |
| `global_circuit_breaker_tripped` | Daily ceiling reached | Wait for UTC rollover or reset; investigate for a sybil fleet |
| Cap errors persist after raising caps | Old event rows still count in the window | `npm run reset-spend-counters` (optionally `-- --user` or `-- --app`) |
| `project_daily_limit_reached` early in the day | In-flight approvals count at full worst case | Raise the daily limit or wait for approvals to expire |

## Related

- [Paymaster Overview](overview.md)
- [REST API v1](rest-api-v1.md), [REST API v2](rest-api-v2.md)
- [PepuSponsoredPaymasterV7 Contract](contracts.md)
- [Trust and Security Model](../../concepts/trust-and-security.md)
