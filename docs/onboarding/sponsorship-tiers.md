# Sponsorship Tiers

This page describes the v2 tiered paymaster: a free tier funded by the chain for Privy users, and per-project deposits for everyone else. It explains how a project is claimed, funded and configured, what stops a stranger draining a budget, and what a developer must configure to use it.

> Status: proven on mainnet as a canary. The `PepuSponsoredPaymasterV7` contract is deployed on PEPU mainnet at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (about block 10537341, 2026-10-14): deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. A project-sponsored operation from a fresh Kernel account holding 0 PEPU went through `bundler.pepeunchained.com` and `paymaster.pepeunchained.com/v2/paymaster/<server key>` (userOp `0x8150850431639387f95c14e2c1f7c857eb833b7b8e0826426dfcbb683d6b9907`, tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`); the paymaster paid 5.00 PEPU of gas including the account deployment and the project ledger went from 25 to 19.80 PEPU. Deposit small amounts until the external audit is done. The v1 paymaster is retired; see [Sponsored Transactions](sponsored-transactions.md).

## What you must configure

The free tier and the project tier are set up differently.

**The free tier (PEPU's own apps).** It needs a verified Privy access token from PEPU's own Privy app, sent in the ERC-7677 request as `context.privyAccessToken` (REST: `Authorization: Bearer`). A third-party app's own Privy token is ignored for billing and does not unlock the free tier, so the free tier is not available to third-party apps. The Privy Smart Wallets dashboard takes a static paymaster URL and cannot attach a token, so the free tier is not reachable there either. Third-party apps use a project.

**Your own project (any app).** In order:

1. Sign in with Ethereum (`/v2/auth/nonce`, `/v2/auth/login`).
2. Verify your Privy app: `POST /v2/projects/verify` with the Privy app id and secret (used for one request, never stored).
3. Claim the project (`claimProject`): immediate if the project is empty, pending 48 hours if someone already funded it.
4. Set the allowed targets and limits: `setTargets`, `setDailyLimit`, `setSenderDailyLimit`.
5. Deposit PEPU (`depositFor`). Deposits are one-way; nobody can withdraw them.
6. Register the project to get credentials: a client token (`ppt_`, publishable, works only from the allowed origins you set; with no origins, or from another origin, it is refused with `project_origin_not_allowed`) and a server key (`ppk_`, secret, for backends).
7. Set the allowed origins for the client token.

Then use `https://paymaster.pepeunchained.com/v2/paymaster/<token>` as the ERC-7677 URL. The recipe is [Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md).

## The model

Public gas sponsorship needs an answer to "who pays". The design splits it in two:

| Tier | Funded by | Who draws on it | Bound |
|---|---|---|---|
| **Free tier** | The chain, from a "free pool" the contract owner funds (seeded with 300 PEPU) | **Users with a Privy account in PEPU's own Privy app only** (a verified Privy access token is required) | **100 PEPU per user per day and 50 PEPU per user per hour**, a 40 PEPU per-operation cap, and an on-chain per-wallet backstop. There is **no chain-wide daily ceiling**: gas funds can only pay gas, so a ceiling that limited the whole chain to a handful of heavy users was judged worse than the risk |
| **Project tier** | A project, which anyone can fund by depositing PEPU on-chain (deposits are one-way) | **Any wallet**: Privy users, non-Privy users, native or EOA wallets behind smart accounts | The project's on-chain balance, daily limit, per-wallet daily limit, destination allowlist and a cap on the gas price per operation |

For each operation the order is:

1. If the request belongs to a claimed project and that project can pay, **the project pays**.
2. Otherwise the operation falls to the **free tier**, but only if the user has a verified Privy account and still has free allowance.
3. Otherwise it is denied, with a reason for each tier tried.

The free tier **never pays for a project's non-Privy wallets**. If a project's balance runs out, those wallets are denied; they do not fall through to the chain's money. An operation is never split between tiers, and operations already approved are unaffected when a balance runs out.

The values (all configurable in the service, with the on-chain bounds in the contract):

- Free tier per user: 100 PEPU in a rolling 24 hours and 50 PEPU in a rolling hour (enforced by the service), and count caps (40 a day, 20 an hour). Free-tier targets are TapScore only for now (`0x261eA5971B93237a56990206A46Bc80318e4d078`); the manager can add more. The first operation, which deploys the user's smart account, costs about 12 PEPU worst case and normal operations about 3 PEPU.
- Maximum cost per operation: 40 PEPU.
- Project per-user cap in the service: default 200 PEPU a day, adjustable by the project up to an administrator maximum.
- Deposits cannot be withdrawn, by anyone. The timelock on the chain's signer and bundler changes is immutable and at least 48 hours; a project's defence during that window is to pause.
- Gas price cap: every sponsor has an on-chain cap on an operation's `maxFeePerGas` (a contract-wide default, 40,000 gwei in the deploy, about three times today's base fee; a project can set its own lower or higher cap, the chain sets the free pool's). The policy service also refuses operations whose gas limits or fees are out of bounds against the current base fee.
- Approval validity: 60 seconds.

## How a project uses it

Everything funds-related is a plain contract call. **Deposits need no registrar, administrator or API approval, and none of it requires the policy service.**

**Deposits are one-way.** Anyone can deposit into any project (even one nobody has claimed yet) and into the free pool. Nobody can withdraw: not the project owner, not the contract owner, not the manager. The only way PEPU leaves is as gas paid for the sponsored operations of that project or pool. A project is one Privy app, with the id `keccak256(appId)`; a stranger who funds your app's project does not harm you or your users, they only top up your gas budget. The trade-off: funds put into a project that is never claimed, or whose owner disappears, stay locked.

1. **Deposit (anyone).** `depositFor(projectId)`. Check who controls the project's settings first: `getProject(projectId)` returns the owner address, and `address(0)` means "not claimed yet" (the money is in the project's ledger but cannot be spent until someone claims it).
2. **Claim it (the app's developer).** Settings (the destination allowlist, limits, gas price cap, pause) belong to the project's owner, and ownership is proven on-chain with a signed attestation. The developer signs in with a wallet (Sign-In With Ethereum), then calls `POST /v2/projects/verify` with their Privy `appId`, Privy `appSecret` and wallet address. The service checks the secret against Privy's API and returns a short-lived, single-use attestation naming that wallet. The secret is used for one request and is never stored, logged or echoed; you can rotate it in the Privy dashboard afterwards. Submitting the attestation to the contract (`claimProject`) makes the wallet the owner immediately if the project holds no funds; if anyone has already deposited into it, the claim is pending for the contract's timelock (at least 48 hours, announced by an event, cancellable by the contract owner or manager) and anyone finishes it with `executeReclaim`, so claim before anyone funds the project. The claim sets no configuration, so nothing is sponsored yet: the owner then sets the allowlist (`setTargets`, the contracts the project will sponsor calls to; the contract rejects anything else) and the daily and per-wallet limits (`setDailyLimit`, `setSenderDailyLimit`; the contract rejects a project with no per-wallet limit). The attestation must be submitted within the hour. Use the Privy app id exactly as shown in the Privy dashboard (it is case-sensitive).
3. **Re-claim if you lose the wallet.** If a project already has an owner, a new attestation starts a re-claim (`reclaimProject`). It takes effect only after the contract's timelock (at least 48 hours), is announced by an event, and the current owner can cancel it (once per new owner: a second attested re-claim by the same wallet cannot be cancelled); a re-claim proposed before a signer was removed never executes, even if that signer is later re-added. When the owner changes, the previous owner's server key and client token stop working and the new owner issues fresh ones. For a voluntary handover to a multisig, use the two-step `proposeProjectOwner` / `acceptProjectOwnership` instead.
4. **Get credentials (convenience layer).** To have the policy service sign sponsorships, index the project. You get two credentials, each shown once:
   - a **server API key** for your backend. It works for any wallet and has no origin restriction. Never ship it to a browser.
   - a **publishable client token** (a paymaster URL, `https://<host>/v2/paymaster/<token>`, for the Privy Smart Wallets field or any ERC-7677 client). It can spend your budget **only from the origins you allow**.
5. **Manage it on-chain.** Allowlist changes, limits and pausing are transactions the owner signs. The API only encodes calldata; **funds never move through it.** Two optional per-project controls: `setMaxFeePerGas` (your own cap on the gas price per operation) and `setRequiredAccountCodehash` (only sponsor accounts whose code matches the one you pin; without it the destination allowlist is a usage policy for Kernel-shaped accounts, because a contract that mimics Kernel's `execute` selector can pass the check).
6. **Watch the contract's `AdminChangeProposed` events, and pause if you do not trust one.** The chain's operators can add a signer or a bundler, but only after the immutable timelock (at least 48 hours) following the proposal. Because deposits cannot be withdrawn, **pausing is a project's exit**: a paused project's balance cannot be spent by anyone, whatever the signer signs. Inside the same window you can also lower your gas price cap and limits. Removals of signers and bundlers are instant.

**Who can be the gatekeeper of ownership?** The policy service's signer. A compromised signer could claim a project nobody has claimed yet (at once if it is empty, after the timelock if it holds funds), or start a re-claim of an owned one, but it can never withdraw funds, because no withdrawal exists. A claim of a funded project and a re-claim are visible on-chain, take at least 48 hours, can be cancelled, and die if the signer is removed.

### What stops a stranger draining a project's budget

A project can sponsor wallets it has never seen, so identity is not the control. Authorization is:

- **Who may ask:** the secret server key (from your backend), or the client token from an allowed origin. A project with no allowed origins can only be used with its server key. Browsers enforce the origin check; a non-browser client can forge an `Origin` header, so it is a speed bump, not a wall.
- **The contract's own limits**, which hold even if the policy service or its signing key were abused: calls only to the project's allowlist, a per-wallet daily limit, a project-wide daily limit, and the project's balance.
- **The service's per-user daily cap**, and the option to require a verified Privy identity for a project that wants it.
- **Reservation caps against lock-out.** An approval that is never executed still holds budget in the service until its 60 second signature expires. Someone holding the public client token could request approvals for made-up wallets to lock honest users out, so a client token is limited to 2 unexecuted approvals per wallet, 5% of the budget per source address and 25% in total (never below two worst-case operations), plus a per-address rate limit. The server key is not limited this way. This reduces the attack rather than ruling it out: an attacker with many source addresses can still hold the client-token pool; rotate the token to cut them off.

The worst a leaked client token can spend is bounded by the project's own limits.

## Surplus and refunds

Each operation prepays its worst-case cost from the sponsor's balance and the unused part is refunded **to the exact sponsor that was charged**, in the post-operation step. A small residue is genuinely unattributable (the contract charges the post-operation overhead as a fixed gas amount, and EntryPoint's real cost differs slightly). That residue accumulates as unallocated deposit and can only be credited **to the free pool**, by anyone, above a small solvency buffer. No function sends it to the owner.

## Ownership

The deployer is the contract's owner by default. Ownership transfers in two steps (`transferOwnership` then `acceptOwnership`) and can be renounced. The owner controls the free pool's settings (its per-operation cap, gas price cap and per-wallet limit), the operational manager address, lowering the post-operation overhead, unlocking and withdrawing stake (a separate balance that is never part of any sponsor's money). Nobody, the owner included, can withdraw from the free pool or from any project, and the owner cannot touch any project's owner or settings. A separate **manager** address (the deploy script asks for one and refuses to deploy with the same key as owner and manager unless explicitly acknowledged) runs day-to-day operations: it can remove signers and bundlers instantly, pause the free tier, and propose additions, which only take effect after the timelock described above. The specification states exactly what this does and does not guarantee (a compromised signer and bundler that were already authorised can still burn each project's daily limit until the signer is removed). If the owner renounces, none of those owner powers exist any more, but claiming, depositing into and running a project, and the free tier itself, keep working. See the specification for exactly what a renounce makes impossible.

## The API

The policy service's v2 API is described in an OpenAPI document, `openapi.yaml`, in the devkit repository under `services/paymaster/policy-service/`. The v2 routes are live on the hosted service at `https://paymaster.pepeunchained.com`; `/v2/admin` is not exposed publicly. In summary:

| Group | Authentication | Purpose |
|---|---|---|
| Public | None | `GET /v2/config`, `GET /v2/contract` (address and ABI), `GET /v2/free-tier` (pool state and allowance) |
| Auth | Sign-In With Ethereum | `GET /v2/auth/nonce`, `POST /v2/auth/login`, `POST /v2/auth/logout`, `GET /v2/me` |
| Project owner | Session bearer token; the address must equal the project's current on-chain owner | Prepare transactions (`POST /v2/projects/prepare`), verify a Privy app and get a claim attestation (`POST /v2/projects/verify`), index a project, rotate its client token or server key, set allowed origins and off-chain settings, read usage, events and allowlist |
| Administrator | A separate admin token (the routes are absent when it is unset) | Overview, free-tier-only apps, suspend or rotate an app credential, run the reconciler |
| Sponsorship | Server API key, or client token from an allowed origin. Free tier: a Privy access token | `POST /v2/sponsor`, and the ERC-7677 endpoint `POST /v2/paymaster/{token}` |

All amounts are decimal wei strings.

## Canary limits

- **External audit pending.** The contract holds third-party money in an immutable deployment. An internal AI-assisted review (`services/paymaster/audits/2026-10-internal-review.md`) found and fixed issues, but it is explicitly not an external audit. The design's own threat model lists the missing external audit as the top residual risk. Deposit small amounts, in small tranches, and do not point production traffic at it before one is done.
- **Limited mainnet exercise.** It is covered by unit, fuzz and invariant tests and has one mainnet proof (above), but has not carried production traffic. The paymaster relies on PEPU's bundler with the standard opcode ban switched off (it checks the transaction's origin), so it cannot be used through a conformant public bundler.
- **Owner and manager.** Owner `0x5966dFaB11c8AEe767e0739083417D02f4a634A1`, manager `0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0`.

## The SDK and tools that map to this

All of these are in `@pepu-chain/sdk/paymaster` (isomorphic) unless marked server-only. The registry's `paymasterV2` entry (and its `paymaster` alias) points at the deployed canary, so calls default to it; pass `paymaster` explicitly to override. `createPepuPaymasterClient` and `createPepuSponsoredClient` accept `paymasterToken` and build the URL against the hosted base.

| Step | SDK | MCP tool |
|---|---|---|
| Project id | `computeProjectId(appId)`, which is `keccak256(bytes(appId))`; the app id is case-sensitive | `pepu_project_balance` returns it |
| Read a project | `readProject` (owner, claimed, balance, limits, spent today, paused, pending reclaim) | `pepu_project_balance` |
| Deposit (one-way) | `encodeDeposit`, `depositFor` | `pepu_prepare_project_tx` |
| Prove ownership (server or CLI only) | `requestClaimAttestation` from `/paymaster/server`; it sends your Privy app secret to the policy service for one request | none, by design |
| Claim | `encodeClaimProject`, `encodeClaimFromVerification`, `encodeReclaimProject` | `pepu_prepare_project_tx` |
| Configure (owner only, after the claim) | `configureProject`, `encodeSetTargets`, `encodeSetDailyLimit`, `encodeSetSenderDailyLimit`, `encodeSetPaused` | `pepu_prepare_project_tx` |
| Re-claim lifecycle | `encodeExecuteReclaim`, `encodeCancelReclaim`, `encodeProposeProjectOwner`, `encodeAcceptProjectOwnership` | `pepu_prepare_project_tx` |
| REST client | `createPaymasterApi` (defaults to the hosted base), `buildErc7677Url`, `hostedErc7677Url(token)`, `hostedFreeTierUrl()` | |
| Denial reasons | `mapPaymasterReason`, `paymasterReasonToError`, `PAYMASTER_DENIAL_REASONS` | `pepu_explain_error` |

The claim sets the owner only. After it, the owner must call `setTargets`, `setDailyLimit` and `setSenderDailyLimit` before anything is sponsored. The skill is `pepu-paymaster-projects` and the recipe is [Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md). Infra pages: [Paymaster Overview](../infra/paymaster/overview.md), [REST API v2](../infra/paymaster/rest-api-v2.md), [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md), [PepuSponsoredPaymasterV7 Contract](../infra/paymaster/contracts.md), [Paymaster v2 Spec Summary](../contracts/paymaster-v2-spec.md), [Audits and Verification Status](../contracts/audits.md).

## Common failures

| `code` | Cause | Fix |
|---|---|---|
| `PAYMASTER_PROJECT_NOT_CLAIMED` | The project has funds but no owner yet | Claim it, then configure it |
| `PAYMASTER_PROJECT_OWNER_CHANGED` | A re-claim executed since the credential was issued | Issue fresh credentials as the new owner |
| `PAYMASTER_PROJECT_PAUSED` | The owner paused the project | Unpause it with `encodeSetPaused` |
| `PAYMASTER_NO_BALANCE` | The project balance cannot cover the operation | Deposit more PEPU; deposits cannot be withdrawn |
| `PAYMASTER_FREE_TIER_UNAVAILABLE`, `PAYMASTER_IDENTITY_REQUIRED` | The free tier needs a verified Privy access token | Send the token as paymaster context |
| `PAYMASTER_CAP`, `PAYMASTER_RATE_LIMITED` | A project, per-wallet or free-tier limit, or a rate limit | Wait for the window or raise the limit |

## Related

- [Sponsored Transactions](sponsored-transactions.md): the sponsorship flow and proofs.
- [The Two-Address Model](two-address-model.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
- [/paymaster](../sdk/paymaster.md)
