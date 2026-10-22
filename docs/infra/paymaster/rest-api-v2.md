# Paymaster REST API v2

Reference for the tiered sponsorship API (`/v2/*`) of the policy service, derived from `services/paymaster/policy-service/openapi.yaml` and the service source. Read it to log in as a project owner, prove ownership of a Privy app, issue and rotate credentials, change origins, check the free tier, encode transactions with `prepare` and to decode a denial.

Base URL `https://paymaster.pepeunchained.com`. The `/v2` routes are public (free-tier, config, SIWE login, projects, verify; CORS `*`); `/v2/admin` returns 404 on the hosted host. The routes exist only when the service runs with `SPONSORSHIP_V2_ENABLED=true` (the hosted one does). Deposits are one-way, so deposit only what your project needs.

**Funds never move through this API, and it is not required to use the contract.** Deposits are one-way: anyone can deposit into any project (claimed or not) or the free pool, and nothing can withdraw. The API is a convenience layer that encodes calldata, indexes a claimed project and issues the credentials the service needs to sign sponsorships.

Conventions: all amounts are decimal **wei strings**. Errors are `{ "error": "<code>", "message": "...", "reason"?: "..." }`. HTTP 429 carries a `Retry-After` header. Base URL is `https://paymaster.pepeunchained.com` (the SDK default; override with `PEPU_PAYMASTER_URL` or run your own service).

## Auth tiers

| Tier | Credential | Used by |
|---|---|---|
| Public | None | `config`, `contract`, `free-tier`, `auth/nonce`, `auth/login` |
| Session | `Authorization: Bearer <SIWE session token>` | `me`, `auth/logout`, `projects/verify` (any signed-in address) |
| Owner | Session whose address equals the project's **current on-chain owner**, re-checked against the chain on every call | `projects` routes |
| Admin | `X-Admin-Token` equal to `SPONSORSHIP_ADMIN_TOKEN` (at least 32 characters, separate from the v1 admin token). Routes return 404 when unset | `/v2/admin/*` |
| Credential | Project server key `ppk_...`, or client token `ppt_...` from an allowed origin, plus a Privy access token for the free tier | `/v2/sponsor`, `/v2/paymaster/:token` |

The full matrix is on [Credential Matrix](auth.md).

