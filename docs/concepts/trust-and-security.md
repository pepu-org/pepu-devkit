# Trust and Security Model

States precisely what each mechanism protects against and who is trusted, so builders do not overclaim. Covers off-chain versus on-chain enforcement, secret handling and the session store. Read it before telling users what a session or sponsorship guarantees.

> Status: describes the mechanisms proven on mainnet. The v2 paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. Keep deposits small. The v1 paymaster is retired.

## Privy session signers (off-chain)

- Scope (one contract, listed functions, zero value, expiry) is enforced by Privy's backend policy engine on each signing request. You trust Privy and your policy configuration.
- It cannot bound gas; the user pays it.
- The authorization key lets your server request signatures for any wallet that granted its quorum, within each policy. A policy must always be attached; the SDK refuses to build an unscoped one.
- Revocation: `removeSigners` from the browser is the real revoke.
- Show `SESSION_TRUST_NOTICE["privy-offchain"]` on the consent screen.

## Kernel session keys (on-chain)

- Scope is enforced by the call policy v0.0.4 and timestamp policy contracts during UserOperation validation. It holds even if your backend is compromised.
- A leaked session key can act within the permission until expiry: the listed targets, selectors, value limit, validity window.
- The owner key never leaves Privy and the browser. The approval holds no secret.
- Revocation deletes the server key at once; the on-chain grant lapses at expiry (uninstalling is an owner-signed call a destination-allowlisted paymaster should not sponsor). Keep sessions short.
- Show `SESSION_TRUST_NOTICE["kernel-onchain"]`.

## Paymaster

- **Signer:** the paymaster contract trusts any signature from its authorized signer, so the signer key is a hot wallet for the deposit. Keep the deposit small and monitored.
- **Policy service:** signs only if the destination allowlist, per-user, per-app and global caps pass. The allowlist limits what sponsorship money can pay for; it does not protect the user's account.
- **Project deposits (v2, canary):** deposits only, no withdrawals by anyone. `projectId = keccak256(bytes(appId))`. Ownership is Privy-verified: verify the app secret, get an EIP-712 attestation, call `claimProject`. The claim sets the owner only; the owner then calls `setTargets`, `setDailyLimit` and `setSenderDailyLimit`. Re-claims, and the first claim of a project that already holds funds, are timelocked 48 hours and can be cancelled (the owner once per new owner). A project must have a per-wallet limit. Pausing is the exit. Free tier: 100 PEPU per user per day and 50 PEPU per hour (enforced by the service), verified Privy users from PEPU's own Privy app only, no chain-wide ceiling. Not externally audited.
- **A paymaster URL is a credential.** It embeds a token. A project client token (`ppt_`) is publishable but works only from the project's allowed origins (`project_origin_not_allowed` otherwise); a project server key (`ppk_`) is secret and belongs in a backend. A third-party app's own Privy token does not unlock the free tier.

## Secrets: where each may live

| Secret | May live | Never |
|---|---|---|
| `PRIVY_APP_SECRET` | Server env | `NEXT_PUBLIC_`, client code, git, logs |
| `PRIVY_AUTHORIZATION_KEY` | Server env | Same; a production signing key |
| Session private key | Server session store, encrypted at rest in production | Browser, logs |
| `PEPU_PAYMASTER_URL`, `PEPU_BUNDLER_URL` | Server env | Browser unless you accept exposing the credential |
| Policy service signer, bundler executor keys | Operator's secret store | Repo |
| `NEXT_PUBLIC_PRIVY_APP_ID`, quorum id | Public by design | n/a |

The SDK's server entries (`/privy/server`, `/session/server`, `/combo`, `/paymaster/server`) call `assertServerOnly` and refuse to load in a browser bundle. Server-only code never reads `NEXT_PUBLIC_` secrets. Doctor and MCP check tools report presence and length, never values. `requestClaimAttestation` sends your Privy app secret to the PEPU service for one request: use a dedicated app and rotate afterwards.

## Session store options

| Store | Durability | Use |
|---|---|---|
| `createMemoryStore()` | Lost on restart, not shared across instances, key in plaintext memory | Development and tests only |
| Your `SessionStore` on a database or KV | Durable | Production, with `sessionPrivateKey` encrypted at rest (KMS or envelope key) and an atomic or distributed `tryLock` |

## Threat table

| Threat | Privy mode | Kernel mode |
|---|---|---|
| Compromised app server | Can sign within each policy via the authorization key | Can act within the on-chain permission until expiry |
| Compromised Privy | Total over wallets | Cannot exceed the owner-signed permission, but controls the owner key |
| Leaked authorization key | Within policies, for all granting users | n/a |
| Leaked session key | n/a | Within scope until expiry |
| Out-of-scope call | Denied by Privy's engine | Fails EntryPoint validation |
| Gas drain of user | Possible: user pays | Sponsored; bounded by paymaster caps |
| Paymaster budget drain | n/a | Bounded by allowlist and caps |

Everything the SDK server boundary enforces: user id only from a verified token, owner address from Privy's records, calls re-checked against scope before signing, per-user lock and rate limit, approval bound to this account and permission id. For Kernel mode these are fail-fast checks; the chain is the real enforcement.

## Related

- [Session Keys](../onboarding/session-keys.md)
- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [Sponsorship Tiers](../onboarding/sponsorship-tiers.md)
- [Authorization Keys](../privy/authorization-keys.md)
- [Audits and Verification Status](../contracts/audits.md)
