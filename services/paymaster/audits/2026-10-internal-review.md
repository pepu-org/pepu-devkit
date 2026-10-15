# Internal Security Review: PEPU Sponsored Paymaster v2 (PepuSponsoredPaymasterV7)

> **THIS IS AN INTERNAL REVIEW, NOT AN EXTERNAL AUDIT.** It was produced in October 2026 by an AI assistant following the
> pashov `solidity-auditor` methodology (https://github.com/pashov/skills), executed sequentially by one reviewer. It is
> not a third-party audit, carries no assurance from an independent firm, and cannot prove the absence of
> vulnerabilities. An external audit of the immutable contract and a fork test against the actual PEPU chain remain
> required before any deployment with real funds (see `../SPONSORSHIP-SPEC.md`, section 13a).
>
> Reviewed commit: `dafc259`. The findings below are reproduced as written; the **Fix status** section after the
> severity matrix records what was changed in response and which tests pin each fix. The review's original PoCs were not
> committed: they were turned into the regression tests named there.

> **Post-review changes (delta review pending).** After this review the owner decided that deposits are one-way, and the
> contract and service were changed accordingly: every withdrawal path was removed (project withdrawals, the withdraw
> delay, the owner's free-pool withdrawal); project identity became `keccak256(appId)` with settings ownership proven by
> an EIP-712 attestation from a signer (first claim immediate, re-claims timelocked and cancellable); the admin timelock
> became a fixed immutable delay of at least 48 hours with pause as the project exit; and the policy service gained
> `POST /v2/projects/verify`. The findings below were written against commit `dafc259` and are **not rewritten**: those
> that concern withdrawals, the withdraw-delay-derived timelock (M-2) or registrant-namespaced ids describe a design that
> no longer exists, and the new claim, re-claim and attestation code has **not** been reviewed. An internal delta
> review of these changes is pending, and the external audit remains outstanding. See `../SPONSORSHIP-SPEC.md`
> (decisions D15 to D18, section 9).

Method: pashov `solidity-auditor` methodology, executed sequentially by one reviewer (no sub-agents). AI-assisted review; it cannot prove the absence of vulnerabilities.

---

## Scope

| | |
|---|---|
| **Repo / commit** | this repository, branch `main`, HEAD `dafc259` (working tree clean before and after the review; nothing in the repo was edited by the review) |
| **Primary** | `services/paymaster/contracts/src/PepuSponsoredPaymasterV7.sol` (784 lines, every line read) |
| **EntryPoint interaction** | vendored `lib/account-abstraction-v7` (v0.7.0) `EntryPoint.sol` (`_executeUserOp`, `innerHandleOp`, `_postExecution`, `_validatePaymasterPrepayment`, penalty code), OpenZeppelin 5.0.2 `ECDSA`, `Ownable2Step` |
| **Deploy** | `services/paymaster/contracts/deploy-sponsored-paymaster.sh` |
| **Signing side** | `services/paymaster/policy-service/src/sponsorship/{paymasterData,engine,identity,rpc}.ts`, plus `../userOpHash.ts`, `../kernelDecoder.ts`, `../cost.ts`, and `db.ts`, `reconciler.ts`, `rateLimit.ts`, `config.ts` where the signing side depends on them |
| **Spec** | `services/paymaster/SPONSORSHIP-SPEC.md` (read in full; code vs spec in the last section) |
| **Confidence threshold** | 75 (pashov `judging.md`); every finding below was verified against code, and Medium/Low findings that could be reproduced have a failing PoC |

### Skill files used (from `https://github.com/pashov/skills`)

`solidity-auditor/SKILL.md` (orchestration, exclude pattern, deploy scripts stay in scope), `references/judging.md` (4 gates, confidence scoring, safe patterns, lead promotion, do-not-report), `references/report-formatting.md` and `references/report-language.md` (finding shape and wording), `references/hacking-agents/shared-rules.md`, and the attack-surface prompts `economic-security`, `access-control`, `execution-trace`, `invariant`, `periphery`, `first-principles`, `asymmetry`, `boundary`, `numerical-gap`, `trust-gap`, `flow-gap`, `math-precision` (each used as a lens: I walked the contract once per lens). `senior-auditor-sop.md` and `agent-prompts.md` were consulted for method. Not used: `fizz`, `x-ray`, `static` (not Solidity-audit skills), and the loop/memory/assembler machinery (`assemble.sh`, ledger), which exists to merge parallel-agent output and was not needed for a single sequential pass. I produced the report by hand in the pashov shape, extended with the sections you asked for (severity matrix, PoC, gas, spec vs code).

---

## Methodology

1. Read the skill, then the contract line by line; listed every state variable, every external entry point, and every value flow (ledger credit, debit, refund, withdrawal, surplus).
2. Re-derived the EntryPoint v0.7 behaviour from the vendored source instead of trusting the contract comments or the repo's `MockEntryPointSim`.
3. Built a **real EntryPoint v0.7 harness** (`AuditRealEP.t.sol`: the vendored `EntryPoint.sol`, a Kernel-shaped account implementing `execute(bytes32,bytes)`, the real paymaster) because every existing solvency test uses a mock (spec 13a asks for exactly this check). Ran honest and adversarial ops and compared the EntryPoint's true debit with the ledger charge.
4. Baseline: ran the existing suite (118 tests) in a copy of `services/paymaster/contracts` under upstream Foundry 1.5.1 in WSL.
5. Reviewed the signing path against the contract's `getHash`, then the engine/identity/db/reconciler for replay, validity window, sponsorId binding, and budget griefing. Wrote a vitest PoC in a copy of `policy-service` (node_modules junctioned, repo untouched).
6. Applied the four gates; findings that failed a gate or could not be reproduced were dropped or marked unconfirmed (see "Ruled out").

Baseline result: `forge test` => **118 passed, 0 failed** (matches spec section 15). My additions (all in the scratch copy): 6 tests in `poc/AuditRealEP.t.sol` and 1 vitest in `poc/audit.poc.test.ts`.

---

## Severity matrix

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 2 | M-1, M-2 |
| Low | 5 | L-1 to L-5 |
| Info | 8 | I-1 to I-8 |

| ID | Title | Severity | Likelihood | Impact | PoC |
|---|---|---|---|---|---|
| M-1 | Unexecuted approvals count as "outstanding" and lock a project (or the free pool) out; anyone with the public client token can do it | Medium | High | Medium (availability, no fund loss) | vitest, fails as expected |
| M-2 | Manager (and owner) can extract project money indirectly (add signer + add own bundler); spec T3/I4/I6 overstate "no privileged account can reach project money" | Medium (trust model) | Low | High | reasoning + existing code; not run |
| L-1 | Daily-counter refund is skipped when the op's `validAfter` day is older than `spentDay` (counter leak at midnight) | Low | Medium | Low | Foundry, fails as expected |
| L-2 | Destination allowlist checks calldata shape, not account type: any contract that fakes the Kernel selector bypasses it; project path verifies neither sender nor factory | Low | Medium | Low/Medium | reasoned (T11, OQ10 acknowledge) |
| L-3 | `tx.origin` bundler gate: `ORIGIN` is banned in ERC-7562 validation; `address(0)` on the allowlist makes simulation diverge from inclusion | Low | Medium | Low | reasoned (spec "top risk 4" acknowledges the ORIGIN half) |
| L-4 | Signing service signs any gas limits and fees the user supplies; sponsor pays for padded `preVerificationGas` and priority fee up to the cap | Low | Medium | Low | reasoned |
| L-5 | `MIN_POSTOP_OVERHEAD_GAS` (14,000) is below the postOp gas an attacker can force on the real EntryPoint (14.5k measured); solvency then rests on the penalty over-collection | Low | Low | Medium if the margin ever flips | Foundry measurement; no insolvency reproduced |
| I-1 | The 64-byte signature branch is dead code (OZ 5.0.2 `recover(bytes)` rejects length 64) | Info | | | Foundry, passes |
| I-2 | Renounce and manager footguns (documented T17) | Info | | | |
| I-3 | Deploy defaults: owner = manager = deployer EOA; key material handling in the script | Info | | | |
| I-4 | Free pool has no outflow ceiling (decision D1) | Info | | | |
| I-5 | `validAfter = now` has zero clock-skew tolerance | Info | | | |
| I-6 | Manager can `unlockStake()` to knock the paymaster out of "staked" status | Info | | | |
| I-7 | `ECDSA.recover` reverts on malformed signatures instead of returning sig-fail | Info | | | |
| I-8 | Worst-case penalty is charged unconditionally; the overcharge goes to the free pool | Info | | | |

No Critical or High was found. Specifically, ledger insolvency (one sponsor's EntryPoint debit exceeding its ledger charge so other sponsors' money is spent) was attacked against the real EntryPoint and **was not reproducible**; see L-5 and "Ruled out".

---

## Fix status

Added after the review. "Fixed" means the code changed and a test pins it; "Mitigated" means the risk is reduced but a
residual remains (stated); "Documented" means no behaviour change, with the reasoning. Test names refer to
`services/paymaster/contracts/test/` (Foundry) and `services/paymaster/policy-service/test/` (vitest).

| ID | Status | Fix | Pinned by |
|---|---|---|---|
| M-1 | **Mitigated** | Client-token reservations are capped per wallet (2 unexecuted approvals), per IP (5% of the project budget, never below 2 worst-case ops) and in total (25%); per-IP rate limit on the client-token path (30 evaluations/min); approval window 90 s to 60 s with reservations expiring with their signature (live-only accounting, no reconciler wait); a re-request for the same (sender, nonce) replaces the earlier approval; reconciler margin 120 s to 60 s, interval 30 s to 15 s. The secret server key is exempt. On-chain limits are unchanged and remain the backstop. Residual: an attacker with many source addresses can saturate the 25% client-token pool (not the server-key path, not the other 75% of the budget). | `policy-service/test/sponsorship/reservations.test.ts`, block "M-1" (the review PoC, now passing: the honest user is approved while the attacker floods) |
| M-2 | **Fixed** (trust claims restated exactly) | (a) Signer and bundler ADDITIONS are timelocked by `withdrawDelay + 1 day` (`adminChangeDelay`, immutable, set by the constructor); initial signers and bundlers are constructor arguments; removals stay instant and cancel pending additions. (b) On-chain cap on an op's `maxFeePerGas`: an immutable contract default, overridable per project (`setMaxFeePerGas`, project owner) and for the free pool (`setFreeMaxFeePerGas`, owner). (c) The deploy script takes a separate `PAYMASTER_MANAGER_ADDRESS`, warns loudly and refuses to broadcast if manager == owner without `ALLOW_SINGLE_KEY_ROLES=1`. `unlockStake` is owner-only (I-6). Residual: gas QUANTITIES (preVerificationGas, gas limits) are not capped on-chain, only the price; a compromised EXISTING signer plus an EXISTING allowlisted bundler can still burn each project's daily limit per day until the signer is removed; projects must watch `AdminChangeProposed`. | `PepuSponsoredPaymasterV7.Governance.t.sol`: `test_Signer_AddIsTimelocked`, `test_Bundler_AddIsTimelocked`, `test_Owner_CanCancelManagersProposal`, `test_Removals_AreInstant_AndClearPendingAdditions`, `test_RogueManager_CannotDrainProjectThatExitsAfterSeeingTheProposal`, `test_FeeCap_*`, `test_UnlockStake_OwnerOnly`; `test_Constructor_Guards` (adminChangeDelay > withdrawDelay); `...RealEntryPoint.t.sol`: `test_RealEP_FeeAboveCap_FailsValidation_BelowCap_Passes`, `test_RealEP_ProjectCanSetOwnFeeCap` |
| L-1 | **Fixed** | The validation context records the bucket each reservation really landed in (`projectDay`, `senderDay`); `postOp` releases the refund from that bucket if it is still current. | `...RealEntryPoint.t.sol`: `test_RealEP_DayBoundary_RefundIsReleased` (the review PoC, now passing); `Governance.t.sol`: `testFuzz_DayBuckets_CountersTrackChargesExactly` (2,000 runs) |
| L-2 | **Mitigated** (optional, default off) | Per-project `setRequiredAccountCodehash`: if set, only senders whose runtime codehash equals it are sponsored. The free tier relies on Privy sender-ownership off-chain (a codehash knob did not fit the contract size budget and is not needed there). Residual risk documented in the contract and the spec: with no pin, the allowlist is a usage policy for Kernel-shaped accounts, bounded by balance, daily limits and the fee cap. | `Governance.t.sol`: `test_Codehash_*`; `...RealEntryPoint.t.sol`: `test_RealEP_ImpostorKernelAccount_PassesAllowlistByDefault_ResidualRisk`, `test_RealEP_CodehashRestriction_BlocksImpostor_AllowsListedAccount` |
| L-3 | **Documented** | The `tx.origin` gate is kept and documented as unsupported by ERC-7562-conformant bundlers: the paymaster requires a self-run bundler with the opcode ban off (Alto safe-mode false) whose executor is allowlisted; `address(0)` is allowlisted only so estimation works (a mined tx never has `tx.origin == 0`); additions to the bundler list are now timelocked. The gate was kept because it is the only on-chain property that restricts who can be PAID, which the signer and fee cap alone do not give. The sponsor-side protections do not depend on it. | Contract header natspec, spec 4.4 and top residual risk 4, deploy script comments; timelock tests above |
| L-4 | **Fixed** | The signer bounds `preVerificationGas`, `verificationGasLimit`, `callGasLimit`, `maxFeePerGas` (a multiple of the current base fee and an absolute cap) and `maxPriorityFeePerGas` (at most the base fee and at most `maxFeePerGas`), failing closed if the base fee cannot be read, and refuses ops above the sponsor's on-chain fee cap. Paired with the on-chain fee cap (M-2b). | `reservations.test.ts`, block "L-4" |
| L-5 | **Fixed** | `MIN_POSTOP_OVERHEAD_GAS` 14,000 to 18,000; deploy default 16,000 to 20,000 (ceiling 30,000). Re-measured on the real EntryPoint v0.7: see spec 15. | `...RealEntryPoint.t.sol`: `test_RealEP_RestoredSlots_AtFloor_Solvent`, `test_RealEP_RestoredSlots_SmallCallGas_AtFloor_Solvent`, `testFuzz_RealEP_RestoreAttack_AtFloor_Solvent`, `testFuzz_RealEP_OtherSponsorUntouched` (2,000 runs) |
| I-1 | **Fixed** | Exactly 65 bytes; the dead 64-byte branch is gone; the spec no longer claims "64 or 65". | `test_Signature_MustBeExactly65Bytes`, `test_RealEP_64ByteSignature_IsRejected` |
| I-2 | Unchanged | Renounce footguns remain documented (T17). | n/a |
| I-3 | **Partly fixed** | Owner and manager are separated in the deploy script (see M-2c). The `eval` of `.env` lines and the `--private-key` flag are unchanged: use a keystore or hardware wallet. | n/a (shell script) |
| I-4 | Unchanged | Decision D1 (no free-pool ceiling). | n/a |
| I-5 | **Fixed** | The signed `validAfter` is now 5 s before the signing instant (safe because of the L-1 fix). | `reservations.test.ts`, block "I-5" |
| I-6 | **Fixed** | `unlockStake` is owner-only. | `test_UnlockStake_OwnerOnly` |
| I-7 | **Fixed** | A malformed or unrecoverable signature (including a high-s twin) is a signature failure, not a revert. | `test_Signature_Malformed65Bytes_IsSigFailureNotRevert`, `test_Signature_HighS_Twin_IsRejected` |
| I-8 | Unchanged | Documented (T15, D5). | n/a |

---

## Findings

### [M-1] Unexecuted approvals count as "outstanding" and lock a project out of its own budget

**Severity:** Medium. **Likelihood:** High. **Impact:** Medium (availability of a project's sponsorship; the attacker spends nothing and the funds stay in the ledger). **Confidence:** 90. Not exercised against a live deployment; reproduced with the repo's own engine/db code.

**Location:** `policy-service/src/sponsorship/engine.ts:272-280` (`tryProject`, outstanding and room), `:330-332` (`tryFree`), `db.ts:508-532` (`outstandingReservedWei`, `outstandingReservedForSenderWei`), `db.ts:609-614` (`voidExpiredApprovals`), `engine.ts:238-295` (no sender or identity requirement on the project path), `api.ts:103` and `config.ts:208` (rate limit 600 requests/min per key).

**Description.** Every approved request inserts a `usage_events` row holding the worst-case `maxCost`. Until `validUntil` passes (90 s, plus the reconciler's void margin), the engine subtracts the sum of those rows from the project's on-chain balance (`spendable = balance - outstanding`) and from its daily-limit room. The request does not have to be a real, executable UserOp. The project path accepts any `sender`, and the identity for a non-Privy request is the bare sender address, so every fresh `sender` value gets a fresh per-user cap (200 PEPU) and a fresh per-wallet outstanding total. The credential for the project path is the "client token", which the spec states is publishable and visible in the browser. Its only protection is the `Origin` header, which a non-browser client sets freely (spec 7a admits this). A holder of the token can therefore reserve the project's whole balance and daily limit with requests for fake senders and never submit anything. The honest users then receive `project_balance_exhausted` or `project_daily_limit_reached` (and, without a Privy token, `free_tier_identity_required`). With 600 requests per minute per key and about 6 PEPU per request (default test op), one key reserves several thousand PEPU of outstanding value, and IP rotation lifts the per-key limit.

**PoC** (`poc/audit.poc.test.ts`, run with `npx vitest run test/sponsorship/audit.poc.test.ts` in a copy of `policy-service`). It is written to assert the secure behaviour, so it fails on today's code:

```
flood approvals: 16 legit: denied project_balance_exhausted free tier detail: {"project":"project_balance_exhausted","free":"free_tier_identity_required"}
AssertionError: expected 'denied' to be 'approved'
```

A 100 PEPU project is exhausted by 16 fake-sender requests; the real user is then denied although no UserOp was ever submitted.

**Recommendation.** Do not let a client token reserve unbounded outstanding value: (a) cap the outstanding reservation per credential and per origin (for example a small fraction of balance), (b) require a verified identity or sender ownership for client-token requests, or run a cheap simulation (`eth_call` of the paymaster validation and the account's `validateUserOp`) before reserving, (c) release the reservation when the same sender/nonce is re-requested, and (d) count reservations toward the per-credential rate limit by value, not by request. Keep the on-chain limits as the final backstop.

---

### [M-2] Manager (and owner) can extract project funds indirectly; the spec's "no privileged account can reach project money" holds only for direct functions

**Severity:** Medium (trust model). **Likelihood:** Low (requires a compromised or malicious hot key). **Impact:** High. **Confidence:** 80 on the mechanism (every step is a public function in the file); the pashov judge would DEMOTE this to a lead because it is an admin action, and I keep it because the spec makes an explicit invariant claim here.

**Location:** `PepuSponsoredPaymasterV7.sol:673-688` (`addSigner`, `removeSigner`, `updateBundlerAllowlist`, both `onlyOwnerOrManager`), `:299` (bundler gate is the only thing binding the payee), `:315-367` (`_reserve`: no per-op cost cap for projects); spec sections 8 (I4, I6), 11 (T1, T3), 4.8.

**Description.** The contract pays gas to whoever the EntryPoint's `beneficiary` is, and the only on-chain gate on who that can be is `isBundlerAllowed[tx.origin]` plus the signer's signature. Both are controlled by the manager, which defaults to the same deployer EOA as the owner (`deploy-sponsored-paymaster.sh:75-76`). A holder of that key can: `addSigner(self)`, `updateBundlerAllowlist([self], true)`, then submit UserOps from fresh smart accounts (initCode is unrestricted) with `sponsorId` = any registered project whose allowlist contains a contract the account can call (a project's own contract, or the paymaster, which a project may allowlist). The op carries a very large `preVerificationGas` and priority fee, and the attacker is the `beneficiary`, so the EntryPoint pays the inflated gas cost to the attacker out of the shared deposit while the project ledger is debited. The per-sender limit does not help because senders are free to mint. The only on-chain bounds are each project's own `dailyLimit` (the project chose it) per day and its balance. A project owner can `setPaused` at once but can withdraw only after `withdrawDelay` (24 h in the default deploy), so the attacker gets at least one day's `dailyLimit`, and a project with `dailyLimit` above its balance loses all of it in one bundle. After a renounce, the manager keeps all of these powers permanently (`setManager` is owner-only).

Spec I4 ("no owner/manager function can reduce any sponsor's balance except `withdrawFreePool`") and T3 are true as statements about direct function calls. They are false as a statement about economics, and the table in 4.8 and T1 do not say that the hot manager key is equivalent to full control of every project's day limit. T1 also relies on the bundler allowlist to stop a compromised signer from being paid, but the same hot role can edit that allowlist.

**Recommendation.** (1) State this plainly in the spec and the project docs. (2) Make the manager unable to add signers or bundlers (owner-only, behind a multisig or timelock), and let the manager only remove them and pause. (3) Add a per-op maximum cost for projects (a project-set `maxOpCost`, as the free pool has) so a rogue signer cannot burn a whole daily limit in one op. (4) Use a different address for owner and manager at deploy.

---

### [L-1] Daily-counter refund is skipped when the op's `validAfter` day is older than `spentDay`

**Severity:** Low. **Likelihood:** Medium (needs an op signed in the last 90 s before UTC midnight and executed after it, while another op has already advanced the counter). **Impact:** Low (a project loses part of one day's budget; per-sender counter has the same flaw). **Confidence:** 90.

**Location:** `PepuSponsoredPaymasterV7.sol:331-345` (validation) versus `:394-404` (postOp).

**Description.** Validation keeps a forward-only day counter: if `day > s.spentDay` it resets, otherwise it adds the reservation to the current bucket. If the op's own `day` (from the signed `validAfter`) is older than `s.spentDay`, the full `maxCost` is added to the newer bucket. `postOp` then refunds only when `s.spentDay == day`, which is false for that op, so the unused part of the reservation is never released from `spentToday` (or from `senderSpend` at `ss.day == day`). The counter stays inflated by `reserved - charge` until the next day. Spec T14 and 4.4 step 8 say a stale `validAfter` "only makes a limit stricter"; that is correct but the divergence is a permanent accounting leak, not just a stricter limit.

**PoC** (`poc/AuditRealEP.t.sol`, `test_PoC_DayBoundaryRefundLeak`, real EntryPoint v0.7). It asserts that `spentToday` grows by exactly the charged amount, and fails:

```
FAIL = vulnerable: refund of unused reservation never released from spentToday: 1080000000000000 != 220054000000000
```

(op reserves 0.00108 ETH-units, is charged 0.00022, and the whole reservation is added and never released).

**Recommendation.** Store the bucket the reservation was made in (the context already carries `day`) and in `postOp` release it from whichever day counter received it: keep a `reservedDay` in the context that is `max(day, s.spentDay)` at validation, and compare against that.

```diff
-        day = uint32(validAfter / 1 days);
+        day = uint32(validAfter / 1 days);
+        if (day < s.spentDay) day = s.spentDay; // bucket the reservation really lands in
```

(apply the same clamp to the per-sender bucket and use the clamped value in the context).

---

### [L-2] Destination allowlist checks calldata shape, not account type

**Severity:** Low. **Likelihood:** Medium (project path accepts any sender and any factory). **Impact:** Low/Medium (sponsored gas is spent on destinations the sponsor did not allow, still bounded by the same budgets). **Confidence:** 80. Acknowledged in spec T11 and OQ10, but spec 7a and T2/T8 also lean on the allowlist as a boundary.

**Location:** `PepuSponsoredPaymasterV7.sol:84, 423-444`; `engine.ts:238-295` (no sender or factory check on the project path), `rpc.ts` (`allowAccountDeployment` default true, `config.ts:182`).

**Description.** `_requireTargetsAllowed` only requires selector `0xe9ae5c53` and decodes the argument the way Kernel does. It cannot know what the sender contract does with it. Any account contract that implements a function with that selector but runs arbitrary calls (or any Kernel with installed executors or fallback modules) passes the check while calling whatever it likes. The project path also does not require sender ownership, and the free path is protected only by the Privy `requireSenderOwnership` lookup. Initcode is unconstrained, so an attacker-chosen factory can deploy such an account inside the sponsored op. The damage is that sponsored gas pays for arbitrary destinations; the amount is still limited by balance, daily limit, per-sender limit and the off-chain caps.

**Recommendation.** Treat the allowlist as a usage policy, not a security boundary, in the docs. If it must be a boundary, also require that `sender` has code whose hash is a known Kernel implementation (via the factory), and add a factory allowlist.

---

### [L-3] `tx.origin` bundler gate: banned opcode and simulation/inclusion divergence

**Severity:** Low. **Likelihood:** Medium. **Impact:** Low (wasted bundler gas, public-mempool incompatibility). **Confidence:** 80 for the ERC-7562 rule; the spec already lists the ORIGIN half as top residual risk 4.

**Location:** `PepuSponsoredPaymasterV7.sol:299`; `deploy-sponsored-paymaster.sh:83-84`.

**Description.** ERC-7562 [OP-011] bans `ORIGIN` during validation, so a standards-following bundler rejects every op signed with modeByte `0x02` (the only mode the service signs). The deployment therefore depends on running the PEPU bundler with safe-mode off. Separately, `address(0)` is allowlisted so simulations (which run with `tx.origin == 0`) pass, but a real `handleOps` from any non-allowlisted bundler reverts with `BundlerNotAllowed` (`AA33`). A sponsored op is thus valid in every third-party simulation and always reverts at inclusion, which wastes that bundler's gas. The paymaster storage touched in validation (sponsor slots keyed by `sponsorId`, `totalLiabilities`, `isBundlerAllowed[tx.origin]`) is otherwise only own-contract storage and sender-keyed nested mappings, plus the `ecrecover` precompile. That is acceptable for a staked paymaster and would not be for an unstaked one, so the v2 contract must be staked before any op is sent (the deploy script stakes only when the deployer holds owner or manager; default does).

**Recommendation.** If public-mempool compatibility matters, replace the `tx.origin` gate with a signer-attested bundler binding (put the allowed bundler set in the signed hash) and drop `address(0)`. If not, keep it, document that a conforming bundler will reject these ops, and keep the stake.

---

### [L-4] The signer approves any gas limits and fee values supplied by the user

**Severity:** Low. **Likelihood:** Medium. **Impact:** Low (the user gains nothing; the operator's own bundler is paid). **Confidence:** 75.

**Location:** `engine.ts:148-155` (cost), `engine.ts:351-376` (`recordAttempt`/`approve`), `rpc.ts:119-135`.

**Description.** `maxCost` is checked only against the free pool's `maxOpCost` (40 PEPU) or a project's balance and limits. The engine never bounds `preVerificationGas`, `verificationGasLimit`, `callGasLimit`, `maxFeePerGas` or `maxPriorityFeePerGas` against what the op needs or against the chain's base fee. `preVerificationGas` is charged in full by the EntryPoint regardless of use, and the actual gas price is `min(maxFee, maxPriority + basefee)`, so a user who sets a very large PVG and priority fee makes the sponsor pay up to the cap for an op that does little. Only an allowlisted bundler can be paid, so the user cannot profit; it burns the sponsor's budget (the user's free allowance is booked at `maxCost`, so a free user can waste at most the per-user cap).

**Recommendation.** Reject ops whose `maxFeePerGas` exceeds a multiple of the current base fee, whose `preVerificationGas` exceeds the bundler's estimate by more than a margin, or whose `callGasLimit` is far above the simulated use.

---

### [L-5] `MIN_POSTOP_OVERHEAD_GAS` is below the postOp gas an attacker can force on the real EntryPoint

**Severity:** Low (margin finding; no loss reproduced). **Likelihood:** Low. **Impact:** Medium if the margin flips (shared deposit becomes under-collateralised by a few thousand gas per op). **Confidence:** 85 on the measurement, no exploit.

**Location:** `PepuSponsoredPaymasterV7.sol:87-91, 411-420`; spec 4.5 and 15 ("measured 12.7k, floor 14,000 is above it").

**Description.** The real EntryPoint v0.7 harness measures `postOp` at about **8.9k** gas for an honest op. An op whose own `execute` calls `depositToProject{value: maxCost}` restores the sponsor's `balance` slot and `totalLiabilities` to their transaction-original values, so `postOp`'s two stores become clean-to-dirty (2,900 gas) instead of dirty-to-dirty (100 gas): `postOp` then costs **12.5k to 14.5k** (14,534 in the measured case). That is above the 14,000 floor the owner may set. The ledger still ends solvent because `_charge` also adds `penaltyBasis / 10` unconditionally, which covers the shortfall: residue stayed positive in all runs, and a 2,000-run fuzz of the attack at overhead 14,000 (callGasLimit 70k to 600k, variable gas burn) found no insolvent case. Solvency therefore depends on two independent over-collections instead of one; a future gas-schedule change on the chain, or a lowered `penaltyBasis` term, would expose it.

**PoC / measurements** (`poc/AuditRealEP.t.sol`): `test_RealEP_Baseline` (residue +18.9e12 wei), `test_RealEP_PostOpGasWorstCase_RestoredSlots` (postOp 14,534 gas, residue +8.8e12 wei), `testFuzz_RestoreAttack_Floor` (passes: ledger charge >= EntryPoint debit). The first two logs are in the traces (`forge test --match-contract AuditRealEP -vvvv`).

**Recommendation.** Raise `MIN_POSTOP_OVERHEAD_GAS` to at least 18,000 and re-measure on a fork of the real chain (spec 13a is still open), or write postOp so it touches fewer slots that an op can restore.

---

### Info

**[I-1] 64-byte signature branch is dead code (spec/code mismatch).** `PepuSponsoredPaymasterV7.sol:307-311`, spec 4.2/4.4, contract header. `sigLen == 64` is accepted by the length check, but OZ 5.0.2 `ECDSA.recover(bytes32, bytes)` only handles 65 bytes (`ECDSAInvalidSignatureLength`), so a 64-byte signature reverts the op (`AA33`) instead of validating. This is also why signature malleability by re-encoding is **not** possible: only the 65-byte, low-s, v=27/28 form validates (test `test_Info_64ByteSignaturePathIsDead`). Fix: use `ECDSA.recover(digest, r, vs)` for 64 bytes, or require exactly 65 and update the spec.

**[I-2] Renounce and manager footguns.** `renounceOwnership` is one step (Ownable2Step only protects transfers). After it, the manager can never be replaced or removed, `pauseFreePool` is irreversible, staked PEPU cannot be withdrawn, and `postOpOverheadGas` is frozen. All documented in spec 4.8/T17. Consider overriding `renounceOwnership` to revert, or to require `manager == address(0)`.

**[I-3] Deploy defaults.** `deploy-sponsored-paymaster.sh:75-76` make the owner and manager the deployer EOA (one hot key holding the free pool and the signer/bundler lists, see M-2). The key is passed with `--private-key` on the command line (`:155,162`), visible in the process list, and `.env` files are loaded with `eval` of `KEY=value` lines (`:57-58`): a value containing `$(...)` runs. The constructor does not validate `_entryPoint` (the script fixes it). `address(0)` is on the bundler list (L-3). Use a keystore or hardware wallet, `set -a; source` with quoting or a parser, and a multisig owner with a distinct manager.

**[I-4] No free-pool outflow ceiling.** Decision D1. A leaked signer or manager key, or enough Privy accounts (spec R2), drains the free pool at `maxOpCost` per op with fresh senders; the per-sender limit does not bound sybils. Fund in tranches as the spec says; `pauseFreePool` is the kill switch.

**[I-5] `validAfter = now` has no skew tolerance.** `paymasterData.ts:112-122`. The signed window starts at the service's clock; if the chain's `block.timestamp` is behind it (sequencer lag), an op sent at once fails `AA32`. Use `validAfter = now - 5`; note L-1 shifts the day bucket if this crosses midnight, so apply the L-1 fix first.

**[I-6] Manager can `unlockStake()`.** `PepuSponsoredPaymasterV7.sol:695`. The paymaster stops being "staked" for ERC-7562 purposes until `addStake` is called again, so a compromised manager can halt sponsorship cheaply. Make `unlockStake` owner-only.

**[I-7] Malformed signatures revert instead of returning sig-fail.** `:311`. Only recoverable signatures give the `SIG_VALIDATION_FAILED` early return that the comment promises for gas-estimation stubs. The service's stub is a valid-format signature so it works; other clients with a zero or garbage dummy signature will see `AA33`.

**[I-8] Worst-case penalty is always charged.** `:411-420`. A sponsor pays `postOpOverheadGas + callGasLimit/10 + postOpGasLimit/10` on top of actual gas even when the real EntryPoint penalty is zero; the overcharge is credited to the free pool through `creditSurplusToFreePool`. Consistent with T15 and D5, but a project with high `callGasLimit` padding subsidises the free pool more than "a few percent".

---

## Ruled out (verified, not findings)

| Attack class | Result |
|---|---|
| Ledger insolvency (EntryPoint debit > ledger charge) | Not reproducible on the real EntryPoint v0.7: honest op residue +18.9e12 wei; slot-restoring attack at overhead 14,000 residue +8.4e12 to +8.8e12 wei; 2,000-run fuzz clean. Reason: `charge >= final cost` holds because `penaltyBasis/10` over-collects (L-5 notes the thin margin). The postOp-revert path (`PostOpReverted`) leaves the ledger charged the full `maxCost` while the EntryPoint refunds `prefund - cost` to the deposit, so it creates surplus, never a deficit; the `INNER_REVERT_LOW_PREFUND` path debits the prefund on both sides. |
| Transient surplus mis-credit | `creditSurplusToFreePool` reads `balanceOf - totalLiabilities`. Ledger debit and EntryPoint prefund happen together in validation, and the ledger refund and EntryPoint refund are adjacent with no external call between, so the difference cannot be inflated mid-bundle. `withdrawTo` updates the deposit before sending ETH. |
| Reentrancy via refunds and withdrawals | `postOp` and validation make no external calls. `executeWithdrawal` and `withdrawFreePool` apply effects before the only external call (`EntryPoint.withdrawTo`, which lowers the deposit first); every ETH-in path is `nonReentrant`; unguarded functions reachable from a callback (`creditSurplusToFreePool`, project setters) see consistent state. |
| Withdraw-delay bypass | `requestWithdrawal` replaces and restarts the timer; ownership transfer keeps the pending request but gives no new power; the free pool has no project-owner path (`onlyProjectOwner` rejects `FREE_POOL`; `proposeProjectOwner` rejects it too). `withdrawDelay` is immutable with floor 1 h. |
| Signature replay | Hash covers sender, nonce, both gas fields, preVerificationGas, gas fees, `keccak(initCode)`, `keccak(callData)` and `paymasterAndData[0:97]` (paymaster address, pm gas limits, mode, window, sponsorId), then `chainid`. Cross-chain, cross-paymaster and cross-sponsor replay all change the hash. The service's `computeUserOpHash` (viem `toPackedUserOperation`) matches the contract (cross-check tests pass; `paymasterData.ts` prefix is 97 bytes). |
| Signature malleability | OZ 5.0.2 rejects high-s and only accepts 65-byte v=27/28 (see I-1). A 64-byte re-encoding reverts. My first draft of a reconciler-voiding attack based on two encodings was **dropped** after the real-EntryPoint test showed the 64-byte form never validates. |
| Packed-field truncation | `maxCost <= uint128.max` is checked; `spentToday + maxCost <= dailyLimit (uint112)` and `ss.spent + maxCost <= senderLimit (uint112)` before the unchecked casts; `refund` casts happen only when `spent > refund`; `day = validAfter / 1 days` is at most 3.26e9 (fits `uint32`); `uint48(block.timestamp + withdrawDelay)` fits. |
| Day-window boundary | `validAfter <= block.timestamp` is enforced by the EntryPoint, so the bucket can never run ahead of real time; the only defect is the refund skip (L-1). `block.timestamp >= withdrawUnlockAt` is correct at equality. |
| Gas griefing by `callGasLimit` / `postOpGasLimit` | Both are inside the signed prefix or hash, so the user cannot change them after approval. `MIN_POSTOP_GAS_LIMIT` (40,000) is at least 2.7 times the worst measured postOp, so an out-of-gas postOp needs a bundler fault. The user can pad them before signing (L-4). |
| DoS of validation | Validation touches only the sponsor's slots, `totalLiabilities`, the sender's counter and `isBundlerAllowed`. Cross-user invalidation is limited to the shared balance and daily limit, which is normal paymaster behaviour (and the root of M-1 off-chain). |
| Project squatting | `projectId = keccak256(abi.encode(registrant, appId))`. A squatter gets a different id and cannot block, hijack or inherit another team's project. The residue is label impersonation (the `appId` string in `ProjectRegistered` and in the service's `project.appId`, which also selects the Privy resolver in `identity.ts:resolve`); dashboards must key on project id plus owner. I found no privilege gained from choosing a label. |
| Free-pool access control | `withdrawFreePool` and `setFreeTier` are `onlyOwner`; `pauseFreePool`, `setFreeTargets` are owner or manager; no function lets anyone move free-pool or project funds elsewhere. |

---

## Gas notes

Measured on the real EntryPoint v0.7 harness (london EVM, optimizer 1,000,000 runs, `forge test -vvvv`):

| Step | Gas |
|---|---|
| `handleOps` for one project-sponsored op (single call, warm account) | about 186,000 |
| `validatePaymasterUserOp` (project, sender counter written) | about 61,900 (spec quotes 85k to 99k from an isolated cold-storage run) |
| `postOp`, honest op | about 8,900 |
| `postOp`, attacker restores the `balance` and `totalLiabilities` slots | about 12,500 to 14,500 |

Possible savings (none affects security): `totalLiabilities` is a separate SSTORE in both validation and `postOp` (two per op); `postOpOverheadGas` shares a slot with the free-pool config but is read cold only in `postOp` (about 2,100 gas for project ops); `_requireTargetsAllowed` copies `exec` and the batch to memory with `abi.decode`; a `calldata` decode of the single-call target would avoid the copy.

---

## Spec vs code

| # | Spec statement | Code reality |
|---|---|---|
| 1 | 4.2/4.4: signature is 64 or 65 bytes | Only 65 works; 64 reverts inside OZ 5.0.2 (I-1). Error is `ECDSAInvalidSignatureLength`, not `PaymasterSignatureLengthInvalid`. |
| 2 | 4.5, 15: floor 14,000 is "above the measured 12.7k" | On the real EntryPoint an attacker can force about 14.5k (L-5); baseline is 8.9k. The 12.7k figure came from the mock. Solvency still holds through the penalty term. |
| 3 | I4, I6, T3: no owner or manager function can pay project money out; owner "cannot touch" project balances | True for direct calls. The manager (default = owner = deployer EOA) can add a signer and its own bundler and route project money to itself up to each project's daily limit (M-2). |
| 4 | T14, 4.4 step 8: a stale `validAfter` only makes a limit stricter, residual "None" | The counter also stops tracking real spend: refunds are skipped for stale-day ops (L-1). |
| 5 | 7a, T2, T8: calls only to the project's allowlist | Holds for Kernel-shaped callData only; any contract with selector `0xe9ae5c53` and different semantics bypasses it, and the project path checks neither sender nor factory (L-2; T11 and OQ10 acknowledge part of this). |
| 6 | T8: a leaked client token can spend at most the project's own limits | It can also reserve the whole balance and daily limit without spending, locking honest users out (M-1). Not in the threat table. |
| 7 | 4.4 step 2 and top residual risk 4: the `tx.origin` gate works with Alto safe-mode off | Confirmed; also banned by ERC-7562 [OP-011], and the `address(0)` allowlist entry makes simulation diverge from inclusion (L-3). |
| 8 | 13a, 15: no fork or real-EntryPoint test yet | Done here with the vendored v0.7 EntryPoint (not a chain fork). Still outstanding: a fork of the PEPU chain's actual EntryPoint and gas schedule, and the Alto canary (OQ8). |
| 9 | 15: 118 tests pass | Confirmed (118 passed, 0 failed). |
| 10 | 4.8: renounce clears the pending owner, constructor refuses a zero owner, manager survives renounce | Confirmed in code (`Ownable2Step._transferOwnership` deletes the pending owner; `Ownable(_owner)` reverts on zero). |
| 11 | 4.2: "Mode 0 rejected with `PaymasterModeInvalid`" | Confirmed (`:300`). Note the bundler check runs before the mode check, so a non-allowlisted origin gets `BundlerNotAllowed` first. |

---

## Delta review (2026-10-02)

A second, internal delta review of the deposit-only and attested-claim changes found 1 Medium and 4 Low issues, all now fixed. The fix-status table and the full report are in `2026-10-delta-review.md`. Note that item 11 above (bundler check before the mode check) no longer holds: the mode byte is now checked first and must be exactly `0x02`.

---

## Artifacts

* The review's original PoCs (a Foundry harness against the real EntryPoint v0.7 and a vitest flooding test) were not committed. They now live on as regression tests: `services/paymaster/contracts/test/PepuSponsoredPaymasterV7.RealEntryPoint.t.sol` (the real-EntryPoint harness: solvency, postOp gas floor, day-boundary refund, signature format, fee cap, codehash pin) and `services/paymaster/policy-service/test/sponsorship/reservations.test.ts`. See "Fix status".
* Run (WSL, upstream Foundry): `cd services/paymaster/contracts && ~/.foundry/versions/stable/forge test --match-contract RealEntryPoint`. Policy service: `cd services/paymaster/policy-service && npm test`.

> This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. The spec's own open items (external audit, fork test against the live EntryPoint, Alto canary) should be completed before deployment with real funds.
