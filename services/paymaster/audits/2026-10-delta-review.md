# Delta review (2026-10-02): PepuSponsoredPaymasterV7

Internal, AI-assisted delta review of the deposit-only and attested-claim changes (`f55527f..c354508`), with the fixes made afterwards. It follows `2026-10-internal-review.md`. This is not an external audit.

## Fix status

All findings and the cheap leads are fixed in the commit that adds this file. Contract runtime size after the fixes: **24,405 bytes** (171 bytes under EIP-170; it was 24,475). New creation-bytecode hash: `0x83f112cdd1626cdca184145bd9e9b97953d06bfc1aa640874f642744ee08bcd2` (pinned in `contracts/deploy-sponsored-paymaster.sh`, verified from a `git archive HEAD` extraction). Tests after: 171 Foundry (also at 2,000 fuzz runs) and 246 vitest.

| # | Sev | Finding | Status | Fix | Regression test |
|---|---|---|---|---|---|
| 1 (M1) | Medium | Signer-chosen mode bit 0 disables the `tx.origin` bundler gate | Fixed | `modeByte` must equal `0x02` exactly (`PaymasterModeInvalid` otherwise) and `isBundlerAllowed[tx.origin]` is always enforced. The service encoder only ever emitted `0x02`. Spec T1, T20, D12 and 4.4 step 2 restated. | `test_Delta_M1_ModeBitCannotDisableBundlerGate_AttackerNotPaid` (the PoC, now asserting the attacker is never paid with the real EntryPoint), `testFuzz_Delta_M1_OnlyModeByte02IsAccepted`; vitest `mode byte (delta review M1)` |
| 2 (L1) | Low | Per-app verify limiter lets a stranger lock out the owner | Fixed | Failure budget keyed on `(appId, SIWE address)`, peeked before the Privy call and charged only after Privy rejects the credentials; per-IP limiter unchanged. | vitest `L1: a stranger cannot lock the real owner out`, `L1: successful verifications are not charged...` |
| 3 (L2) | Low | Attestation does not bind `claimProject` targets and limits | Fixed | `claimProject(Claim)` sets only the owner; the owner configures targets and limits afterwards (nothing is spendable until then). The alternative, binding a configuration hash into `ProjectClaim`, was built and measured at 25,290 bytes (714 over EIP-170), so it was not used. `prepare` rejects the old shape. | `test_Delta_L2_ClaimSetsNoConfig_RelayerChoosesNothing`; vitest prepare claim test |
| 4 (L3) | Low | Pending re-claim survives a voluntary transfer and revives when its signer is re-added | Fixed | `acceptProjectOwnership` clears `pendingReclaim`; `removeSigner` records `signerRemovedAt` and `executeReclaim` requires the proposal (`executableAt - adminChangeDelay`) to be newer than it. | `test_Delta_L3_VoluntaryTransferClearsPendingReclaim`, `test_Delta_L3_PendingReclaim_DoesNotReviveWhenSignerReAdded` |
| 5 (L4) | Low | Credentials issued to the previous owner keep working | Fixed | The engine compares the stored owner with the cached on-chain owner on every evaluation; on a change it revokes both credentials, clears the previous owner's allowed origins and denies `project_owner_changed`. `ownerGate` does the same for the new owner's first owner-route call. | engine `credentials follow the on-chain owner` (4 tests), api `L4` (2 tests) |
| Lead | Cheap | Spoofable per-IP limits (leftmost `X-Forwarded-For`) | Fixed | With `TRUST_PROXY`, the client is the entry `TRUSTED_PROXY_HOPS` (default 1) from the right. | api `X-Forwarded-For` (2 tests) |
| Lead | Cheap | Case of app ids | Documented, no code change | Privy app ids are lower-case cuids and `keccak256(bytes(appId))` is case-sensitive; the service uses ids exactly as given and never lower-cases. Whether Privy treats ids case-insensitively is unverified; spec 10 states the rule. | n/a |
| I-6 | Info | No cap on attestation `deadline` | Fixed | `ClaimDeadlineTooFar` if `deadline > now + 1 hour`; the service clamps `SPONSORSHIP_CLAIM_ATTESTATION_TTL_SECONDS` to 3,600. | `test_Delta_ClaimDeadlineCappedAtOneHour` |
| I-8 | Info | No upper bound on `adminChangeDelay` | Fixed | Constructor reverts `DelayTooLong` above 30 days; the deploy script checks `[172800, 2592000]`. | `test_Delta_AdminChangeDelay_UpperBound` |
| I-5 | Info | Tautological invariant asserts | Fixed | Removed the "ledgers + surplus == deposit" assert and `invariant_SurplusIsUnownedRemainder`; the meaningful asserts (I1, I2, deposit conservation) remain. | n/a |
| I-2 | Info | Claim attestor and sponsorship signer share one signer set | Documented | Spec OQ16: a dedicated claim key needs a separate role (mapping, a timelocked third admin-change kind, removal function, events), estimated at 400 to 600 bytes, more than the 171 left, so not implemented. | n/a |
| I-1, I-3, I-4, I-7 | Info | Stranded `keccak256("")` deposits, self re-claim, derived `entryPointDeposit`, signer on-chain status unchecked | Documented only | Unchanged; see the report below and spec 9.4, 11. | n/a |
| Lead | | Privy cross-app check, first claim immediate for funded unclaimed projects | Open | Needs a live two-app test before launch (Lead 1) and the timelock/claim-key decision in OQ16. | n/a |

