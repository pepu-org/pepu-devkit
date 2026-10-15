# Audits and Verification Status

What has and has not been reviewed, tested or verified for each PEPU contract. **There has been no external audit of any PEPU-authored contract.** The only reviews are three internal, AI-assisted reviews of the v2 paymaster, produced with the [pashov](https://github.com/pashov/skills) `solidity-auditor` methodology. They are not third-party audits, carry no assurance from an independent firm and cannot prove the absence of vulnerabilities. Read this before depositing into or depending on any of these contracts.

> Status: v2 paymaster **deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches**. v1 paymaster **retired** (deposit withdrawn), tested, never externally audited. Third-party contracts (ZeroDev Kernel and EntryPoints, Permit2, Multicall3) are upstream code deployed unmodified; PEPU has not audited them.

## Per-contract table

| Contract | Address | Source verified | Tests | Audit status |
|---|---|---|---|---|
| Paymaster v1 `PepuVerifyingPaymasterV7` | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | Deployed, now retired; byte-for-byte hash cross-check with the policy service (frozen golden vector) | 18 Foundry tests (17 security tests plus the cross-check) | **None external.** Retired: its EntryPoint deposit was withdrawn and it cannot sponsor anything. A fork of Pimlico's singleton paymaster with ERC-20 mode removed. Not covered by the 2026-10 internal reviews, which target v2 |
| Paymaster v2 `PepuSponsoredPaymasterV7` | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | Deployed on mainnet as a canary (2026-10-14) | 195 Foundry tests (18 v1, 177 v2: unit, fuzz, 6 invariants, a real-EntryPoint v0.7 harness, reentrancy, cross-language vectors, review-3 regressions; also at 2,000 fuzz runs) and 328 policy-service tests; one project-sponsored operation proven on mainnet through the hosted URLs | **Three internal reviews, external audit pending.** Funded in small tranches. Do not deposit large amounts before an external audit |
| Multicall3 | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | Verified on pepuscan; built from canonical `mds1/multicall3` source with canonical settings | Confirmed working with viem's `multicall()` | Upstream code, no PEPU changes. No PEPU audit |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Exact upstream creation bytecode; address reproduced independently by `prove-address.sh` | `DOMAIN_SEPARATOR()` call checked | Upstream code, no PEPU changes. No PEPU audit |
| EntryPoint v0.6 and v0.7, Kernel v3.1, validator, signer, call and timestamp policies | see [Address Map](address-map.md) | ZeroDev deployments through Conduit Marketplace | `eth_getCode` live check; Kernel flows exercised on mainnet | ZeroDev's own audits apply to upstream code; PEPU did not review them. Call policy v0.0.4 is used because v0.0.5 is not deployed |
| TapScore | `0x261eA5971B93237a56990206A46Bc80318e4d078` | Verified on pepuscan | Used by templates and demos | A demo contract. Not for value |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | Standard deployer, 69 bytes | n/a | Widely used upstream |

"Verified source" means the source is published on pepuscan or reproducible from the repository; it does not mean audited. The registry check `pnpm --filter @pepu-chain/sdk live-check` confirms bytecode exists (last run 2026-10-03); it proves nothing about correctness.

## The three internal reviews of v2

All three live in `services/paymaster/audits/`. The findings are reproduced as written there; each file begins with a fix-status table.

1. **`2026-10-internal-review.md`** reviewed commit `dafc259` (contract, EntryPoint interaction, deploy script, signing service). It built a harness on the real EntryPoint v0.7 sources because the existing solvency tests used a mock. 118 tests passed at baseline. 0 Critical, 0 High, 2 Medium, 5 Low, 8 Info.
2. **`2026-10-delta-review.md`** (2026-10-02) reviewed the later deposit-only and attested-claim changes (`f55527f..c354508`) that the first review did not cover. 1 Medium, 4 Low, plus cheap leads, all fixed afterwards. Baseline 165 Foundry and 235 vitest tests passing; 171 and 246 after the fixes.
3. **`2026-10-review-3.md`** (2026-10-09) reviewed commit `4882bd3` with three parallel auditors (economics and accounting; access control and governance; ERC-4337 conformance and the signer service), all on the real EntryPoint v0.7. 0 Critical, 0 High, 3 Medium, 6 Low, plus Info items and leads. The Medium and Low findings and three Info items were fixed afterwards; the rest are documented.

### Fix status: first review

| ID | Severity | Finding | Status |
|---|---|---|---|
| M-1 | Medium | Unexecuted approvals count as outstanding; the public client token could lock a project's budget | Mitigated: reservation caps (2 per wallet, 5% per IP, 25% total), per-IP rate limit, 60 s window, replace-on-retry. Residual: many-address attacker can saturate the client-token pool |
| M-2 | Medium | Manager or owner can extract funds indirectly (add signer plus own bundler) | Fixed, claims restated: additions timelocked, on-chain fee cap, separate manager role at deploy. Residual: gas quantities not capped on chain; an already-authorised signer plus bundler can burn daily limits |
| L-1 | Low | Daily counter refund skipped for stale-day operations | Fixed: context records the bucket the reservation landed in |
| L-2 | Low | Allowlist checks calldata shape, not account type | Mitigated: optional per-project codehash pin. Residual documented |
| L-3 | Low | `tx.origin` gate banned by ERC-7562; `address(0)` allowlist divergence | Documented: v2 supported only behind a self-run bundler with safe mode off |
| L-4 | Low | Service signs any user gas fields | Fixed: gas and fee bounds in the service plus an on-chain fee cap |
| L-5 | Low | Post-op overhead floor 14,000 below the attacker-forceable 14.5k | Fixed: floor 18,000, deploy default 20,000 |
| I-1 | Info | Dead 64-byte signature branch | Fixed |
| I-2 | Info | Renounce and manager footguns | Unchanged, documented |
| I-3 | Info | Owner = manager = deployer defaults; script key handling | Partly fixed: owner and manager separated in the script; the `eval` of `.env` and `--private-key` flag unchanged (use a keystore or hardware wallet) |
| I-4 | Info | Free pool has no outflow ceiling | Unchanged (decision) |
| I-5 | Info | `validAfter = now` has no clock-skew tolerance | Fixed: 5 s skew |
| I-6 | Info | Manager could `unlockStake` | Fixed: owner only |
| I-7 | Info | `ECDSA.recover` reverts on malformed signatures | Fixed: signature failure, not a revert |
| I-8 | Info | Worst-case penalty charged unconditionally | Unchanged, documented |

The first review predates the deposit-only change, so its findings about withdrawals, the withdraw-delay-derived timelock and registrant-namespaced ids describe a design that no longer exists.

### Fix status: delta review

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 (M1) | Medium | A signer-chosen mode bit disabled the `tx.origin` bundler gate | Fixed: mode byte must be exactly `0x02`; gate always enforced |
| 2 (L1) | Low | A stranger could exhaust the verify limiter and lock out the owner | Fixed: failure budget keyed on (app id, SIWE address), charged only when Privy rejects |
| 3 (L2) | Low | Attestation did not bind targets and limits | Fixed: claim sets only the owner; owner configures afterwards |
| 4 (L3) | Low | Pending re-claim survived a voluntary transfer and revived when a signer was re-added | Fixed |
| 5 (L4) | Low | Credentials issued to the previous owner kept working | Fixed: revoked on owner change (`project_owner_changed`) |
| Lead | Cheap | Spoofable per-IP limits via leftmost `X-Forwarded-For` | Fixed: rightmost-by-hops |
| Lead | Cheap | App id case handling | Documented, no code change |
| I-6, I-8, I-5 | Info | No cap on attestation deadline; no upper bound on delay; tautological asserts | Fixed |
| I-2 | Info | Claim attestor and sponsorship signer share one signer set | Documented (needs a separate role; does not fit the contract size) |
| I-1, I-3, I-4, I-7 | Info | Stranded `keccak256("")` deposits, self re-claim, derived deposit, signer status unchecked | Documented only |
| Lead | | Privy cross-app check | **Open**: needs a live two-app test before launch |
| Lead | | First claim immediate for funded unclaimed projects | **Fixed in review 3 (M-1)**: pending for the admin delay, cancellable |

### Fix status: review 3

| ID | Severity | Finding | Status |
|---|---|---|---|
| M-1 | Medium | A funded, unclaimed project has no pause defence (a compromised manager can claim and drain it after the 48 h bundler/signer timelock) | Fixed: the first claim of a funded project is pending for `adminChangeDelay`, signer-bound, cancellable by the contract owner or manager; sponsor fee caps cannot exceed the immutable default. Residual: after a renounce with a rogue manager nobody can cancel |
| M-2 | Medium | A hostile owner can veto a recovery re-claim forever | Fixed: one veto per (project, new owner); the second attested re-claim by the same new owner is final and survives an ownership transfer |
| M-3 | Medium | Unthrottled denials write a SQLite audit row each; ERC-7677 junk tokens dodge the limiter | Fixed: unknown credentials are not persisted, per-IP limiters before the body is read, 30-day audit retention |
| L-1 | Low | Projects get no per-wallet limit after a claim | Fixed: a project with no per-wallet limit fails closed on chain and in the service |
| L-2 | Low | A manager can re-lock the owner's unlocked stake for 136 years | Fixed: `addStake` is owner-only, delay at most 30 days |
| L-3 | Low | Removing `address(0)` as a bundler is irreversible | Fixed: `address(0)` can be re-proposed as a bundler |
| L-4 | Low | Replacing an approval for the same nonce undercounts signed exposure | Fixed: the larger reservation stays until the old one expires |
| L-5 | Low | `allowAccountDeployment=false` not enforced on `/v2/sponsor` | Fixed: enforced in the engine |
| L-6 | Low | Real worst-case postOp was 16.2k to 18.1k gas against the 18,000 floor | Fixed: overhead snapshotted at validation; worst case 13,918 |
| Info | | B5 expiries, C-L1 appId binding, A7 free-tier validation, openapi 400/413 | Fixed |
| Info | | C-L2 log rescans, A4 overcharge, A5 midnight gap, A6 immutable fee cap, A8 stranded funds, free-pool sybil cost, B leads, ERC-7562 bundler conformance | Documented in the spec (section 16.3), not fixed |

## Known gaps

- **No external audit** of the immutable v2 contract that will hold third-party money, and none of v1.
- **No fork test** against the PEPU chain's real EntryPoint v0.7 and Nitro gas schedule. The harness uses vendored sources on a local EVM, so the 18,000-gas post-op floor has not been re-measured on PEPU.
- **No Alto canary** for the v2 `tx.origin` gate and storage access.
- No automatic on-chain reconciliation for v1; the v2 reconciler is untested against a live deployment.
- The review lens was AI-only (one sequential reviewer for the first two reviews, three parallel reviewers for the third): no independent human review.
- Contract size margin is 854 bytes, and only because the contract is compiled with 8,000 optimizer runs (25,115 bytes at 1,000,000); any change needs a re-check.

## How to report an issue

Do not open a public issue for a vulnerability. Follow [SECURITY.md](../../SECURITY.md): email contact@pepeunchained.com with a description, reproduction steps, the affected package or file and whether it touches deployed contracts. The policy covers this repository's code (the paymaster contracts and services live here too; if in doubt, send it); it does not cover the chain, Conduit, pepuscan or third-party contracts such as Kernel.

## Related

- [Paymaster v2 Spec Summary](paymaster-v2-spec.md)
- [PepuSponsoredPaymasterV7 Contract](../infra/paymaster/contracts.md)
- [Address Map](address-map.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
