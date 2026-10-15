# PepuSponsoredPaymasterV7 Contract

Reference for the paymaster contracts: v2 `PepuSponsoredPaymasterV7` (deployed as a canary) and v1 `PepuVerifyingPaymasterV7` (retired): functions, events, errors, roles and timelocks. Names come from the SDK's `pepuSponsoredPaymasterV2Abi` and the spec; the contract source is `services/paymaster/contracts/src`.

> Status: **v2 proven on mainnet (canary, external audit pending)** at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (about block 10537341, verified with `eth_getCode` on 2026-10-14 through `pnpm --filter @pepu-chain/sdk live-check`): internally reviewed 3x, funded in small tranches. 195 Foundry tests (including a harness on the real EntryPoint v0.7 sources and fuzz and invariant suites), three internal reviews, no external audit. Owner `0x5966…4A1`, manager `0x063A…aBb0`; the free pool was seeded with 300 PEPU. **v1 is retired** at `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0`: its EntryPoint deposit was withdrawn (0), so it cannot sponsor anything. Never deposit to it.

## v1: PepuVerifyingPaymasterV7

A fork of Pimlico's singleton verifying paymaster with ERC-20 mode removed. Its job is narrow: check that `paymasterAndData` carries a valid ECDSA signature from an authorised signer over an approved time window, then pay gas from its EntryPoint deposit.

| Item | Detail |
|---|---|
| Address | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` (retired) |
| Stake and deposit | History: it was staked (100 PEPU) and funded, and the EntryPoint deposit has since been withdrawn (0). Retired |
| Signed prefix | `paymaster(20) ‖ verificationGasLimit(16) ‖ postOpGasLimit(16) ‖ mode(1)=0x00 ‖ validUntil(6) ‖ validAfter(6)`, then the 65-byte signature |
| Hash | keccak of sender, nonce, account gas limits, preVerificationGas, gas fees, hashes of initCode, callData and the prefix, then with `chainid`, EIP-191 signed. A frozen cross-language test vector pins both sides |
| Signers | Multi-signer (`MultiSigner`): a manager can add or remove signers without a redeploy |
| Caps | **None on chain.** Every economic safeguard is in the policy service |
| Bundler gate | Not enforced |

The main risk is signer-key compromise: any signature from an authorised signer is honoured up to the deposit. The mitigation is keeping the float small and rotating signers. See [Policy, Caps and the Circuit Breaker](policy-and-caps.md).

## v2: PepuSponsoredPaymasterV7

One contract that is both paymaster and vault. All PEPU sits in its EntryPoint deposit; an internal ledger records which sponsor owns what, with `totalLiabilities` equal to the sum of ledgers and `totalLiabilities` at most the EntryPoint balance. Deployed at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` as a canary (external audit pending).

### How it validates

`paymasterData` is `mode(1)=0x02 ‖ validUntil(6) ‖ validAfter(6) ‖ sponsorId(32) ‖ signature(65)` (97 bytes signed, `sponsorId` inside the hash). `sponsorId` is `0x00..00` for the free pool or `keccak256(bytes(appId))` for a project. Validation, in order:

1. Caller is the EntryPoint. The mode byte must be exactly `0x02`, and the **bundler gate is unconditional**: `tx.origin` must be an allowlisted bundler (`address(0)` is allowlisted so estimation works).
2. Signature exactly 65 bytes, low-s, from an authorised signer, otherwise `SIG_VALIDATION_FAILED` with no state change (so stubs never revert or charge).
3. `validUntil` non-zero; paymaster post-op gas limit at least 40,000; the op's `maxFeePerGas` at most the sponsor's cap.
4. The sponsor must be claimed and not paused; for the free pool, enabled and under `freeMaxOpCost`. A **project must also have a non-zero per-wallet daily limit** (`ZeroDailyLimit` otherwise); only the free pool may run with 0 = off.
5. Every Kernel `execute` target (single `0x00` or batch `0x01`) must be on the sponsor's allowlist. Empty means nothing.
6. Daily limit (projects) and per-wallet daily limit, keyed on the signed `validAfter` day.
7. The sponsor's balance covers `maxCost`. The full `maxCost` is deducted; `postOp` refunds `maxCost - charge` to the **same** sponsor. `charge` includes a post-op overhead (20,000 gas at deploy, floor 18,000) plus the worst case of the EntryPoint's 10% unused-gas penalty, so the ledger can never be short. Both are **snapshotted into the context at validation**, so `postOp` makes no cold storage read of the overhead and an owner changing it mid-flight cannot change an in-flight op's charge (worst-case postOp 13,918 gas against the 18,000 floor).

Because the gate uses `ORIGIN`, which ERC-7562 bans, v2 is supported only behind a self-run bundler with safe mode off whose executor is allowlisted. See [Bundler Overview](../bundler/overview.md).