## Route summary

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /v2/config` | Public | Service and contract configuration |
| `GET /v2/contract` | Public | Paymaster address, chain id, EntryPoint and ABI |
| `GET /v2/free-tier` | Public | Free-pool state and limits. 503 if the chain is unreadable |
| `GET /v2/auth/nonce` | Public | Issue a single-use SIWE nonce (5 minutes) |
| `POST /v2/auth/login` | Public | Verify a SIWE message and signature, open a session |
| `POST /v2/auth/logout` | Session | Revoke the session |
| `GET /v2/me` | Session | The session address |
| `POST /v2/projects/verify` | Session | Prove control of a Privy app, receive a signed ownership attestation |
| `POST /v2/projects/prepare` | Session | Encode a transaction for the owner's wallet |
| `POST /v2/projects` | Owner | Index a claimed project and issue its credentials |
| `GET /v2/projects` | Session | Projects owned by the session address, plus on-chain claims not yet indexed |
| `GET /v2/projects/{projectId}` | Owner | Project state: on-chain balance and limits, off-chain settings, 24h usage |
| `POST /v2/projects/{projectId}/token/rotate` | Owner | New client token |
| `POST /v2/projects/{projectId}/server-key/rotate` | Owner | New server key |
| `PATCH /v2/projects/{projectId}/settings` | Owner | Per-user cap, `requireIdentity`, `allowedOrigins` |
| `GET /v2/projects/{projectId}/usage` | Owner | Spend history, reserved versus actual |
| `GET /v2/projects/{projectId}/events` | Owner | On-chain events for the project |
| `GET /v2/projects/{projectId}/allowlist` | Owner | Current on-chain destination allowlist |
| `POST /v2/sponsor` | Credential | REST sponsorship |
| `POST /v2/paymaster/{appToken}` | Credential | ERC-7677 JSON-RPC. `OPTIONS` answers CORS. See [ERC-7677 Methods](erc7677.md) |
| `GET /v2/admin/overview` | Admin | Free pool, contract totals, reconciler status, usage counts |
| `GET /v2/admin/projects` | Admin | All indexed projects and apps |
| `POST /v2/admin/apps` | Admin | Create a free-tier-only app and its token |
| `POST /v2/admin/projects/{key}/status` | Admin | Suspend or unsuspend a token (kill switch; does not touch funds) |
| `POST /v2/admin/projects/{key}/token/rotate` | Admin | Lost-token recovery |
| `POST /v2/admin/projects/{key}/server-key/rotate` | Admin | Server-key rotation (on-chain projects only) |
| `POST /v2/admin/reconcile` | Admin | Run the on-chain reconciler once |

## Public routes

### GET /v2/config

Returns chain id, paymaster and EntryPoint addresses, `adminChangeDelaySeconds`, the one-way-deposit and ownership notes, `postOpOverheadGas` and its maximum, the contract `owner` and `manager`, `siweDomains`, `sessionTtlSeconds`, `paymasterRpcPath` (`/v2/paymaster/{token}`) and `projectDefaults` (per-user daily default and maximum, wei).

### GET /v2/contract

`{ "address", "chainId", "entryPoint", "abi" }`. Build deposit and settings transactions from this; the SDK helpers do it for you.

### GET /v2/free-tier

Free-tier state: pool balance, per-op cap, per-wallet limit and per-user allowance. There is no chain-wide ceiling. Eligibility is a verified Privy account. The SDK probe `probePaymaster` reads it when exposed.

## The SIWE session

Project owners authenticate with Sign-In With Ethereum (EIP-4361), so no password or API key is needed to manage a project.

1. `GET /v2/auth/nonce` returns `{ "nonce", "expiresAt" }`. The nonce is single use and lasts 5 minutes.
2. Build an EIP-4361 message. Rules the service enforces: the **domain** must be in `SIWE_DOMAINS` (see `GET /v2/config`), the **chain id** must match, `expirationTime` is required and at most 10 minutes after `issuedAt`, and `issuedAt` must be within clock skew. Sign it with the wallet.
3. `POST /v2/auth/login` with `{ "message", "signature" }`. EOA and ERC-1271 (Safe) signatures are accepted. The response is `{ "token", "address", "expiresAt" }`: an opaque 32-byte session token, stored hashed on the server, valid for 1 hour and bound to that address.
4. Send `Authorization: Bearer <token>` on session and owner routes. `POST /v2/auth/logout` revokes it. Ownership is re-checked on chain on every owner call, so a transfer of ownership takes effect immediately.

Failures: `401 login_failed` with a `reason`, or `429` (login and nonce are rate limited per IP). With the SDK, `api.v2.loginWithWallet(sign, { address, domain })` does all four steps.

## POST /v2/projects/verify

Proves that the caller controls a Privy app and returns an EIP-712 `ProjectClaim` attestation for their wallet. This is how a project's on-chain owner is established without PEPU choosing who owns what.

Auth: a session for `ownerAddress`.

```json
{ "appId": "<your Privy app id, exactly as in the dashboard>", "appSecret": "<your Privy app secret>", "ownerAddress": "0x…" }
```

| Field | Rule |
|---|---|
| `appId` | 1 to 128 characters of `A-Za-z0-9_-`. **Case-sensitive**, used exactly as given (never lower-cased). The project id is `keccak256(bytes(appId))` |
| `appSecret` | At most 512 characters. Used for **exactly one** outbound request to Privy (HTTP Basic plus the `privy-app-id` header, `GET /v1/users?limit=1`) and **never stored, logged or echoed**, including in errors. Extra body fields are rejected |
| `ownerAddress` | Must equal the session address |

Success (200):

```json
{
  "projectId": "0x…",
  "appId": "…",
  "ownerAddress": "0x…",
  "action": "claimProject",
  "attestation": { "appId": "…", "newOwner": "0x…", "nonce": "…", "deadline": "…", "signature": "0x…" },
  "expiresAt": "…",
  "note": "…"
}
```

`action` is `claimProject` when the project is unclaimed and `reclaimProject` when it already has an owner. `takesEffect` is `immediately` for the claim of an empty project and `after_admin_change_delay` for a re-claim or for the first claim of a project that already holds deposited funds (the `note` says so; finish that claim with `executeReclaim` after the delay). The attestation is EIP-712 `ProjectClaim(string appId,address newOwner,uint256 nonce,uint256 deadline)` in the domain `PepuSponsoredPaymaster` version `1`, bound to the chain and the paymaster address, **single use**, and valid for at most **1 hour** (the contract rejects a deadline further out; the service default is 10 minutes). Submit it on chain with `prepare` (below) or the SDK's `encodeClaimFromVerification`.

| Status | Meaning |
|---|---|
| 400 | Malformed body (fixed message; the secret is never echoed) |
| 403 | `ownerAddress` is not the session address, or Privy rejected the credentials |
| 409 | This wallet already owns the project |
| 429 | Rate limited. Per IP on every request, plus a failure budget per (app id, signed-in address) charged **only** when Privy rejects the credentials, so a stranger cannot lock the real owner out |
| 501 | Not configured on this deployment |
| 502 | Privy could not be reached |

Rotate the Privy secret in the dashboard afterwards if you wish. Use a dedicated Privy app for sponsorship where you can. A holder of the secret can replace a pending re-claim with their own, so rotate the secret after any recovery.

## POST /v2/projects/prepare

Encodes a transaction for the owner's wallet to sign and send. **It sends nothing.** Owner-gated actions are checked against the project's current on-chain owner. There are no withdrawal actions, because none exist.

| `action` | Fields | Contract function |
|---|---|---|
| `claimProject` | `attestation` | `claimProject`. First claim; sets the owner only. Immediate for an empty project; **pending for the admin change delay (at least 48 hours) when the project already holds funds** |
| `reclaimProject` | `attestation` | `reclaimProject`. Timelocked re-claim (48 hours or more), cancellable by the owner once per new owner |
| `depositFor` | `projectId`, `amountWei` | `depositFor`. Open to anyone, one-way |
| `executeReclaim`, `cancelReclaim`, `acceptProjectOwnership` | `projectId` | the same-named function |
| `setTargets` | `projectId`, `targets[]`, `allowed` | The destination allowlist |
| `setDailyLimit`, `setSenderDailyLimit` | `projectId`, `limitWei` | Project and per-wallet daily limits |
| `setPaused` | `projectId`, `paused` | Pause or resume. Pausing is a project's exit |
| `proposeProjectOwner` | `projectId`, `newOwner` | Voluntary two-step handover. The zero address withdraws a pending nomination |

`claimProject` takes `attestation` only. The former `targets` and `limits` fields are rejected with 400: the claim sets **only** the owner, so afterwards the owner must call `setTargets`, `setDailyLimit` and `setSenderDailyLimit`. Nothing is sponsorable until all three have run.

Response (200):

```json
{ "chainId": 97741, "to": "0x…", "data": "0x…", "value": "0", "function": "setDailyLimit(bytes32,uint112)", "description": "…" }
```

Errors: 400 invalid, 403 not the on-chain owner.

## Project routes (owner)

### POST /v2/projects

Indexes an on-chain claimed project and issues credentials. The session address must be the project's current on-chain owner.

```json
{
  "appId": "…",
  "perUserDailyCapWei": "200000000000000000000",
  "requireIdentity": false,
  "allowedOrigins": ["https://app.example.com"]
}
```

Give `projectId` or `appId` (the id is `keccak256(appId)`). `allowedOrigins` are plain origins (`scheme://host[:port]`, no paths or wildcards, `http` only for localhost), at most 20. A project with none can be spent only with its server key; its client token is refused with `project_origin_not_allowed`. Success is `201` with:

