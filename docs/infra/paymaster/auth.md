# Paymaster Credential Matrix

Which credential applies to which paymaster call, how to obtain it, and how to rotate it. Read this before putting any key or URL into a browser, a Privy Dashboard field or a backend.

The ERC-7677 URL always embeds a token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`); there is no tokenless default. A project server key (`ppk_`) is a secret and stays server-side. A client token (`ppt_`) works only from the project's allowed origins and is refused with `project_origin_not_allowed` when none are set. The free tier needs a verified Privy access token from PEPU's own Privy app (`context.privyAccessToken`, REST `Authorization: Bearer`); a third-party app's own Privy token is ignored for billing. v1 credentials no longer apply because the v1 paymaster is retired.

## Credential types

| Credential | Format | Who holds it | Browser-safe |
|---|---|---|---|
| Privy access token | JWT from Privy | The signed-in user | Yes |
| v1 app key | Raw key; the service stores only `sha256(key)` in `config/apps.json` | The operator and the app | The URL embedding it is a secret |
| Server key | `ppk_...`, secret | A project's backend | **No** |
| Client token | `ppt_...`, publishable | A project's frontend or Privy Dashboard | Yes, spends only from allowed origins |
| SIWE session | Opaque bearer, 1 hour | A project owner's browser | Yes |
| Admin token | `ADMIN_TOKEN` (v1), `SPONSORSHIP_ADMIN_TOKEN` (v2, 32 or more characters) | PEPU operators | **No** |
| Privy app secret | From the Privy dashboard | The developer | **No**, one call only |

`credentialKind(credential)` from `@pepu-chain/sdk/paymaster` tells `"client"` from `"server"` by prefix and never inspects more.

## Matrix by call path

| Call | v1 | v2 |
|---|---|---|
| `GET /health` | none | none |
| `GET /v2/config`, `/v2/contract`, `/v2/free-tier` | n/a | none |
| `POST /sponsor` | Privy token (`Authorization: Bearer`) **and** app key (`X-Api-Key`) | n/a |
| `POST /v2/sponsor` | n/a | `X-Api-Key` server key (any wallet) or client token (allowed `Origin`); Privy token required for the free tier |
| `pm_getPaymasterStubData` | none: the URL credential is not resolved (spec-compliant) | none: URL token only picks the sponsor id for the stub |
| `pm_getPaymasterData` | app key in the URL | `ppt_` or `ppk_` in the URL; `context.privyAccessToken` for the free tier |
| `/v2/auth/nonce`, `/v2/auth/login` | n/a | none (login is a SIWE signature) |
| `/v2/me`, `/v2/auth/logout` | n/a | SIWE session |
| `POST /v2/projects/verify` | n/a | SIWE session for `ownerAddress` plus the Privy app secret in the body |
| `POST /v2/projects/prepare` | n/a | SIWE session |
| `POST/GET /v2/projects...`, rotation, settings, usage, events, allowlist | n/a | SIWE session whose address is the **current on-chain owner** |
| `POST /admin/circuit-breaker/reset` | `X-Admin-Token` | n/a |
| `/v2/admin/*` | n/a | `X-Admin-Token`; 404 if unset, and not exposed on the hosted host (404) |

What each unlocks on the sponsorship path:

| Credential | Sponsors | Free tier | Origin check | On a leak |
|---|---|---|---|---|
| Server key `ppk_` | Any wallet, from the project's budget | No (needs a Privy token) | None | Rotate at once; bounded by the project's on-chain limits |
| Client token `ppt_` | Any wallet, only from `allowedOrigins` | With a Privy token | Yes; none configured means it cannot spend the project | Rotate; spend limited to the project's allowlist and daily limits |
| v1 app key | Registered app's budget | n/a | Optional `PAYMASTER_RPC_ALLOWED_ORIGINS` (speed bump) | Operator rotates; anyone with the URL can request sponsorship under the app's caps |

## How to obtain each

| Credential | How |
|---|---|
| Privy access token | From the signed-in Privy session, for example `getAccessToken()` in the Privy client |
| v1 app key | An operator generates a raw key, runs `npm run hash-api-key -- <key>` in the policy service and stores the hash in `config/apps.json`. There is no self-serve path in v1 |
| SIWE session | `api.v2.loginWithWallet(sign, { address, domain })`, or nonce then login by hand |
| Attestation | `requestClaimAttestation` from `@pepu-chain/sdk/paymaster/server` (server or CLI only) |
| Server key and client token | `POST /v2/projects` on a claimed project (`api.v2.projects.register`), **shown once** |
| Admin token | Set in the service environment by the operator |

## Rotation

| Credential | Rotate with | Effect |
|---|---|---|
| Client token | `POST /v2/projects/{id}/token/rotate` (`rotateClientToken`) | Old token stops immediately. Update the URL in the Privy Dashboard and any frontend |
| Server key | `POST /v2/projects/{id}/server-key/rotate` (`rotateServerKey`) | Old key stops immediately |
| Both, on ownership change | Automatic revocation when the on-chain owner changes (denial `project_owner_changed`) | The new owner rotates to get fresh ones |
| Lost token | `POST /v2/admin/projects/{key}/token/rotate` (admin) | Recovery |
| Suspend | `POST /v2/admin/projects/{key}/status` | Kill switch; does not touch funds |
| v1 app key | Operator replaces the hash in `apps.json` and restarts | Old URL dies |
| Privy app secret | Rotate in the Privy dashboard after verifying | The service never stored it |

## Rules

- A `ppk_` key never goes into a browser, a `NEXT_PUBLIC_` variable or a Privy Dashboard field. `buildErc7677Url` throws `CONFIG_SERVER_ONLY` for a server key in a browser.
- Origin binding is a browser guard: non-browser clients can forge `Origin`. The contract's limits are the real backstop.
- Never log or commit any of these. Only `sha256(rawKey)` goes in `apps.json`.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `unknown_or_invalid_app_credential` | Rotated, mistyped or wrong environment | Re-copy the credential, check which service it belongs to |
| `project_origin_not_allowed` | Client token used from an unlisted origin | Add the origin with `PATCH /v2/projects/{id}/settings` |
| `free_tier_identity_required` | No Privy token with a free-tier request | Pass `Authorization: Bearer` or `context.privyAccessToken` |
| `403` on an owner route | Session address is not the on-chain owner | Sign in with the owner wallet |
| Pasted URL stopped working | The token was rotated, or a tunnel URL changed | Re-issue and update the Dashboard |

## Related

- [Paymaster Overview](overview.md)
- [REST API v1](rest-api-v1.md), [REST API v2](rest-api-v2.md)
- [ERC-7677 Methods](erc7677.md)
- [Privy Dashboard Settings](../../privy/dashboard-settings.md)