Also recorded in the spec: a holder of the Privy secret can replace a pending re-claim with their own, so rotate the Privy secret after any recovery (9.2).

---

## Original report

Method: pashov `solidity-auditor` methodology, executed sequentially by one reviewer (no sub-agents), plus the relevant hacking-agent attack-surface prompts. AI-assisted review; it cannot prove the absence of vulnerabilities. This is an internal delta review, not an external audit.

---

## Scope

| | |
|---|---|
| **Repo / commit** | the `pepu` repository, branch `main`. Reviewed code = `c354508` (`git diff f55527f..c354508 -- services/paymaster`). HEAD moved to `2759b37` during the review; between `c354508` and `2759b37` the only change under `services/paymaster` is 8 lines of `policy-service/config/apps.json` (not security relevant). Nothing in the repo was edited. |
| **Contract** | `services/paymaster/contracts/src/PepuSponsoredPaymasterV7.sol` (991 lines, every line read, every new or changed function read in the context of the whole contract) |
| **EntryPoint** | vendored v0.7 `EntryPoint.sol` and `StakeManager.sol` (re-read: prefund deduction at validation, `_postExecution`, postOpReverted path, stake slot separation) |
| **Service** | `policy-service/src/sponsorship/{projectVerify,api,prepare,paymasterData,chain,config,engine,runtime}.ts`, `abi.ts` (shape only) |
| **Docs / deploy** | `SPONSORSHIP-SPEC.md` (sections 4.6, 4.8, 8 (I10), 9, 11 (T1, T13, T21), 14, OQ15 to OQ17), `audits/2026-10-internal-review.md`, `deploy-sponsored-paymaster.sh` diff |
| **Confidence threshold** | 75 (pashov `judging.md`). Findings at or above it carry a Fix block. Every Medium and Low below has a PoC that passes (contract) or fails on today's code by design (service). |

### Skill files used

Cloned from `https://github.com/pashov/skills`:

- `solidity-auditor/SKILL.md` (mode selection, exclude pattern, deploy scripts stay in scope)
- `solidity-auditor/references/report-formatting.md` (output shape: Scope, Findings with `[confidence] **n. Title**`, location line, Description, diff Fix, Findings List with the below-threshold separator, Leads, disclaimer) and `report-language.md` (wording)
- `solidity-auditor/references/judging.md` (four gates, confidence scoring) and `hacking-agents/shared-rules.md` (FINDING needs a `proof:`; otherwise it is a LEAD; do-not-report list)
- Attack-surface prompts used as lenses, one pass each: `access-control-agent.md`, `trust-gap-agent.md`, `economic-security-agent.md`, `execution-trace-agent.md`, `invariant-agent.md`, `periphery-agent.md`, `asymmetry-agent.md`, `boundary-agent.md`, `flow-gap-agent.md`, `first-principles-agent.md`.

Not used: `fizz`, `x-ray`, `static`, and the loop, memory and `assemble.sh` machinery (it merges parallel agent output; this was one sequential pass). The report is hand-assembled in the pashov shape.

### Baselines and PoCs