| Field | Meaning |
|---|---|
| `token` | The publishable **client token** `ppt_...`, **shown once** |
| `paymasterUrl` | `https://<host>/v2/paymaster/<token>`, the value for Privy's "Paymaster URL" field. Spends the project's budget only from `allowedOrigins` |
| `serverKey` | The secret **server key** `ppk_...`, **shown once**. Backend only |

`409` means the project is not claimed on chain yet (a pending claim counts as not claimed until `executeReclaim`), or is already indexed. `403` means not the owner. `400 app_id_mismatch` means `appId` does not hash to `projectId`: the service takes the app id from the chain, and uses a request-supplied one only if `keccak256(appId) == projectId`.

### GET /v2/projects

`{ "projects": [...], "onchainUnindexed": [...] }`: projects owned by the session address plus on-chain claims not yet indexed.

### GET /v2/projects/{projectId}

On-chain state (`balance`, `spendable` which is balance minus signed-but-unsettled approvals, `outstandingApprovals`, `paused`, `dailyLimit`, `senderDailyLimit`, `spentToday`, `dailyRemaining`), `adminChangeDelaySeconds`, the allowlist, off-chain settings (credential prefixes, `allowedOrigins`, per-user cap, `requireIdentity`, status), `usage24h` (ops, project-funded and free-tier-funded wei) and the contract address.