### Functions

| Group | Functions | Who |
|---|---|---|
| ERC-4337 | `validatePaymasterUserOp`, `postOp`, `getHash` | EntryPoint (hash view for anyone) |
| Deposits (one-way) | `depositFor(projectId)`, `fundFreePool()`, `creditSurplusToFreePool()` | **Anyone** |
| Claims | `claimProject(Claim)`, `reclaimProject(Claim)`, `executeReclaim`, `cancelReclaim`, views `claimDigest`, `domainSeparator`, `claimUsed`, `signerRemovedAt`, `pendingReclaim`, `vetoedReclaimant`, `PENDING_EXPIRY` | Claim: anyone with a signer attestation. Execute: anyone after the delay and within 30 days. Cancel: the current project owner, **once per new owner**; for a pending **first claim** of a funded, unowned project, the contract owner or manager |
| Project settings | `setTargets`, `setDailyLimit`, `setSenderDailyLimit`, `setMaxFeePerGas`, `setRequiredAccountCodehash`, `setPaused`, `proposeProjectOwner`, `acceptProjectOwnership` | The project's own owner only |
| Free pool | `setFreeTier`, `setFreeMaxFeePerGas` (owner); `pauseFreePool`, `setFreeTargets` (owner or manager) | Owner, manager |
| Governance | `proposeAdminChange`, `executeAdminChange`, `cancelAdminChange` (kind 1 signer, 2 bundler; `address(0)` allowed as a bundler only), `removeSigner`, `removeBundlers`, `setManager`, `setPostOpOverheadGas` (can only lower), `addStake` (delay at most 30 days), `unlockStake`, `withdrawStake` (stake only) | Owner, manager (stake functions and `setManager`, `setPostOpOverheadGas` are owner only) |
| Ownership | OpenZeppelin `Ownable2Step`: `transferOwnership`, `acceptOwnership`, `renounceOwnership` | Owner |
| Views | `getProject`, `getSenderSpend`, `isTargetAllowed`, `projectIdOf`, `effectiveMaxFeePerGas`, `requiredAccountCodehash`, `pendingAdminChange`, `surplus`, `totalLiabilities`, `adminChangeDelay`, `defaultMaxFeePerGas`, `postOpOverheadGas`, `maxPostOpOverheadGas`, `freeEnabled`, `freeMaxOpCost`, `manager`, `entryPoint`, `signers`, `isBundlerAllowed` | Anyone |

There is no `receive()` or plain `deposit()`, and **no withdrawal function of any kind** for ledger funds. The contract never calls `entryPoint.withdrawTo` (a test scans the bytecode for that selector). `withdrawStake` moves only the separate EntryPoint stake balance. `claimProject` sets only the owner, so the owner follows with `setTargets`, `setDailyLimit` and `setSenderDailyLimit`. A claim of a project with **no deposited funds is immediate**; the claim of a project that **already holds funds is pending** for `adminChangeDelay` (event `ProjectClaimProposed`), signer-bound, cancellable by the contract owner or manager, and finished by anyone with `executeReclaim`. `setMaxFeePerGas` and `setFreeMaxFeePerGas` cannot exceed `defaultMaxFeePerGas`; `setFreeTier` rejects a non-zero per-wallet limit below the per-op cap (`InvalidFreeTierConfig`); `proposeProjectOwner(id, address(0))` withdraws a nomination.

### Events

`ProjectClaimed`, `ProjectClaimProposed` (pending first claim; the contract owner and manager should watch), `ProjectReclaimProposed` (owners should watch), `ProjectReclaimCancelled`, `Deposited`, `TargetSet`, `DailyLimitSet`, `SenderDailyLimitSet`, `PausedSet`, `ProjectOwnershipTransferStarted`, `ProjectOwnershipTransferred`, `FreeTierConfigured`, `SurplusCreditedToFreePool`, `ManagerSet`, `PostOpOverheadGasSet`, `BundlerAllowlistUpdated`, `SignerAdded`, `SignerRemoved`, `AdminChangeProposed` (projects should watch), `AdminChangeCancelled`, `MaxFeePerGasSet`, `RequiredAccountCodehashSet`, OpenZeppelin `OwnershipTransferStarted` and `OwnershipTransferred`, `SponsorReserved` and `UserOpSettled`.

### Errors