- `forge test` in a copy of `services/paymaster/contracts` (WSL, upstream Foundry 1.5.1, solc 0.8.26, london): **165 passed, 0 failed** (including `PepuSponsoredHashCrossCheck.t.sol` shared EIP-712 vector and the 256-run invariant campaigns).
- `vitest run` in a copy of `policy-service` (node_modules junctioned): **16 files, 235 tests passed**.
- My PoCs (scratch only): the scratch PoC `AuditDelta.t.sol` (4 tests, all pass; they assert the vulnerable behaviour, or for the refuted lead the safe behaviour) and the scratch PoC `audit2.poc.test.ts` (2 tests, both FAIL on today's code because they assert the secure behaviour).

Reproduce: the PoCs were scratch files in a copy of the repository and are now committed as regression tests (see the fix-status table).

---

## Findings

[90] **1. A signer-chosen mode bit switches off the `tx.origin` bundler gate, so a compromised signer pays itself from unclaimed deposits, the free pool and any project (within limits)**

`PepuSponsoredPaymasterV7._parseAndVerify` · Confidence: 90

**Description**
The gate `if ((modeByte & 0x01) == 0 && !isBundlerAllowed[tx.origin])` is skipped when the signer sets bit 0 of the signed `modeByte` to 1, so a signer key can sign mode `0x03`, submit `handleOps` from any EOA with itself as beneficiary, and collect the gas payment; the bundler allowlist and its 48h timelock then bind nothing, and spec T1 ("only if tx.origin is an allowlisted bundler"), T20 and D12 ("the only on-chain restriction on who can be paid") are wrong.

Impact in this design. (a) **Unclaimed projects**: a compromised signer attests for itself and claims any funded-but-unclaimed project immediately (T21), sets its own allowlist and limits, then self-bundles; there is no owner to pause. (b) **The free pool** (no ceiling, D1): drainable at the per-op cap with invented senders, collected by the attacker instead of being burnt to the operator's bundler. (c) **Claimed projects**: bounded by the project's `dailyLimit` per day, but now as profit to the attacker. Without the bypass a rogue signer could only burn funds into the operator's own bundler, which removes the incentive. The earlier M-2 residual ("existing signer plus existing allowlisted bundler") is therefore weaker than it reads: an existing signer alone suffices. The same applies to a manager who waits out the 48h signer timelock: the separate bundler timelock adds nothing.

PoC: `AuditDelta.test_PoC_SignerModeBit_BypassesBundlerGate_AndPaysAttacker` (real EntryPoint v0.7). Depositor funds unclaimed `ghost-app` with 500 ether, signer attests for `attacker`, attacker claims, then with mode `0x02` the op reverts for the non-allowlisted attacker as `tx.origin`, and with mode `0x03` it passes: attacker received 4,806,120,000,000,000 wei as beneficiary while the depositor's ledger fell by 4,958,060,000,000,000 wei.

**Fix**

```diff
-        if ((modeByte & 0x01) == 0 && !isBundlerAllowed[tx.origin]) revert BundlerNotAllowed(tx.origin);
-        if ((modeByte >> 1) != SPONSORED_MODE) revert PaymasterModeInvalid();
+        // The service only ever signs 0x02 (allowAllBundlers = 0). Make that the only accepted byte so no signer
+        // key can opt out of the payee gate.
+        if (modeByte != uint8(SPONSORED_MODE << 1)) revert PaymasterModeInvalid();
+        if (!isBundlerAllowed[tx.origin]) revert BundlerNotAllowed(tx.origin);
```

This changes the bytecode, so re-pin `EXPECTED_CREATION_CODE_HASH` and check the 101-byte size margin. If you keep the bit, restate T1, T20 and D12 (the gate is advisory against a compromised signer) and add the unclaimed-project and free-pool exposure to T1.

---

[85] **2. Any signed-in user can lock the real owner out of `POST /v2/projects/verify` for any app id**

`createSponsorshipV2` (`/v2/projects/verify`, `limiters.verifyApp`) · Confidence: 85

**Description**
The per-app limiter (default 5 per minute) is keyed on the caller-supplied `appId` and charged before the Privy call, so any wallet that passes SIWE can send five junk-secret requests per minute for the victim's app id and the legitimate developer then gets 429 on every attempt, which blocks first claims and re-claims (including wallet recovery) for as long as the attacker keeps it up.

PoC: `audit2.poc.test.ts` "S1", default limits (5 per app, 10 per IP): the stranger's five junk calls return 403 (invalid secret) and the owner's correct call returns **429** (expected 200; the test fails on today's code). The per-IP limiter (10 per minute) does not stop it because 5 per minute is enough; with `trustProxy` on, the leftmost `X-Forwarded-For` entry is client-controlled, so the per-IP limit is bypassable too (see Lead 2).

**Fix**

```diff
-      throttle(limiters.verifyApp, `verify-app:${appId}`);
       let verdict: "valid" | "invalid";
       try {
         verdict = await deps.privySecretVerifier.verify(appId, appSecret);
       } catch {
         throw new HttpError(502, "privy_unavailable", "...");
       }
-      if (verdict !== "valid") throw new HttpError(403, "invalid_privy_credentials", "...");
+      if (verdict !== "valid") {
+        // charge the per-app budget only for FAILED verifications and key it per (app, SIWE address) so one
+        // stranger cannot spend the owner's budget; keep the global per-IP and per-session limits
+        throttle(limiters.verifyApp, `verify-app:${appId}:${s.address}`);
+        throw new HttpError(403, "invalid_privy_credentials", "...");
+      }
```

(Run a failure-only check before the Privy call, e.g. `limiters.verifyApp.peek(key)`, so guessing stays bounded, and keep the budget per `(appId, session address)`.)

---

[80] **3. The attestation does not cover the initial allowlist and limits, so whoever submits it chooses them**

`PepuSponsoredPaymasterV7.claimProject` · Confidence: 80

**Description**
`claimProject` is relayable by anyone and the EIP-712 `ProjectClaim` binds only `(appId, newOwner, nonce, deadline)`, so a relayer or any observer of the attestation can submit it first with their own `targets`, `dailyLimit` and `senderDailyLimit`, which makes the real owner the owner of a project preloaded with an attacker-chosen allowlist and limits and burns the owner's single-use attestation (their own `claimProject` then reverts `ProjectAlreadyClaimed`).

The owner can undo this with `setTargets(..., false)`, but only for addresses they know about (read `TargetSet` events), and the service reads the on-chain allowlist when it signs, so an unnoticed attacker target stays sponsorable by every holder of the project's client token until removed. Practical exposure is low on a Nitro chain with no public mempool; it grows if claims are ever relayed by third parties or the chain gains a public mempool (the spec invites anyone to relay).

PoC: `AuditDelta.test_PoC_ClaimRelayer_ChoosesSettings`: `attacker` submits `realOwner`'s attestation with `evilTarget` and `type(uint112).max` limits; `getProject` shows `realOwner` as owner with the attacker's limit, `isTargetAllowed(id, evilTarget)` is true, and `realOwner`'s own `claimProject` reverts.

**Fix**

```diff
     function claimProject(Claim calldata c, address[] calldata targets, uint112 dailyLimit, uint112 senderDailyLimit)
         external
         returns (bytes32 projectId)
     {
+        // only the attested owner chooses the initial settings (relaying stays possible via reclaim/own tx)
+        if (msg.sender != c.newOwner) revert NotProjectOwner();
```

(Alternative that keeps relaying: add `keccak256(abi.encodePacked(targets)), dailyLimit, senderDailyLimit` to the `ProjectClaim` typed data and to the service's `signClaimAttestation`; this changes the shared vector.) Contract size is tight (101 bytes); the `msg.sender` check is the cheaper variant.

---

[80] **4. A pending re-claim is not cleared by a voluntary transfer and revives when its signer is added back**

`PepuSponsoredPaymasterV7.executeReclaim` / `acceptProjectOwnership` / `removeSigner` · Confidence: 80

**Description**
`pendingReclaim` survives `removeSigner` (it only fails `executeReclaim` while the signer is absent) and survives `acceptProjectOwnership`, so a re-claim that was proposed and thought dead (signer removed after a suspected compromise, or owner handed the project to a multisig) executes later in favour of its proposed owner as soon as that signer is re-added through the normal timelock, or 48h after the proposal if the signer is still in place and the new owner is not watching.

PoC: `AuditDelta.test_PoC_PendingReclaim_RevivesAfterSignerReAdd_AndSurvivesTransfer`: carol's re-claim is proposed, alice transfers to bob (`pendingReclaim(idA).newOwner` is still carol), `removeSigner` makes `executeReclaim` revert, after `proposeAdminChange` plus `executeAdminChange` the same signer is a signer again and `executeReclaim` succeeds: carol owns the project.

**Fix**

```diff
     function acceptProjectOwnership(bytes32 projectId) external {
         if (pendingProjectOwner[projectId] != msg.sender) revert NotPendingProjectOwner();
         address old = sponsors[projectId].owner;
         delete pendingProjectOwner[projectId];
+        delete pendingReclaim[projectId];
         sponsors[projectId].owner = msg.sender;
```

and bind the re-claim to a signer epoch, for example store `uint48 proposedAt` in `PendingReclaim` and require `proposedAt > signerRemovedAt[signer]` (or record `signers` removal time in `removeSigner`) so a removed-then-re-added signer does not resurrect old proposals. Cheaper: have `executeReclaim` also require `p.executableAt + adminChangeDelay > block.timestamp` (a proposal expires one delay after it becomes executable).

---

[80] **5. Project credentials issued to the previous owner keep working after the on-chain owner changes**

`SponsorshipEngine.tryProject` / `api.ownerGate` · Confidence: 80

**Description**
The engine authorises a project's server key and client token from the database row and never compares the row's owner snapshot with the current on-chain owner (`ownerGate` refreshes the snapshot only when the new owner calls an owner route), so after an executed re-claim or a voluntary transfer the previous owner (the wallet the team lost, a departed contractor, an attacker who held the old key) still holds a working server key and `allowedOrigins`/per-user cap settings until the new owner notices and rotates both credentials.

Bounded by the new owner's on-chain limits, allowlist and pause, and nothing can be withdrawn, so this is a burn-the-budget risk, not a theft path. It matters most for the exact case re-claims exist for (a compromised or lost owner wallet).

PoC: `audit2.poc.test.ts` "S2": after `chain.setProject(..., owner: stranger)` the old server key still gets **200** with `sponsor.kind = project` from `POST /v2/sponsor` (the test asserts "not 200" and fails on today's code).

**Fix**

```diff
+    // in tryProject, after the on-chain read
+    if (project.owner && project.owner.toLowerCase() !== sponsor.owner.toLowerCase()) {
+      return { ok: false, reason: "project_owner_changed", message: "ownership changed on-chain; the new owner must rotate the credentials" };
+    }
```

and make `ownerGate`/`POST /v2/projects/:id/*/rotate` clear the stale flag after rotating both credentials; also rotate both automatically when the reconciler sees `ProjectOwnershipTransferred` for an indexed project.

---

Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [90] | A signer-chosen mode bit switches off the `tx.origin` bundler gate, so a compromised signer pays itself from unclaimed deposits, the free pool and any project (within limits) |
| 2 | [85] | Any signed-in user can lock the real owner out of `POST /v2/projects/verify` for any app id |
| 3 | [80] | The attestation does not cover the initial allowlist and limits, so whoever submits it chooses them |
| 4 | [80] | A pending re-claim is not cleared by a voluntary transfer and revives when its signer is added back |
| 5 | [80] | Project credentials issued to the previous owner keep working after the on-chain owner changes |

---

## Severity matrix

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | 1 |
| Low | 4 | 2, 3, 4, 5 |
| Info / Leads | 8 | I-1 to I-8 below |

| # | Severity | Likelihood | Impact | PoC |
|---|---|---|---|---|
| 1 | Medium (trust model; contradicts spec T1/T20/D12) | Low (needs signer key) | High (unclaimed deposits, free pool: payee becomes the attacker) | Foundry, real EntryPoint, passes |
| 2 | Low | High | Low/Medium (availability of claims and recovery) | vitest, fails as designed |
| 3 | Low | Low (no public mempool; relayer trust) | Low/Medium | Foundry, passes |
| 4 | Low | Low | Medium (ownership of a funded project) | Foundry, passes |
| 5 | Low | Medium | Low/Medium (budget burn within new owner's limits) | vitest, fails as designed |

Why nothing higher: the contract has no path that moves ledger funds out except gas settlement (proved below), and every ownership path ends in "can only burn funds as gas for ops the signer signs". The Medium exists because the payee of that gas is supposed to be the operator's bundler, and finding 1 shows it is not enforced against the signer.

---

## Answers to the focus questions

### 1. Diff review (`f55527f..c354508`)

Read: constants and typehashes, the `Sponsor`, `PendingReclaim`, `Claim` structs, constructor (floor 48h, free pool owned by `address(this)`), `claimProject`, `reclaimProject`, `executeReclaim`, `cancelReclaim`, `_verifyClaim`, `depositFor`, `setPaused`, `proposeProjectOwner`/`acceptProjectOwnership`, `creditSurplusToFreePool`, `surplus`, the stake functions, `getProject` (7 values), `claimDigest`/`domainSeparator`, `projectIdOf`, `_signerOf`. `validatePaymasterUserOp`, `_reserve`, `postOp`, `_charge`, `_requireTargetsAllowed` are unchanged except the owner check and the removed withdraw fields. Findings 1, 3 and 4 come out of this pass.

### 2. Claim and re-claim

| Question | Result |
|---|---|
| Replay cross-chain | Refuted. `domainSeparator()` uses `block.chainid` and `address(this)` at call time; `claimDigest` is wrapped by `toTypedDataHash`. |
| Replay cross-contract | Refuted (verifyingContract in the domain). Different deployment, different digest. |
| Replay cross-app | Refuted (`keccak256(bytes(appId))` is in the struct hash). |
| Replay after signer removal | Refuted for new claims (`_signerOf` checks `signers[recovered]` at use time). **Not** refuted for a re-claim that was already proposed: it dies while the signer is absent but revives if the signer is re-added (finding 4). |
| Nonce | Single-use by digest (`claimUsed[digest]`), random 256-bit from the service, no sequence needed. High-s is rejected, so signature malleability cannot create a second digest. |
| Deadline | `block.timestamp > deadline` reverts, so `deadline == now` is accepted (inclusive; fine). No on-chain cap on how far out a signer may set it (I-6). |
| EIP-712 vs service | Matches: domain `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)` with `PepuSponsoredPaymaster` and `1`; type `ProjectClaim(string appId,address newOwner,uint256 nonce,uint256 deadline)`; viem encodes `string` as `keccak256(utf8)`. The shared vector is **verified in both directions** (`test_ClaimAttestation_FromPolicyService_IsAccepted` and the vitest vector, both green). |
| Front-running a claim | The attestation fixes the owner, so ownership cannot be stolen, but settings and the attestation can (finding 3). On Nitro there is no public mempool, which lowers likelihood. |
| Griefing with repeated re-claims | Needs a fresh attestation each time, hence the Privy secret (or the signer key), and the service allows 5 per minute per app; the owner's `cancelReclaim` is one cheap tx. A newer attested re-claim replaces a pending one, including a legitimate one: a secret holder can override the real team's pending recovery, and a lost-wallet owner cannot cancel. This is inherent to "ownership follows the Privy secret", not a bug, but state it in 9.2: rotate the Privy secret after any recovery. |
| Interaction re-claim x transfer x pause x settings | `executeReclaim` clears `pendingProjectOwner` (good) but `acceptProjectOwnership` does not clear `pendingReclaim` (finding 4). `executeReclaim` does not touch `paused` or settings, so a new owner inherits a paused project and can unpause. Pausing does not block `reclaimProject`/`executeReclaim` (by design). |
| Unclaimed project's funds spendable by anyone | Refuted. `_reserve` reverts `UnknownSponsor` while `owner == 0`; `onlyProjectOwner` can never match `address(0)`. They become spendable at the claim, under the claimer's settings. Compromised signer exception: T21 and finding 1. |
| Empty appId | `_verifyClaim` reverts `InvalidAppId` (length 0 or above 128). But `depositFor(keccak256(""))` is accepted and strands the money forever (I-1). |
| `keccak256(appId)` vs sponsor id 0 | A preimage of `bytes32(0)` is infeasible, so no appId can map to the free pool. The free pool cannot be claimed, transferred or re-claimed: `proposeProjectOwner(0)` and `cancelReclaim(0)` fail `onlyProjectOwner` (`projectId == FREE_POOL`), `acceptProjectOwnership(0)` fails because `pendingProjectOwner[0]` is never set, `executeReclaim(0)` has no pending entry, and `depositFor(0)` reverts. |

### 3. Funds

Claim: **no path moves ledger funds out except gas settlement.** Enumeration of every value-moving statement in the contract: `entryPoint.depositTo{value}` in `_credit` (in), `entryPoint.addStake{value: msg.value}` (caller's own value), `entryPoint.unlockStake()`, `entryPoint.withdrawStake(to)`. There is no `withdrawTo`, no `.call{value}`, no `selfdestruct`, no `delegatecall`, no `receive`/`fallback`. EntryPoint `StakeManager.addStake` preserves `deposit` and writes only `stake`; `withdrawStake` pays only `info.stake`; so the stake functions cannot touch the deposit slot. The ledger is decreased only by `_reserve` (validation), refunded by `postOp`, and the EntryPoint pays the bundler out of the deposit. Invariant I10 (`deposit + beneficiary.balance == everything ever deposited`) is meaningful (the two `surplus` identities are tautological, see I-5) and passes 256 runs at depth 80.

- **`creditSurplusToFreePool`**: only converts `deposit - totalLiabilities` above the 1 ether reserve into the free-pool ledger; `totalLiabilities` rises by the same amount, deposit unchanged, so it cannot create insolvency. **Attempted exploit, refuted**: calling it in the execution phase of an op to count that op's in-flight reservation as surplus. The EntryPoint v0.7 subtracts `requiredPreFund` from the paymaster's deposit at validation (`EntryPoint.sol:535`) while `_reserve` subtracts the same `maxCost` from the ledger, so surplus is unchanged mid-flight. PoC `AuditDelta.test_Refuted_InFlightReservationIsNotSurplus`: 3 ether surplus, ~3 ether reservation in flight, credited exactly 2 ether, `balanceOf >= totalLiabilities` afterwards.
- **After `getDeposit` removal**: `surplus()` reads `entryPoint.balanceOf(this)` directly; same quantity as before. Side effect on the service: `ContractParams.entryPointDeposit` is now `totalLiabilities + surplus`, which equals `max(deposit, totalLiabilities)` and so can never show an insolvency (I-4). It is not used anywhere yet.
- **Solvency under the 10% unused-gas penalty and the postOp floor**: `_charge` and `MIN_POSTOP_OVERHEAD_GAS` are untouched; the real-EntryPoint solvency tests (baseline, restored slots at the floor, 256-run fuzzes) pass, including inside my harness run.
- **postOp revert path** (EntryPoint never re-invokes postOp, residue goes to the deposit, hence to surplus and the free pool) is unchanged and documented (OQ12).

### 4. Governance

- **Rogue owner/manager/signer after renounce**: unchanged from spec 4.8; the manager keeps `removeSigner` (instant, also kills pending re-claims and every attestation of that signer), `pauseFreePool`, `setFreeTargets` and the timelocked additions. Added by this delta: a rogue manager can veto a legitimate recovery by removing the signer (griefing, no theft). The residual theft path is finding 1.
- **Timelock floor**: `MIN_ADMIN_CHANGE_DELAY = 48 hours` is enforced in the constructor (`DelayTooShort`), the delay is `immutable`, `uint48(block.timestamp) + adminChangeDelay` cannot overflow. There is no upper bound (a deploy-time mistake could freeze rotation); add a cap in the deploy script.
- **Does pausing stop all spend paths?** Yes for new spend: `_reserve` is the only debit and it checks `paused` before touching balances, for both validate and bundled ops. `sigOk == false` returns without any state change. Ops validated before the pause settle normally (their `maxCost` already left the ledger), which is intended. Pause does not stop reclaim, transfer, settings or deposits. Pause is not available to unclaimed projects or to the free pool's depositors (only owner/manager `pauseFreePool`), which is why finding 1 matters.

### 5. Service (`POST /v2/projects/verify`)

- **Secret handling**: used for one outbound request, not stored, not logged, not echoed. Errors on this route are fixed strings, the verifier discards the upstream error, body parse errors are fixed strings, the global handlers log only `error.message` of non-HTTP errors (none can contain the body). Test coverage asserts absence from responses, console and the DB.
- **SIWE binding**: `ownerAddress` must equal the session address (403 otherwise), checked before the Privy call; the attestation names only that address.
- **Rate limits**: per IP and per app exist, but the per-app one is attacker-controlled (finding 2). Per-IP uses the leftmost `X-Forwarded-For` when `trustProxy` is on (Lead 2).
- **Privy error misread as valid**: only HTTP 200 is "valid"; 401/403 is "invalid"; every other status and any network error throws and maps to 502, so a Privy outage, 429 or 5xx cannot become a verdict. A 403 caused by something other than bad credentials (for example an edge block) reads as "invalid" (fail-closed).
- **Attestations for apps the caller does not control**: requires a valid `appId:appSecret` pair accepted by Privy; the service sends the same `appId` as the Basic username and as `privy-app-id`. Whether Privy actually cross-checks them is an assumption (Lead 1).
- **TOCTOU with on-chain state**: the `claimProject` versus `reclaimProject` choice and the `already_owner` 409 are advisory and read fresh state; the contract is authoritative and a wrong-function submission reverts without consuming the attestation. Two simultaneous attestations (two secret holders) are both valid and both single-use; the first claim wins, the second is usable as a re-claim.
- **Signer's on-chain authorisation not checked**: after a signer rotation the service keeps issuing attestations that revert `InvalidClaimSignature` (opaque to the developer and each costs a Privy call). Not a security issue, but read `signers(address)` once at start and per request (cached) and return 503 when false (I-7).

### 6. Regressions of the previous findings

| Prior | Status at `c354508` |
|---|---|
| M-1 (outstanding approvals lock) | Service reservation code unchanged apart from renames; its tests (`reservations.test.ts`) pass. No regression. |
| M-2 (manager route to project money) | Signer and bundler additions still timelocked (now an immutable delay of at least 48h, test `Governance.t.sol` green). **Weakened in effect by finding 1**: the bundler timelock is moot while the signer can set mode bit 0. |
| L-1 (day-bucket refund) | Intact (`projectDay`/`senderDay` in context; `test_RealEP_DayBoundary_RefundIsReleased` passes). |
| L-2 (codehash pin) | Intact (`setRequiredAccountCodehash`). `claimProject` cannot set it atomically; harmless because the service signs only after indexing. |
| L-3 (bundler gate documented) | Documentation now wrong for the signer-controlled bit (finding 1). |
| L-4 (service bounds gas and fees) | Untouched; the on-chain fee cap is intact. |
| L-5 (postOp floor 18,000) | Intact; fuzzes at the floor pass on the real EntryPoint. |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. Not scored._

- **Privy cross-app check is an unverified assumption** — `projectVerify.createPrivyRestSecretVerifier` — Code smells: the only evidence is unit tests with a fake `fetch`; no live positive or negative test. — If Privy authenticates `GET /v1/users` by secret alone and ignores the `privy-app-id` header, then any holder of ANY Privy app's secret could obtain an attestation for ANY app id. Before launch run against two real apps: the right pair must give 200, and (app A id, app B secret) must give 401 or 403. Also confirm that `api.privy.io/v1/users` (rather than `auth.privy.io/api/v1/users`) is the live host for server credentials; a wrong host fails closed (502) but breaks the feature. A stronger design reads the app id back from a Privy response and compares it.
- **Spoofable per-IP limits** — `api.ip` — Code smells: with `trustProxy` the code takes `x-forwarded-for.split(",")[0]`, the leftmost, client-supplied, entry; proxies append on the right. — Bypasses every per-IP limiter (auth nonce, verify, admin, public) when the service sits behind a proxy that appends rather than overwrites; use the rightmost entry or a fixed hop count.
- **Case and canonical form of app ids** — `projectIdOf` — Code smells: `keccak256(bytes(appId))` is case-sensitive and the service regex accepts `[A-Za-z0-9_-]`. — If Privy resolves app ids case-insensitively, two project ids exist for one app and depositors can fund the wrong one; normalise (lower-case) in the service and in SDKs, or confirm Privy's behaviour.
- **First claim immediate for funded, unclaimed projects** — `claimProject` — Known as T21/OQ16; with finding 1 fixed the residual is still that a compromised signer takes every unclaimed project's settings at once. Separate the attestation key (`claimSigners` mapping checked in `_verifyClaim`) and consider the timelock on first claims when the project already holds more than a threshold.

---

## Informational

- **I-1 Stranded deposits**: `depositFor` accepts any non-zero `bytes32` except 0, including `keccak256("")` and ids no valid `appId` produces, and the funds are unrecoverable. Documented (T22, 9.4); the UI should compute the id from an appId it validated.
- **I-2 No role separation** between sponsorship signer and claim attestor: any `signers` entry can do both, so OQ16's "second entry in `signers`" does not narrow its power.
- **I-3 Re-claim by the current owner's own address** (`newOwner == current`) is accepted and just overwrites any pending re-claim; harmless, and in fact the cheapest way for an owner to replace a hostile pending re-claim with an attested self-claim.
- **I-4 `entryPointDeposit` in `ContractParams`** is derived (see section 3) and masks insolvency; read `entryPoint.balanceOf(paymaster)` directly and alert when it is below `totalLiabilities`.
- **I-5 Invariant coverage**: `invariant_SurplusIsUnownedRemainder` and the "ledgers + surplus == deposit" assert are tautological given `surplus()`; the meaningful assert is `deposit + beneficiary.balance == ghostIn`. The handler never lets an op's own execution call the paymaster, which is the case I attacked by hand (refuted).
- **I-6 No on-chain cap on `deadline`**: a signer can mint attestations valid for years; only matters with a leaked signer key.
- **I-7 Service does not verify its signer's on-chain status** (see section 5).
- **I-8 Deploy script**: `ADMIN_CHANGE_DELAY_SECONDS` has no upper-bound check; the constructor accepts up to 2^32-1.

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)