### Credentials and rotation

| Route | Effect |
|---|---|
| `POST /v2/projects/{projectId}/token/rotate` | New client token and `paymasterUrl`. **The old one stops working immediately.** Update the URL in the Privy Dashboard |
| `POST /v2/projects/{projectId}/server-key/rotate` | New server key. **The old one stops working immediately** |

Both are shown once. When the on-chain owner changes (an executed re-claim or a voluntary transfer), the engine revokes the previous owner's server key and client token, clears the previous allowed origins and denies requests with `project_owner_changed`. The new owner rotates to get fresh ones.

### PATCH /v2/projects/{projectId}/settings

Off-chain settings; any subset of:

| Field | Meaning |
|---|---|
| `perUserDailyCapWei` | Per-user daily cap, within the admin maximum (default 200 PEPU; maximum 5,000 PEPU). 400 if out of range |
| `requireIdentity` | Opt in to refusing wallets without a verified Privy token |
| `allowedOrigins` | The client token's origin allowlist, at most 20 |

### Origins

A **client token** is publishable, so it is visible to anyone using the app. It therefore spends the project budget only when the request's `Origin` is in `allowedOrigins`. A project with no allowed origins cannot be spent with its client token at all. The **server key** has no origin restriction and must never reach a browser. Honest limit: browsers enforce `Origin`, but a non-browser client can forge it. Origin binding stops drive-by browser abuse and casual copying of the URL, not a determined holder of the token. The contract's own limits (allowlist, per-wallet and daily limits) are the backstop either way.

### Read routes

| Route | Query | Returns |
|---|---|---|
| `GET /v2/projects/{projectId}/usage` | `limit` (max 500), `before` | Spend history: reserved versus actual (reconciled from on-chain `UserOpSettled`), project- versus free-funded |
| `GET /v2/projects/{projectId}/events` | `fromBlock`, `limit` (max 1000) | Deposits, claims, settlements and configuration events |
| `GET /v2/projects/{projectId}/allowlist` | none | `{ projectId, source, targets }`, replayed from `TargetSet` events |

## Sponsorship routes

### POST /v2/sponsor

REST sponsorship. Headers: `X-Api-Key` carries the project's server key (any wallet) or client token (needs an allowed `Origin`); `Authorization: Bearer <Privy access token>` is **required for the free tier**. Body: `{ "userOp": { ... } }` as for [v1](rest-api-v1.md#post-sponsor).

Approval (200) returns the paymaster fields, `userOpHash`, a `sponsor` object (`kind` `project` or `free`, `sponsorId`, `projectKey`) and `maxCostWei`. A denial returns `{ "status": "denied", "reason", "message", "detail"? }`, where `detail` can carry the reason for each tier tried (`{ project?, free? }`).

| Status | Meaning |
|---|---|
| 200 | Approved |
| 400 | Malformed body (`malformed_request`, `invalid_json`), or a bounded-input denial: undecodable calldata, gas or fee out of bounds, fee above the on-chain cap, op above the free pool's cap |
| 401 | Invalid app or Privy credential (unknown credentials are throttled per IP and not written to the audit log) |
| 403 | Forbidden: suspended, origin not allowed, identity required, destination not allowed, project has no per-wallet limit on chain, account deployment disabled |
| 413 | Body larger than 256 KiB (`body_too_large`) |
| 429 | Per-IP request limit (`rate_limited`, with `Retry-After`, checked before the body is read), or cap, balance or per-wallet limit reasons |
| 503 | Chain unreadable (fail closed) |

### POST /v2/paymaster/{appToken}

ERC-7677. `appToken` is the client token (project budget only from allowed origins) or server key. `context.privyAccessToken` is required for the free tier. Full detail on [ERC-7677 Methods](erc7677.md).

## Admin routes

All need `X-Admin-Token`; 401 if wrong, 404 if the admin API is disabled. They are per-IP rate limited. `POST /v2/admin/apps` takes `{ label, perUserDailyCapWei?, allowedDestinations? }` and creates a free-tier-only app (no on-chain project; use the real Privy app id as `label` so identity resolves), returning 201, or 409 if the label exists. The status route takes `{ "status": "active" | "suspended" }`. Server-key rotation returns 400 for free-tier-only apps, which have no server key.

## Free tier