`NotEntryPoint`, `NotOwnerOrManager`, `NotProjectOwner`, `NotPendingProjectOwner`, `InvalidOwner`, `OwnableInvalidOwner`, `OwnableUnauthorizedAccount`, `ReentrancyGuardReentrantCall`; validation: `PaymasterModeInvalid`, `PaymasterAndDataLengthInvalid`, `PaymasterConfigLengthInvalid`, `PaymasterSignatureLengthInvalid`, `BundlerNotAllowed`, `InvalidValidityWindow`, `PostOpGasLimitTooLow`, `MaxFeePerGasTooHigh`, `AccountCodehashMismatch`, `UnknownSponsor`, `SponsorPaused`, `FreeTierDisabled`, `OpCostTooHigh`, `CostTooLarge`, `UnsupportedCallData`, `TargetNotAllowed`, `DailyLimitExceeded`, `SenderDailyLimitExceeded`, `InsufficientSponsorBalance`; claims: `InvalidAppId`, `InvalidClaimSignature`, `ClaimExpired`, `ClaimAlreadyUsed`, `ClaimDeadlineTooFar`, `ProjectAlreadyClaimed`, `ProjectNotClaimed`, `NoPendingReclaim` (also an expired claim), `ReclaimNotReady`, `ReclaimSignerRemoved`, `ReclaimNotCancellable`; config: `ZeroAmount`, `ZeroDailyLimit`, `ZeroFeeCap`, `DelayTooShort`, `DelayTooLong`, `OverheadOutOfBounds`, `InvalidAdminChange`, `AdminChangeAlreadyProposed`, `AdminChangeNotProposed`, `AdminChangeNotReady`, `InvalidFreeTierConfig`, `NothingToCredit`. The SDK exposes `decodePaymasterRevert` to decode revert data.

### Roles

| Role | Held by | Can | Cannot |
|---|---|---|---|
| Anyone | | Deposit, fund the free pool, submit claims, execute re-claims, credit surplus to the free pool | Withdraw |
| Project owner | Established by an attested claim | Settings, pause, voluntary transfer, cancel a re-claim (once per new owner) | Touch any other project or the free pool; withdraw |
| Owner | The deployer by default; two-step transfer, renounce supported | Free-tier parameters, manager, lower overhead, `addStake`, `unlockStake`, `withdrawStake`, cancel a pending first claim | Reach any ledger money or a project's settings |
| Manager | Should be a different address (the deploy script refuses owner = manager without an explicit override) | Propose and execute signer and bundler additions (timelocked), instant removals, free-pool targets and pause, cancel a pending first claim | Withdraw, change a project, touch the stake |
| Signer(s) | The policy service key | Approve ops and **attest claims** (one shared set) | Withdraw; pay itself unless it is an allowlisted bundler |

### Timelocks

| Change | Delay |
|---|---|
| Signer or bundler **addition** | `adminChangeDelay`: immutable, constructor-enforced between 48 hours and 30 days (deploy default 48 hours) |
| **Re-claim** of an owned project, and the **first claim of a project that holds funds** | The same delay; announced, cancellable (the current owner once per new owner; the contract owner or manager for a first claim), void if its attesting signer was removed since |
| Any pending claim, re-claim or admin addition | Lapses 30 days after it becomes executable (`PENDING_EXPIRY`) |
| Removals (signer, bundler), pause, limit and fee-cap changes | Instant |
| Attestation validity | At most 1 hour (`ClaimDeadlineTooFar`) |

A project's defence during a timelock window is to pause and tighten its limits.

### Size and pinned build

Runtime size is 23,722 bytes against the 24,576-byte EIP-170 limit (854 bytes of headroom), so any further change needs a size check. It fits only because this contract is compiled with **8,000 optimizer runs** (25,115 bytes at 1,000,000), which costs about 0.2% on validation and 0.5% on `postOp`; `foundry.toml` applies that to this contract only, so the deployed v1 build is unchanged. The deploy script pins the creation-bytecode hash `0x86153ab5c7faa3a83ea9949b2a44ebba196ce367227d376b9a28290e3a468164`, which reproduces only from LF line-ending sources (enforced by `.gitattributes`).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `AA33` with `BundlerNotAllowed` | Executor not on the v2 allowlist | Use the PEPU bundler |
| `TargetNotAllowed` | Call goes outside the allowlist | Owner runs `setTargets` |
| `UnknownSponsor` | Project not claimed (or its claim is still pending) | Claim it, and `executeReclaim` after the delay if the project already held funds; deposits are not spendable before |
| `ZeroDailyLimit` at validation | The project never called `setSenderDailyLimit` | Run `setSenderDailyLimit` |
| `PaymasterModeInvalid` | v1-layout data sent to v2 | Use v2 paymaster data from the v2 route |

## Related

- [Paymaster v2 Spec Summary](../../contracts/paymaster-v2-spec.md)
- [Audits and Verification Status](../../contracts/audits.md)
- [Register, Deposit and Claim a v2 Project](v2-register-deposit-claim.md)
- [Address Map](../../contracts/address-map.md)
