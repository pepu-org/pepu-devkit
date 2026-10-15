# Paymaster REST API v1

Reference for the v1 policy service: `GET /health`, `POST /sponsor`, `POST /paymaster/:appToken` and the admin circuit-breaker reset. It decides whether to sign a sponsorship for `PepuVerifyingPaymasterV7` and says exactly why when it refuses. Read this if you run or call the v1 service.

> Status: **historical; the v1 paymaster is retired.** This API was proven on mainnet: a real Privy login plus Smart Wallets sent a sponsored transaction from a zero-balance Kernel account through it (first on a PEPU development machine behind temporary tunnels, later through the hosted URLs, tx `0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f`). The v1 contract's EntryPoint deposit has been withdrawn, so it cannot sponsor anything now. For new work use [REST API v2](rest-api-v2.md) at `https://paymaster.pepeunchained.com`. Local default: `http://localhost:8788` (the service's own code default port is `8787`).

## Routes

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Liveness probe. Returns `{"status":"ok"}` |
| `POST /sponsor` | `Authorization: Bearer <Privy access token>` and `X-Api-Key: <app key>` | Evaluate a sponsorship request directly (your own frontend or backend calls this) |
| `POST /paymaster/:appToken` | The app key in the URL | ERC-7677 JSON-RPC. What Privy's smart-wallet client calls. See [ERC-7677 Methods](erc7677.md) |
| `OPTIONS /paymaster/:appToken` | None | CORS preflight, answers 204 |
| `POST /admin/circuit-breaker/reset` | `X-Admin-Token` equal to `ADMIN_TOKEN` | Clear the global circuit breaker. Disabled (not served) when `ADMIN_TOKEN` is unset |

The SDK client for these is `createPaymasterApi().v1` (`sponsor`, `health`, `erc7677Url`) from `@pepu-chain/sdk/paymaster`.

## POST /sponsor