The free tier is funded by the chain's free pool and is for **verified Privy users only** (from PEPU's own Privy app; a third-party app's own Privy token is ignored for billing): 100 PEPU per user per day and 50 PEPU per hour as enforced by the live service (the older spec numbers were 50 a day and 30 an hour), with count caps of 40 ops a day and 20 an hour, at most 40 PEPU per operation, no chain-wide ceiling. A request without a verified Privy token is denied with `free_tier_identity_required`. The free tier never pays for a project's non-Privy wallets. See [Policy, Caps and the Circuit Breaker](policy-and-caps.md).

## Denial reason catalog

These are the values of `reason` in REST denials and in `error.data.reason` on the ERC-7677 route. The HTTP status comes from the reason. The SDK constant `PAYMASTER_DENIAL_REASONS` and `mapPaymasterReason` (from `@pepu-chain/sdk/paymaster`) mirror this list, and each maps to a typed SDK error; see [Error Reference](../../reference/errors.md).

| Reason | HTTP | Meaning and fix |
|---|---|---|
| `invalid_or_expired_token` | 401 | Privy token missing, expired or invalid. Send a fresh one |
| `unknown_or_invalid_app_credential` | 401 | Server key or client token unknown or rotated. Check the URL or key |
| `app_suspended` | 403 | The token was suspended by an admin |
| `sender_not_owned_by_token_user` | 403 | The sender is not an account of the token's Privy user. Two things count as owned: the ZeroDev Kernel v3.1 account (ECDSA validator, index 0) derived from one of the user's own Privy embedded wallets, which is what the SDK combo and session flows create and needs no Smart Wallets setting, or a Privy Smart Wallet linked to the user. The check also fails closed when Privy or the RPC cannot be reached right now, so a retry can succeed |
| `target_not_allowed_onchain` | 403 | A target is not on the sponsor's on-chain allowlist. The owner runs `setTargets` |
| `destination_not_allowed_for_app` | 403 | A target is outside a free-tier-only app's allowed destinations |
| `project_identity_required` | 403 | The project set `requireIdentity` and no verified Privy token came with the request |
| `project_origin_not_allowed` | 403 | Client-token request from an origin not in `allowedOrigins` (or none configured) |
| `free_tier_identity_required` | 403 | Free tier needs a verified Privy token |
| `project_paused` | 403 | The owner paused the project |
| `project_not_claimed_onchain` | 403 | The project has no on-chain owner yet. Deposits to it are not spendable until claimed |
| `project_owner_changed` | 403 | The on-chain owner changed; credentials were revoked. The new owner rotates |
| `calldata_decode_failed` | 400 | Not a Kernel v3 `execute` single or batch call |
| `malformed_request` | 400 | Body failed validation |
| `free_pool_op_too_large` | 400 | Worst-case cost exceeds the free pool's per-op cap (40 PEPU) |
| `gas_limits_out_of_bounds` | 400 | A gas field exceeds the service bounds (`preVerificationGas` 1,000,000, `verificationGasLimit` 1,500,000, `callGasLimit` 3,000,000 by default) |
| `fee_out_of_bounds` | 400 | `maxFeePerGas` above the lower of 3 times the current base fee and 40,000 gwei, or the priority fee above the base fee |
| `fee_above_onchain_cap` | 400 | `maxFeePerGas` above the sponsor's on-chain cap, so the contract would reject it |
| `chain_read_failed` | 503 | The service could not read on-chain state (fail closed). Retry |
| `project_balance_exhausted` | 429 | The project cannot cover the worst-case cost. Deposit more |
| `project_daily_limit_reached` | 429 | The project's daily limit (counting in-flight approvals) |
| `project_sender_limit_reached` | 429 | The per-wallet daily limit |
| `project_sender_limit_not_set` | 403 | The project has no per-wallet daily limit on chain (the contract rejects every op until the owner runs `setSenderDailyLimit`) |
| `account_deployment_disabled` | 403 | The service switched off sponsoring new-account deployment (`factory` / `factoryData` present) |
| `project_user_cap_exceeded` | 429 | The off-chain per-user daily cap |
| `free_tier_disabled` | 429 | The owner disabled the free tier |
| `free_tier_user_daily_exceeded`, `free_tier_user_hourly_exceeded`, `free_tier_count_exceeded` | 429 | Free-tier per-user caps |
| `free_tier_sender_limit_reached` | 429 | The free pool's per-wallet limit |
| `free_pool_empty` | 429 | The free pool cannot cover the operation |
| `reservation_cap_exceeded` | 429 | Too many live unexecuted approvals for a client token (2 per wallet, 5% of budget per IP, 25% in total). Retry shortly |
| `rate_limited` | 429 | Per-IP limit on client-token requests (default 30 a minute). Respect `Retry-After` |
| `destination_not_globally_allowed`, `user_*_cap_exceeded`, `app_*_spend_cap_exceeded`, `global_circuit_breaker_tripped` | v1 | v1-only reasons; see [REST API v1](rest-api-v1.md) |

The design spec names one reason `project_not_registered_onchain`; the code (and the SDK) uses `project_not_claimed_onchain`. The code is authoritative.

## Rate limits and proxies

In-memory sliding windows, single process: per IP on nonce and login (strict), per address on owner routes, per IP on admin routes, per token and IP on the ERC-7677 route, 30 per minute per IP on client-token evaluations, 600 per minute per IP on `POST /v2/sponsor` (checked **before** the body is read; `RATE_LIMIT_SPONSOR_PER_IP_PER_MIN`), and 60 per minute per IP on ERC-7677 requests whose URL token matches no credential (`RATE_LIMIT_RPC_UNKNOWN_TOKEN_PER_IP_PER_MIN`; junk tokens used to get a fresh bucket each). Denials for an unknown or missing credential are **not written to the audit log** (they are counted in memory and shown by the admin overview as `unauthenticated`); the audit log is pruned after `SPONSORSHIP_AUDIT_RETENTION_DAYS` (default 30) by the reconciler timer. `verify` has its own per-IP limit (10 a minute by default) and the per-(app id, address) failure budget. Set `TRUST_PROXY=true` behind a reverse proxy so limits see real client IPs; the client IP is then the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` (default 1) from the right, never the client-controlled leftmost entry.

CORS: auth, owner and admin routes send `Access-Control-Allow-Origin` only for origins in `SPONSORSHIP_API_ALLOWED_ORIGINS` (default none). The ERC-7677 route keeps its open default; project origin binding is a separate check inside the engine.

## Using the SDK

```ts
import { createPaymasterApi, assertApproved } from "@pepu-chain/sdk/paymaster";

const api = createPaymasterApi(); // defaults to https://paymaster.pepeunchained.com
const free = await api.v2.freeTier();
const result = await api.v2.sponsor(userOp, { apiKey: process.env.PEPU_SERVER_KEY!, privyAccessToken });
const approval = assertApproved(result); // throws a typed PepuPaymasterError on denial
```

`api.v2` covers every route above: `config`, `contract`, `freeTier`, `auth`, `loginWithWallet`, `me`, `projects.{prepare, register, list, get, rotateClientToken, rotateServerKey, updateSettings, usage, events, allowlist}`, `sponsor`, `erc7677Url` and a low-level `request`. See [/paymaster](../../sdk/paymaster.md) and [Register, Deposit and Claim a v2 Project](v2-register-deposit-claim.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `login_failed` | SIWE domain not in `SIWE_DOMAINS`, wrong chain id, expired nonce or message | Take the domain from `GET /v2/config`; request a fresh nonce |
| `403` from `verify` | Wrong app secret, or `ownerAddress` is not the session wallet | Check both; the secret is never echoed back |
| `409` from `POST /v2/projects` | Not claimed on chain yet | Submit the claim transaction first, then index |
| `project_origin_not_allowed` in the browser | The page origin is not in `allowedOrigins` | `PATCH` the settings to add it |
| Everything denied right after claiming | The claim sets only the owner | Run `setTargets`, `setDailyLimit`, `setSenderDailyLimit` (a project with no per-wallet limit is `project_sender_limit_not_set`) |
| `409` / `project_not_claimed_onchain` after submitting a claim | The project already held funds, so the claim is pending for the admin change delay | Wait for `executableAt` (event `ProjectClaimProposed`), then `prepare {action: "executeReclaim"}` |
| `429` on `POST /v2/sponsor` before any other check | Per-IP request limit (`RATE_LIMIT_SPONSOR_PER_IP_PER_MIN`, default 600) | Back off; send from the backend that holds the server key, or raise the limit |
| `AA33` at the bundler | Bundler executor not allowlisted in the v2 contract | Use the PEPU bundler |

## Related

- [Paymaster Overview](overview.md)
- [Credential Matrix](auth.md)
- [Policy, Caps and the Circuit Breaker](policy-and-caps.md)
- [PepuSponsoredPaymasterV7 Contract](contracts.md)
- [Paymaster v2 Spec Summary](../../contracts/paymaster-v2-spec.md)