Headers:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <Privy access token>`. Verified against Privy's JWKS |
| `X-Api-Key` | The app's raw API key. The service stores only `sha256(key)` and compares in constant time |
| `Content-Type` | `application/json` |

Body: `{ "userOp": { ... } }` with the v0.7 unpacked fields, numeric fields as `0x` hex:

```json
{
  "userOp": {
    "sender": "0x…",
    "nonce": "0x0",
    "factory": "0x…",
    "factoryData": "0x…",
    "callData": "0x…",
    "callGasLimit": "0x…",
    "verificationGasLimit": "0x…",
    "preVerificationGas": "0x…",
    "maxFeePerGas": "0x…",
    "maxPriorityFeePerGas": "0x…"
  }
}
```

`factory` and `factoryData` are present only when the operation deploys the user's smart account.

Approved (HTTP 200):

```json
{
  "status": "approved",
  "chainId": 97741,
  "paymaster": "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0",
  "paymasterVerificationGasLimit": "0x…",
  "paymasterPostOpGasLimit": "0x…",
  "paymasterData": "0x…",
  "validUntil": 0,
  "validAfter": 0,
  "userOpHash": "0x…"
}
```

Denied (4xx or 5xx):

```json
{ "status": "denied", "reason": "invalid_or_expired_token", "message": "The Privy access token is missing, expired, or does not verify." }
```

Observed live against the real service: no bearer token gave `401 invalid_or_expired_token` ("Missing or empty Authorization bearer token."), and a garbage bearer gave the same status after a real round trip to Privy's JWKS endpoint.

## POST /paymaster/:appToken

`<appToken>` is the app's raw API key, the same value as `X-Api-Key`, carried in the path because Privy's dashboard field is a bare URL. **Treat the full URL as a secret.** Methods and shapes are on [ERC-7677 Methods](erc7677.md).

The trade-off, stated plainly: Privy calls this URL straight from the end user's browser with no Privy access token. So the `/sponsor` ownership check (the smart wallet must belong to the authenticated Privy user) is **not available** here. The app token is the only per-caller credential. Every other check still runs (allowlist, per-app budget, circuit breaker), but per-"user" caps are keyed on the UserOperation's **sender address**, not a verified identity. That opens a sybil path (fresh Kernel accounts each get fresh per-sender caps), which the per-app caps, the destination allowlist and the global circuit breaker bound. Worst case is denial of sponsorship, never fund theft, because every sponsored call must still clear the allowlist. See [Policy, Caps and the Circuit Breaker](policy-and-caps.md).

## Status and reason table

HTTP statuses for a denial come from the reason. Every `*_cap_exceeded` reason is a 429.

| Reason | HTTP | Meaning |
|---|---|---|
| `invalid_or_expired_token` | 401 | Missing, expired or unverifiable Privy token |
| `unknown_or_invalid_app_credential` | 401 | The API key (header or URL) is not a registered app |
| `sender_not_owned_by_token_user` | 403 | `/sponsor` only: the sender smart wallet is not owned by the token's Privy user, or the check failed (fail closed) |
| `destination_not_globally_allowed` | 403 | A decoded target is not on the global allowlist |
| `destination_not_allowed_for_app` | 403 | A decoded target is not on this app's own list |
| `calldata_decode_failed` | 400 | Not a Kernel v3 `execute` single or batch call (static-call or delegatecall flavours are always denied) |
| `malformed_request` | 400 | Body failed validation |
| `user_hourly_count_cap_exceeded`, `user_daily_count_cap_exceeded`, `user_lifetime_count_cap_exceeded` | 429 | Per-user count caps |
| `user_hourly_spend_cap_exceeded`, `user_daily_spend_cap_exceeded`, `user_lifetime_spend_cap_exceeded` | 429 | Per-user worst-case spend caps |
| `app_daily_spend_cap_exceeded`, `app_lifetime_spend_cap_exceeded` | 429 | Per-app spend caps |
| `global_circuit_breaker_tripped` | 503 | Aggregate daily ceiling reached; clear with the admin reset |

On the ERC-7677 route the same reasons arrive as JSON-RPC `-32000` with `error.data.reason`.

## Caps

All are environment variables of the service with defaults in `src/config.ts`; caps are booked at the **worst-case** cost (all five gas limits times `maxFeePerGas`) when the approval is signed.

| Cap | Code default | The 2026-10 deployment |
|---|---|---|
| Per-user count: hourly, daily, lifetime | 20, 100, 2,000 | same |
| Per-user spend: hourly, daily, lifetime | 25, 100, 1,000 PEPU | same (raised on 2026-09-30) |
| Per-app daily and lifetime spend | per app in `config/apps.json`; `null` lifetime means uncapped | the demo app: 200 PEPU a day |
| Global daily ceiling | 1,000 PEPU | 500 PEPU a day |
| Validity window | 90 seconds | same |

Per-user caps use a trailing window (no resetting by waiting for midnight); per-app and global use calendar-day UTC. Detail and the cap-sizing incident are on [Policy, Caps and the Circuit Breaker](policy-and-caps.md).

## Rate limiting and proxying

There is no built-in per-IP rate limiting in v1. For a hosted deployment, put a reverse proxy with rate limits in front, set `PAYMASTER_RPC_ALLOWED_ORIGINS` once frontend origins are known and keep the per-app URL secret.

## What to expect

- A sponsored first transaction costs about 12 PEPU of worst-case reservation (it deploys the account), later ones about 3 PEPU.
- A denial never consumes budget.
- State is a SQLite file (`DB_PATH`); spend accounting assumes a single process.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `401 invalid_or_expired_token` | No or stale Privy token | Fetch a fresh access token and retry |
| `401 unknown_or_invalid_app_credential` | Wrong or revoked key | Check `X-Api-Key` or the URL; ask the operator to register or rotate |
| `403 sender_not_owned_by_token_user` | Smart Wallets not enabled in the Privy Dashboard, or the sender belongs to someone else | Enable Smart Wallets (Kernel, chain 97741); see [Dashboard Settings](../../privy/dashboard-settings.md) |
| `403 destination_not_globally_allowed` | The call goes to a contract not on `config/allowlist.json` | Add the contract (operator action) |
| `429 user_hourly_spend_cap_exceeded` on a first transaction | Cap is below the ~12 PEPU account deployment | Raise the per-user caps above the deployment cost |
| `503 global_circuit_breaker_tripped` | Daily ceiling hit | Wait for UTC rollover, or `POST /admin/circuit-breaker/reset` |

## Related

- [Paymaster Overview](overview.md)
- [ERC-7677 Methods](erc7677.md)
- [Credential Matrix](auth.md)
- [Policy, Caps and the Circuit Breaker](policy-and-caps.md)
- [REST API v2](rest-api-v2.md)
