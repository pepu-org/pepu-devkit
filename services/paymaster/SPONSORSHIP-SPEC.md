# PEPU Tiered Gas Sponsorship — Specification (v2)

Status: **implemented and deployed on PEPU mainnet as a canary at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (internally reviewed 3x, external audit pending, funded in small tranches).** Deployed 2026-10-14 (record: `contracts/deployed-address-v2.txt`, `contracts/deploy-receipt-v2.json`); owner `0x5966dFaB11c8AEe767e0739083417D02f4a634A1`, manager `0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0`, free pool seeded with 300 PEPU, free-tier targets TapScore only for now. The v1 paymaster `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` is **retired** (deposit withdrawn). The hosted policy service serves v2 at `https://paymaster.pepeunchained.com/v2/*`; a project-sponsored operation from a fresh 0-PEPU Kernel account is proven through the hosted URLs (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`). The per-user free allowance in production is 100 PEPU/day and 50 PEPU/hour (service config); numbers below describe the original design unless stated.

Files: contract `contracts/src/PepuSponsoredPaymasterV7.sol`, tests `contracts/test/PepuSponsoredPaymasterV7*.t.sol`,
deploy `contracts/deploy-sponsored-paymaster.sh`, service `policy-service/src/sponsorship/*`, API
`policy-service/openapi.yaml`.

**Revision after the internal review** (`audits/2026-10-internal-review.md`, an INTERNAL AI-assisted review, not an
external audit): signer/bundler additions are timelocked, an on-chain per-op fee cap was added, the day counters were
fixed, the postOp overhead floor was raised, the signer bounds user gas fields, and client-token reservations are
capped. Section 14 records the decisions (D9 to D14); the external audit and a fork test against the actual PEPU chain
remain open.

**Revision after the owner's deposit-only decision** ("anyone can deposit for gas, so remove the withdraw option; let
anyone deposit and no one withdraw"): deposits are one-way, there is no withdrawal function of any kind, project
identity is the Privy app (`keccak256(appId)`) with settings ownership proven by a signer attestation (section 9.2),
pausing replaced withdrawing as a project's defence against a rogue signer or bundler, and the admin timelock is a
fixed immutable delay of at least 48 hours (D15 to D18). A **delta review of these changes is pending** (see the note
in `audits/2026-10-internal-review.md`); the contract has had no external audit.

**Revision after internal review #3** (`audits/2026-10-review-3.md`, three parallel pashov-method auditors; INTERNAL, AI-assisted, not an external audit): 0 Critical, 0 High, 3 Medium, 6 Low, all fixed, plus the Info items B5, C-L1, A7 and the openapi gaps. The first claim of a funded project is now timelocked and cancellable (M-1), a hostile owner can veto a re-claim only once per new owner (M-2), the service no longer persists unknown-credential denials and throttles per IP (M-3), projects fail closed without a per-wallet limit (L-1), `addStake` is owner-only with a 30-day delay cap (L-2), `address(0)` is a reversible bundler (L-3), same-nonce replacement keeps the larger reservation (L-4), the engine enforces `allowAccountDeployment` (L-5) and `postOp` charges a validation-time snapshot (L-6). To fit EIP-170 the sponsored contract is compiled with 8,000 optimizer runs (section 15, section 16). Findings that are documented rather than fixed are listed in section 16.

Decisions recorded in section 14 (all resolved except the external audit and the fork test against the PEPU chain):
free tier 50 PEPU per user per day with **no chain-wide ceiling**; **deposits one-way and open to anyone, no
withdrawals by anyone**; one canonical project per Privy app with **attested ownership claims**; the **deployer owns**
the contract (two-step transfer, renounce); the free tier is **Privy accounts only**; projects may sponsor **any
wallet**; **surplus goes to the free pool**.

---

## 1. Goals and the model

| Tier | Funded by | Who draws | Bound |
|---|---|---|---|
| **Free tier** | The chain (a "free pool" held by the paymaster; the owner and anyone may fund it) | **Users with a verified Privy account only** | 50 PEPU / user / day (service-enforced per Privy user), 40 PEPU max per op, an on-chain per-wallet daily limit as a backstop, the pool balance. **No chain-wide daily ceiling.** |
| **Project tier** | A project, funded by anyone depositing PEPU on-chain (one-way: nothing can be withdrawn) | **Any wallet** the project chooses to sponsor (Privy or not; native/EOA wallets behind smart accounts) | The project's on-chain balance, daily limit, per-wallet daily limit, destination allowlist |

**Draw order (per UserOperation, atomic, no splitting):**

1. If the request authenticates as an **on-chain project** (server key, or client token from an allowed origin) and that project can pay (section 6.1), the **project pays**.
2. Otherwise the op falls to the **free tier**, **only if** the request carries a verified Privy access token, the user has free allowance, and the free pool can cover it.
3. Otherwise it is denied, with the specific reason for each tier that was tried.

Project-first protects the chain: the free pool is only touched when a project cannot or will not pay.
The user's own free allowance is also untouched while a project pays for them. **The free tier never pays for a
wallet that has no verified Privy account**, even when it is a project's user and the project is empty.

**What happens when a project's balance runs out mid-day** (exact rules):

- The op that needs more than `balance - outstanding` is **not** partially covered. The whole op is re-evaluated against the free tier.
- Ops already approved and in flight are unaffected: their `maxCost` was already deducted on-chain at validation (section 5), so they can never fail for lack of project funds after inclusion.
- A Privy user with free allowance keeps working (draws the free pool, up to 50 PEPU/day). A wallet without a Privy account gets `project_balance_exhausted` plus `free_tier_identity_required`.
- Top-up is immediate: a deposit is an on-chain transaction; the service re-reads the chain (<= 2 s cache), no service action needed.
- Sub-`maxCost` dust stays in the project balance (it is not withdrawable; it keeps paying gas later). Worst-case `maxCost` (gas limits x max fee) is what must fit, not the typical actual cost.
- A project may also be paused (by its owner) or hit its own on-chain limits; both behave identically to "cannot pay".

The free tier is the chain's baseline contribution for Privy users. Everything beyond 50 PEPU/day per user, or for a
project's users, is paid by the project (or not at all). The chain never tops up a project.

### Numbers (all configurable)

- Free tier per Privy user: 50 PEPU / rolling 24 h, 30 PEPU / rolling hour, count caps (40/day, 20/h). A first-ever op (account deployment, ~12 PEPU worst case) plus ~12 normal ops (~3 PEPU) ~ 50 PEPU. Env: `FREE_TIER_*`.
- Free pool on-chain: `maxOpCost` (default 40 PEPU), `senderDailyLimit` (deploy default 100 PEPU per smart account per day, 2x the service's per-user number so the service's actual-cost accounting never trips it; 0 = off; a non-zero value below `maxOpCost` is rejected by `setFreeTier`, `InvalidFreeTierConfig`, because it would make every free op fail), `enabled`. Set by the owner: `setFreeTier`. **No daily ceiling exists on the free pool.** (For a PROJECT the per-wallet limit is required: 0 fails closed, section 4.4 step 9.)
- Project per-user cap (service-enforced): default 200 PEPU/day, owner-adjustable up to an admin maximum.
- **No withdrawals exist.** Deposits (project or free pool) can only ever pay gas for sponsored ops.
- `postOpOverheadGas`: 20,000 at deploy (contract floor 18,000, hard ceiling 30,000); see 4.5. It is snapshotted into the context at validation (L-6).
- Fee cap: an immutable on-chain default cap on an op's `maxFeePerGas` (deploy default 40,000 gwei, about 3x the measured ~12,500 gwei base fee), overridable per project (`setMaxFeePerGas`) and for the free pool (`setFreeMaxFeePerGas`, owner) but **only downwards: a sponsor cap above the immutable default reverts `MaxFeePerGasTooHigh`** (review 3, M-1: a rogue project owner can no longer lift the cap); the signer additionally bounds gas fields (6.1).
- Admin timelock: a signer or bundler addition, a re-claim of an owned project, and the FIRST claim of a project that already holds funds, take effect `adminChangeDelay` after they are proposed (and lapse `PENDING_EXPIRY` = 30 days after they become executable): an **immutable constructor value with a constructor-enforced floor of 48 h** (deploy default 48 h, `ADMIN_CHANGE_DELAY_SECONDS`); removals are instant. A project's defence during that window is to **pause** (and tighten its fee cap and limits), all of which are instant.
- Approval validity window: 60 s (was 90 s); the signed `validAfter` starts 5 s before signing (clock-skew tolerance).

---

## 2. Design principles: adopted, refined, and deviations

1. **Funds on-chain, not in our DB.** Adopted. A single contract `PepuSponsoredPaymasterV7` is both paymaster and vault. All PEPU sits in the paymaster's EntryPoint deposit (so gas is paid from it directly); the contract keeps a per-sponsor *ledger* of who owns what share. `sum(ledger) <= entryPoint.balanceOf(paymaster)` is the core invariant (section 8). *Refinement:* a paymaster+vault pair was rejected: funds would have to be moved into the EntryPoint per-op or in bulk (extra trust, extra moving part). One contract with a ledger is simpler to verify.
2. **Charge actual cost on-chain.** Adopted, with a refinement: **prepay-then-refund** instead of reserve-then-charge. Validation deducts the *full* `maxCost` from the sponsor ledger; `postOp` refunds `maxCost - charge` **to that same sponsor**. See 4.5 for the charge formula (including the EntryPoint's unused-gas penalty) and for the postOp-revert case.
3. **Safety.** Adopted, plus extras: on-chain per-project daily limit and per-wallet daily limit (bound a compromised signer), on-chain destination allowlist per sponsor (decoded from Kernel callData in validation), `isBundlerAllowed` retained, **no owner function reaches any sponsor-attributable money** (no surplus sweep), `postOp` that cannot revert. Threat model in section 11.
4. **Sybil resistance.** The free tier is keyed on a **verified Privy account**; smart-account addresses are free to mint, so an address is never an identity. Without a chain-wide ceiling the bounds on a determined sybil are: one Privy account per identity (Privy-side rate limits), 50 PEPU per account per day, the per-wallet on-chain limit, the per-op cap, and the pool balance. See section 7 and residual risk R2.
5. **Deposits and claims.** Deposits are fully on-chain, permissionless and one-way: anyone calls `depositFor(projectId)` (or `fundFreePool()`). A project is one Privy app, `projectId = keccak256(bytes(appId))`; its settings belong to the owner established by `claimProject`, which requires an EIP-712 attestation from a current signer (section 9.2). The claim sets no configuration: the owner configures the project afterwards. The API is an optional convenience layer that verifies the Privy app secret, returns the attestation, indexes the project and issues credentials.

**Deviations from the brief, and why**

- *There are no withdrawals at all (owner decision).* An earlier draft let a project request and execute a withdrawal after a delay, and the free pool was owner-withdrawable. Both are removed: with deposits open to any depositor, a withdrawal right is the only thing that made "who owns a project" a question of who gets the money. Now ownership only decides how pooled gas money is *spent* (allowlist, limits, fee cap, pause), never who can take it. The price is that funds are stranded if a project is abandoned (section 9.4).
- *Free-tier per-user limits are service-enforced, not on-chain.* Identity (a Privy user) is off-chain information; the contract can only enforce per-wallet limits and a per-op cap. This is stated as residual risk R2.
- *Day buckets key off the signed `validAfter`, not `block.timestamp`.* ERC-7562 bans `TIMESTAMP` in validation. Day indices only move forward, and `validAfter <= now` at inclusion (EntryPoint enforces it), so a signer cannot reset a counter early (section 4.4).
- *Project ids are `keccak256(bytes(appId))` again, with attested ownership.* The previous draft namespaced the id by the registrant to stop squatting. With withdrawals gone, the squatting risk is not about funds but about who controls the settings of a project others fund, so the id is the Privy app and settings ownership is proven by a signer attestation instead (section 9.2).

---

## 3. Architecture

```
 anyone (EOA / Safe)                                              contract owner (deployer by default)
   | depositFor / fundFreePool  (one-way, no approval)             | setFreeTier, setManager, lower postOpOverheadGas,
 project owner (attested claim)                                     | addStake / unlockStake / withdrawStake (stake only; never ledger money)
   | claimProject / setTargets / limits / fee cap / pause           | manager: PROPOSE signer/bundler (timelocked), remove (instant),
   | proposeProjectOwner / reclaimProject (timelocked)              | free targets, pause free pool, cancel a pending first claim
   v                                                                v
 +---------------------------- PepuSponsoredPaymasterV7 --------------------------------+
 | ledger: sponsors[sponsorId]{owner,balance,dailyLimit,senderDailyLimit,...}           |
 | sponsorId 0 = FREE POOL (owned by the contract)       targetAllowed[sponsorId][addr] |
 | validatePaymasterUserOp: sig -> sponsor -> targets -> limits -> deduct maxCost       |
 | postOp: refund (maxCost - charge) to the SAME sponsor, emit UserOpSettled            |
 +--------------------------------------^------------------------------+----------------+
                                        | EntryPoint v0.7 deposit       | events
 browser (Privy smart wallet)           |                               v
   -> POST /v2/paymaster/:token  -> policy service v2 ------------> indexer/reconciler
        (ERC-7677)                   signs (sponsorId committed)       (UserOpSettled -> DB)
 project backend -> POST /v2/sponsor (server key)
 frontend dashboard -> /v2/auth (SIWE) -> /v2/projects/* (state, prepare tx, credentials, usage)
```

Components:

- **Contract** (`contracts/src/PepuSponsoredPaymasterV7.sol`): ledger, validation, settlement, claims, one-way deposits, free pool. It uses OpenZeppelin `Ownable2Step` and does **not** inherit the v1 base (`BasePaymaster` exposes an unrestricted `withdrawTo`, and the v1 AccessControl base has no two-step owner or renounce). v1 files are untouched, so v1's pinned creation-code hash is unchanged.
- **Policy service v2** (`policy-service/src/sponsorship/`): decides *whether* to sign, and *which sponsor* the signature commits to; keeps a separate SQLite file (`sponsorship.db`); a reconciler; the gated API. Enabled only when `SPONSORSHIP_V2_ENABLED=true`.
- **Routes:** v1 routes (`/sponsor`, `/paymaster/:token`, `/admin/...`) are unchanged. v2 lives under `/v2/*`, so both can run at once during migration.

---

## 4. Contract

### 4.1 Interface (summary; full ABI generated into `policy-service/src/sponsorship/abi.ts`)

```solidity
constructor(address entryPoint, address owner, address manager, address[] signers, address[] bundlers,
            uint32 adminChangeDelay, uint32 postOpOverheadGas,  // delay >= 48 hours (immutable); overhead is the initial AND maximum
            uint128 defaultMaxFeePerGas)                        // owner != 0; fee cap > 0; initial signers/bundlers effective immediately

// ---- ERC-4337 v0.7 ----
validatePaymasterUserOp(PackedUserOperation, bytes32 userOpHash, uint256 maxCost) returns (bytes context, uint256 validationData)
postOp(PostOpMode, bytes context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
getHash(uint8 mode /* must be 1 */, PackedUserOperation) view returns (bytes32)

// ---- deposits: ONE-WAY, open to anyone ----
depositFor(bytes32 projectId) payable                   // anyone, any project id (claimed or not); NOT the free pool id; no withdrawal exists

// ---- project ownership: attested claims (EIP-712 ProjectClaim) ----
struct Claim { string appId; address newOwner; uint256 nonce; uint256 deadline; bytes signature; }   // signature: 65 bytes from a CURRENT signer
claimProject(Claim) returns (bytes32 projectId)         // FIRST claim; sets the owner ONLY (empty allowlist, dailyLimit 0: nothing spendable until the owner configures; delta L2).
                                                        //   project ledger balance == 0: immediate (ProjectClaimed). balance > 0: PENDING for adminChangeDelay (ProjectClaimProposed), signer-bound (M-1)
reclaimProject(Claim)                                   // owned project: starts a re-claim, effective after adminChangeDelay
executeReclaim(bytes32 projectId)                       // anyone, after the delay and before PENDING_EXPIRY (30 d), if the attesting signer is still a signer; finishes a pending first claim or a re-claim
cancelReclaim(bytes32 projectId)                        // OWNED project: the current owner, ONCE per (project, newOwner) (M-2; a second veto reverts ReclaimNotCancellable).
                                                        // UNOWNED project (pending first claim): the contract owner or manager (M-1)
vetoedReclaimant(bytes32 projectId) view / PENDING_EXPIRY() view
claimDigest(string appId, address newOwner, uint256 nonce, uint256 deadline) view / domainSeparator() view / claimUsed(bytes32 digest) / signerRemovedAt(address)
// attestation deadline must be <= now + 1 hour (ClaimDeadlineTooFar); constructor: adminChangeDelay in [48 hours, 30 days] (DelayTooShort / DelayTooLong)

// ---- project settings: only the project's owner ----
setTargets(bytes32 projectId, address[] targets, bool allowed)
setDailyLimit(bytes32 projectId, uint112 limit)         // > 0
setSenderDailyLimit(bytes32 projectId, uint112 limit)   // > 0
setMaxFeePerGas(bytes32 projectId, uint128 cap)         // 0 < cap <= defaultMaxFeePerGas; cap on an op's maxFeePerGas this project funds (can only tighten)
setRequiredAccountCodehash(bytes32 projectId, bytes32 codehash)   // 0 = off; pin the sender's runtime codehash (L-2)
setPaused(bytes32 projectId, bool paused)               // instant: pausing is a project's exit
proposeProjectOwner(bytes32 projectId, address newOwner) / acceptProjectOwnership(bytes32 projectId)   // voluntary two-step handover (e.g. to a multisig); newOwner == address(0) UNSETS a nomination (B5); accepting never clears a re-claim the owner already vetoed once (M-2)

// ---- free pool ----
fundFreePool() payable                                  // anyone
creditSurplusToFreePool() returns (uint256)             // anyone; unattributable deposit above SURPLUS_RESERVE -> free pool
setFreeTier(uint128 maxOpCost, uint112 senderDailyLimit, bool enabled)   // OWNER; senderDailyLimit == 0 || senderDailyLimit >= maxOpCost (A7)
setFreeMaxFeePerGas(uint128 cap)                        // OWNER; 0 < cap <= defaultMaxFeePerGas
pauseFreePool()                                         // OWNER or MANAGER (emergency stop)
setFreeTargets(address[] targets, bool allowed)         // OWNER or MANAGER

// ---- ownership (OpenZeppelin Ownable2Step) ----
owner() / pendingOwner() / transferOwnership(address) / acceptOwnership() / renounceOwnership()

// ---- owner / manager ----
setManager(address)                                     // OWNER
setPostOpOverheadGas(uint32)                            // OWNER; [MIN_POSTOP_OVERHEAD_GAS, maxPostOpOverheadGas]; can only LOWER (or restore)
withdrawStake(address payable to)                       // OWNER; STAKE only (separate EntryPoint balance), never the deposit
unlockStake()                                           // OWNER (it halts sponsorship by un-staking the paymaster)
proposeAdminChange(uint8 kind, address account)         // OWNER or MANAGER; kind 1 = signer, 2 = bundler executor (address(0) is allowed for kind 2 only, L-3); an expired proposal can be re-proposed
executeAdminChange(uint8 kind, address account)         // OWNER or MANAGER; only after adminChangeDelay and within PENDING_EXPIRY (30 d) of becoming executable
cancelAdminChange(uint8 kind, address account)          // OWNER or MANAGER (a veto)
removeSigner(address) / removeBundlers(address[])       // OWNER or MANAGER; INSTANT, also cancel a pending addition
addStake(uint32 unstakeDelaySec)                        // OWNER only (L-2); unstakeDelaySec <= 30 days (DelayTooLong). A manager could re-lock an owner's unlock and set a 136-year delay

// ---- views ----
getProject(bytes32) / getSenderSpend(bytes32,address) / isTargetAllowed(bytes32 sponsorId, address)
projectIdOf(string appId) / freeEnabled / freeMaxOpCost / surplus() / pendingReclaim(bytes32) / MIN_ADMIN_CHANGE_DELAY / PENDING_EXPIRY
effectiveMaxFeePerGas(bytes32 sponsorId) / requiredAccountCodehash(bytes32) / pendingAdminChange(bytes32 key)
totalLiabilities, adminChangeDelay, defaultMaxFeePerGas, postOpOverheadGas, maxPostOpOverheadGas, manager, entryPoint
```

There is **no** `receive()`/`fallback` and no plain `deposit()`: stray ETH is rejected. ETH sent to `EntryPoint.depositTo(paymaster)` directly counts as *surplus* (unattributable; creditable only to the free pool).

Removed from earlier drafts: the registrar mode and `setRegistrationOpen`, `releaseEmptyProject`, `sweepSurplus`, the free pool's chain-wide `dailyCeiling`, `registerProject` (replaced by attested `claimProject`), and **every withdrawal path**: `requestWithdrawal`, `cancelWithdrawal`, `executeWithdrawal`, `withdrawFreePool`, the `withdrawDelay` immutable and the `pendingWithdrawal`/`withdrawUnlockAt` state, events and errors. `getProject` now returns `(projectOwner, paused, senderDailyLimit, balance, dailyLimit, spentToday, spentDay)`.

**No code path moves ledger funds out of the EntryPoint deposit.** The contract never calls `entryPoint.withdrawTo` (a test scans the runtime code and asserts the selector `0x205c2878` is absent). The only EntryPoint calls that send money are `depositTo` (in), and the owner/manager stake calls `addStake` / `unlockStake` / `withdrawStake`, which act on the EntryPoint's separate *stake* field and cannot touch the *deposit* field that backs the ledgers (EntryPoint v0.7 keeps `deposit` and `stake` as distinct members of `DepositInfo`; `withdrawStake` pays only `stake`). The one permissionless way ledger-adjacent money moves, `creditSurplusToFreePool`, keeps it inside the contract.

### 4.2 Sponsor identity and `paymasterData` layout

`sponsorId` is `bytes32`: `0x00..00` = **free pool**, otherwise a project id = `keccak256(bytes(appId))`, i.e. the Privy app id's hash.

```
paymasterAndData = paymaster(20) | pmVerificationGasLimit(16) | pmPostOpGasLimit(16)    // offset 0..52
                 | modeByte(1) = 0x02 (the ONLY accepted byte; mode 1 << 1, no bypass bit)  // 52
                 | validUntil(6) | validAfter(6)                                          // 53..65
                 | sponsorId(32)                                                          // 65..97
                 | signature(65)  (r, s, v; low-s; v in {27, 28})                          // 97..
signed hash = toEthSignedMessageHash( keccak256(abi.encode(userOpHash', chainId)) )
  where userOpHash' = keccak256(abi.encode(sender, nonce, accountGasLimits, preVerificationGas, gasFees,
                      keccak256(initCode), keccak256(callData), keccak256(paymasterAndData[0:97])))
```

Same hashing as v1 (so `computeUserOpHash`/`computeFinalHash` in the service are reused), but the signed prefix is 97 bytes and **includes `sponsorId`**. A stub (gas-estimation) response uses the same layout and length, so `preVerificationGas` estimates match the final data. Mode 0 (v1 layout) is rejected with `PaymasterModeInvalid`.

### 4.3 State and storage

```solidity
struct Sponsor {                  // one struct for projects AND the free pool (key bytes32(0))
  address owner;       // slot0: address(this) for the free pool; address(0) = UNCLAIMED (deposits accepted, not spendable)
  bool    paused;
  uint128 balance;     // slot1: spendable ledger balance
  uint128 maxFeePerGas;     //        cap on an op's maxFeePerGas (wei); 0 = use the immutable defaultMaxFeePerGas
  uint112 dailyLimit;  // slot2: projects only (> 0); unused (0) for the free pool
  uint112 spentToday;  //        projects only; includes in-flight reservations
  uint32  spentDay;    //        day index = validAfter / 86400, forward-only
  uint112 senderDailyLimit; // slot3: projects: > 0 REQUIRED (validation reverts ZeroDailyLimit when 0); free pool: 0 = off
}
struct PendingReclaim { address newOwner; uint48 executableAt; address signer; }   // signer must still be a signer at execution. Holds a pending re-claim (owned project) OR a pending first claim (owner == 0)
struct SenderSpend { uint32 day; uint112 spent; }          // reserved-and-spent per (sponsor, sender, day)
mapping(bytes32 sponsorId => Sponsor) sponsors;
mapping(bytes32 sponsorId => mapping(address => bool)) targetAllowed;
mapping(bytes32 sponsorId => mapping(address sender => SenderSpend)) senderSpend;
mapping(bytes32 => address) pendingProjectOwner;
mapping(bytes32 projectId => PendingReclaim) pendingReclaim;
mapping(bytes32 projectId => address newOwner) vetoedReclaimant;    // the newOwner whose re-claim the owner cancelled; one veto per pair (M-2), cleared when that re-claim executes
mapping(bytes32 digest => bool) claimUsed;                          // each attestation is single-use
mapping(address signer => uint48) signerRemovedAt;                  // last removal time; a re-claim proposed at or before it never executes (delta L3)
mapping(bytes32 sponsorId => bytes32) requiredAccountCodehash;     // 0 = no pin
mapping(bytes32 key => uint48) pendingAdminChange;                  // key = keccak(kind, account) => earliest execution time
address manager;  bool freeEnabled;  uint128 freeMaxOpCost;  uint32 postOpOverheadGas;
uint256 totalLiabilities;           // == sum of all sponsors[*].balance
```

The free pool is `sponsors[0]` with `owner = address(this)`, so no EOA can ever satisfy a project-owner check for it; it is managed only through the owner/manager functions above.

### 4.4 Validation algorithm (`validatePaymasterUserOp`)

1. `msg.sender == entryPoint`.
2. Parse `paymasterAndData`; require `modeByte == 0x02` exactly (any other byte, including the v1 "allow all bundlers" bit, reverts `PaymasterModeInvalid`), then ALWAYS enforce `isBundlerAllowed[tx.origin]` (address(0) is allowlisted for estimation). There is no signer-controlled way to switch the gate off (delta review M1). **Bundler conformance (audit L-3):** this gate uses `ORIGIN`, which ERC-7562 [OP-011] bans during validation, so a conformant (safe-mode) public-mempool bundler rejects every op this paymaster signs. The contract is supported only behind a **self-run bundler with the opcode ban off** (Alto safe-mode false) whose executor is allowlisted. `address(0)` is allowlisted only so estimation works (a mined tx never has `tx.origin == 0`); a non-allowlisted third-party bundler would see ops that pass simulation but revert (AA33) at inclusion. The gate is the only on-chain property restricting who can be PAID, and it binds even a compromised signer: without it a signer key plus any EOA acting as its own bundler could collect gas payments from unclaimed deposits, the free pool and any project. The bundler allowlist and its timelock are therefore load-bearing.
3. `mode == 1`, config length >= 12 + 32 + 65, **signature exactly 65 bytes** (`PaymasterSignatureLengthInvalid` otherwise; the 64-byte EIP-2098 form is not accepted).
4. Recover the signer with `ecrecover` (low-s only, v in {27, 28}, non-zero signer; same acceptance as OpenZeppelin's `ECDSA`). If the signature is malformed, unrecoverable, or **not** from an authorised signer: return `SIG_VALIDATION_FAILED` (packed) with **empty context and no state change** (needed so gas-estimation stubs never revert and never charge).
5. `validUntil != 0` (a never-expiring approval is rejected), `paymasterPostOpGasLimit >= MIN_POSTOP_GAS_LIMIT`.
5a. **Fee cap (M-2b / L-4):** the op's `maxFeePerGas` must be `<=` the sponsor's cap (its own, else the immutable `defaultMaxFeePerGas`), else `MaxFeePerGasTooHigh`. The EntryPoint charges `min(maxFeePerGas, maxPriorityFeePerGas + basefee)` per gas, so no signer approval can make a sponsor pay a higher gas price than the cap.
5b. **Account pin (L-2, optional):** if the sponsor set `requiredAccountCodehash`, the sender's runtime codehash must equal it (`AccountCodehashMismatch`). The sender's code exists by now (account validation, including `initCode`, runs before paymaster validation).
6. Load `sponsors[sponsorId]`: must be claimed (`owner != 0`, else `UnknownSponsor`: deposits to an unclaimed project are not spendable), not paused. For the free pool: `freeEnabled` and `maxCost <= freeMaxOpCost`.
7. **Destination check on-chain:** decode Kernel v3 `execute(bytes32 mode, bytes executionCalldata)` (selector `0xe9ae5c53`; single `0x00` or batch `0x01`; anything else reverts `UnsupportedCallData`); every target must satisfy `targetAllowed[sponsorId][target]`, else `TargetNotAllowed`. An empty allowlist therefore sponsors nothing (fail closed). Account self-calls are denied unless the owner explicitly allowlists the account.
8. Roll the day bucket: `day = validAfter/86400`. **Projects:** if `day > spentDay` reset `spentToday`; require `spentToday + maxCost <= dailyLimit`. (The free pool has no daily counter.) `validAfter` is signed and `<= block.timestamp` at inclusion, so day can only advance when real time has advanced past that day. An op whose `validAfter` day is OLDER than the counter's lands in the current bucket, and **the context records the bucket the reservation really landed in** (`projectDay`, `senderDay`), so `postOp` releases the refund from that bucket (audit L-1; before the fix the refund was skipped for such ops and the counter leaked).
9. **Per-wallet limit:** if the sponsor's `senderDailyLimit != 0`, roll `senderSpend[sponsor][sender]` the same way and require `spent + maxCost <= senderDailyLimit`, else `SenderDailyLimitExceeded`. This is what stops one wallet (or a stranger spamming one fresh wallet) from consuming a sponsor's day. **For a project it is required (review 3, L-1): a project whose `senderDailyLimit` is 0 reverts `ZeroDailyLimit`, so a claim alone (which sets no configuration) can never leave a project with no per-wallet bound.** Only the free pool may run with 0 = off. The service mirrors this (`project_sender_limit_not_set`).
10. Check `balance >= maxCost` else revert `InsufficientSponsorBalance` (**no silent fallback**; the signer committed to this sponsor).
11. **Deduct:** `balance -= maxCost; totalLiabilities -= maxCost` (and the counters above). Emit `SponsorReserved`.
12. Return `context = abi.encode(sponsorId, uint128 maxCost, userOpHash, sender, uint32 projectDay, uint32 senderDay1, uint256 extraGas)` and `validationData` packed with the signed window. `extraGas = postOpOverheadGas + (callGasLimit + paymasterPostOpGasLimit) / 10` is **snapshotted here** (review 3, L-6), and `senderDay1 = senderDay + 1` for a tracked sender, `0` for an untracked one (the free pool with a zero limit); the `+ 1` keeps day index 0 (`validAfter == 0`) distinguishable from "not tracked". Because everything `postOp` needs is in the context, it makes no cold storage read of `postOpOverheadGas` or `senderDailyLimit`, and an owner changing either between validation and `postOp` cannot change what an in-flight op is charged (see 4.5).

Validation writes only the paymaster's own storage plus slots associated with the sender (allowed by ERC-7562 for a staked paymaster; v1 is staked 100 PEPU and Alto runs with safe-mode off, see OQ8).

### 4.5 `postOp`, charge formula, and where residue comes from

```
extraGas = (snapshot taken at validation) postOpOverheadGas + penaltyBasis / 10, penaltyBasis = callGasLimit + paymasterPostOpGasLimit
charge   = min(reserved, actualGasCost + extraGas * actualUserOpFeePerGas)      // saturating, never reverts
refund   = reserved - charge                                                      // credited to sponsors[sponsorId] (the exact payer)
sponsors[id].balance += refund; totalLiabilities += refund
projects: spentToday -= min(refund, spentToday) if the bucket (projectDay) is still current; per-wallet counter likewise (senderDay)
emit UserOpSettled(id, userOpHash, sender, reserved, charge)
```

**Why the charge has two extra terms.** `actualGasCost` excludes everything EntryPoint v0.7 charges *after* `postOp` is called. Two things are charged that `postOp` cannot see: (a) the gas of the `postOp` call itself plus its frame, covered by `postOpOverheadGas`; (b) a **10% penalty on unused execution gas** (`callGasLimit + paymasterPostOpGasLimit - gas actually used`), added after `postOp` returns. The first draft of this design charged only (a); with a large unused `callGasLimit` the EntryPoint would debit the deposit by more than the ledger charge, leaving the shared deposit short (this was found while tightening the overhead and is covered by a fuzz test and a mutation check). The charge now includes the **worst case** of (b), `penaltyBasis / 10` (as if none of the execution gas were used). The overcharge is the difference between that worst case and the real penalty.

**Residue (what is genuinely unattributable).** `charge - EntryPoint's true cost` per op = (overhead gas charged - real postOp gas) + (worst-case penalty - real penalty), times the fee. It is small (a few percent of a typical op; the real-EntryPoint postOp measurements are in section 15 against 20k charged, and the service sets `paymasterPostOpGasLimit` to the contract minimum 40,000 so the penalty basis stays small), always positive by construction, and it cannot be assigned to a payer on-chain because the true cost is unknown inside `postOp`. It accrues as `surplus() = entryPoint deposit - totalLiabilities`. Direct donations to `EntryPoint.depositTo(paymaster)` also count. **Nothing can send surplus to the owner or to any address the caller picks.** `creditSurplusToFreePool()` (permissionless) moves surplus above `SURPLUS_RESERVE` (1 PEPU, kept as a solvency buffer against rounding) into the free pool ledger. So the residue returns to the pool that funds users' gas, not to an account.

**Overhead bounds.** `postOpOverheadGas` is set at deploy (default 20,000) and doubles as the immutable maximum `maxPostOpOverheadGas`; the owner can only lower it, down to `MIN_POSTOP_OVERHEAD_GAS` (**18,000**). The floor is above the worst postOp gas measured **on the real EntryPoint v0.7** (section 15), as the EntryPoint attributes it (`preGas - gasleft()` around the call, dispatch included): **8,317** for an honest op and **13,918** for an op that restores the sponsor's `balance` and `totalLiabilities` slots from its own execution (making `postOp`'s two stores clean-to-dirty), with `postOpOverheadGas` and `senderDailyLimit` read from COLD slots in the test transaction. History: the original review measured about 12.7k (14.6k with dispatch), but its harness lowered the overhead inside the test transaction, which warmed the slot `postOp` reads and hid 2,000 gas; the third review (A1) re-measured it cold at **16.2k to 18.1k against the 18,000 floor**, so solvency rested partly on the penalty over-collection. Snapshotting the overhead (and the "sender tracked" marker) into the context at validation removes both cold reads and brings the worst case to 13,918, leaving 4,082 gas of margin on the overhead term alone; the penalty term is a second, independent over-collection. The real-EntryPoint test suite now sets the overhead to its floor in `setUp` (a separate transaction in Foundry) so every test starts cold. The floor itself was not lowered. It can never be raised above the deployed value, so an owner cannot make projects pay more than the disclosed overhead.

**The postOp-revert path.** `postOp` is written so it cannot revert (guarded arithmetic, no external calls, no loops), and the contract refuses an approval whose `paymasterPostOpGasLimit` is below 40,000 (~3x the measured gas), so an out-of-gas revert needs a bundler fault. The refund runs in `postOp` for both `opSucceeded` and `opReverted` (a reverted user call). If `postOp` did revert, EntryPoint v0.7 (see `EntryPoint._postExecution`, which does **not** re-invoke `postOp` in `postOpReverted` mode) refunds `prefund - finalCost` to the paymaster's deposit while the ledger keeps the full `maxCost` deduction: the sponsor is overcharged by the unused part, never undercharged, and the ledger can never become insolvent. That orphaned amount is **not** refunded to the sponsor on-chain (the true cost is unknown); it becomes surplus and goes to the free pool. The indexer can detect it (`SponsorReserved` without `UserOpSettled`) and the project can be made whole by the operator out of band. This is the only case where a payer is not refunded exactly, and it requires a bundler to underprovision gas after signing; an on-chain claim mechanism is left as an optional follow-up (it needs either per-op storage, about 44k extra validation gas, or a signer-attested voucher).

### 4.6 Deposits are one-way (no withdrawal flow)

`depositFor(projectId)` and `fundFreePool()` credit the ledger and forward the value to `EntryPoint.depositTo`. Nothing ever debits a ledger except validation (`maxCost`, partly refunded in `postOp`), so the **sum of ledgers plus surplus only decreases through gas settlement**: the EntryPoint pays the bundler `finalCost` for ops this paymaster sponsored. In-flight ops cannot be hurt by any owner action (their `maxCost` already left the ledger at validation); pausing makes later validations revert (`SponsorPaused`).

Consequences, stated plainly: (a) a depositor cannot get money back, so check who controls a project before funding it (`getProject(id).projectOwner`; `address(0)` means unclaimed); (b) a stranger funding your app's project cannot hurt you or your users, they only add gas budget under *your* settings; (c) funds in a project that is never claimed, or whose owner is gone, are locked (section 9.4).

### 4.7 Events (indexing contract)

`ProjectClaimed(projectId, owner, appId)` (immediate claim of an empty project), `ProjectClaimProposed(projectId, newOwner, executableAt, appId)` (pending first claim of a funded project; carries the app id because `ProjectClaimed` is not emitted for it; **the contract owner, manager and depositors should watch it**), `ProjectReclaimProposed(projectId, currentOwner, newOwner, executableAt)` and `ProjectReclaimCancelled` (**owners should watch `ProjectReclaimProposed`**), `Deposited(sponsorId, from, amount, newBalance)`, `TargetSet(sponsorId, target, allowed)`, `DailyLimitSet`, `SenderDailyLimitSet`, `PausedSet`, `ProjectOwnershipTransferStarted/Transferred` (also emitted when a re-claim executes), `FreeTierConfigured(maxOpCost, senderDailyLimit, enabled)`, `SurplusCreditedToFreePool`, `ManagerSet`, `PostOpOverheadGasSet`, `BundlerAllowlistUpdated`, `SignerAdded/Removed`, `AdminChangeProposed(key, kind, account, executableAt)` and `AdminChangeCancelled` (**projects should watch `AdminChangeProposed`**), `MaxFeePerGasSet`, `RequiredAccountCodehashSet`, OpenZeppelin `OwnershipTransferStarted/OwnershipTransferred`, `SponsorReserved(sponsorId, userOpHash, sender, amount)`, `UserOpSettled(sponsorId, userOpHash, sender, reserved, charged)`. `userOpHash` is the EntryPoint's canonical hash.

### 4.8 Ownership: who can do what, and what a renounce makes impossible

The **deployer is the owner by default** (`PAYMASTER_OWNER_ADDRESS` in the deploy script is an optional override). The **manager should be a different address** (`PAYMASTER_MANAGER_ADDRESS`): the deploy script warns loudly, and refuses to broadcast, when manager == owner unless `ALLOW_SINGLE_KEY_ROLES=1`. Ownership uses OpenZeppelin `Ownable2Step`: `transferOwnership(new)` only nominates; `acceptOwnership()` by the nominee completes it; `renounceOwnership()` sets the owner to the zero address permanently (and clears any pending nominee). The constructor refuses a zero owner.

| Power | Who | Notes |
|---|---|---|
| Deposit into a project or the free pool | **Anyone** | One-way. No one can withdraw. |
| Allowlist, limits, fee cap, codehash pin, pause, transfer a **project** | The project's own owner (attested claim) | **Never depends on the contract owner or manager.** |
| `fundFreePool`, `creditSurplusToFreePool` | Anyone | |
| `setFreeTier` (per-op cap, per-wallet limit, enable) | Owner | |
| `pauseFreePool` (disable only), `setFreeTargets` | Owner or manager | Re-enabling needs the owner. |
| `proposeAdminChange` / `executeAdminChange` (signer or bundler ADDITION) | Owner or manager | **Timelocked**: effective only `adminChangeDelay` (immutable, >= 48 h, enforced by the constructor) after the proposal. Any owner or manager can `cancelAdminChange`. Projects respond by pausing. |
| `removeSigner` / `removeBundlers` | Owner or manager | **Instant**: a removal can only make the paymaster safer. Also cancels a pending addition. |
| `addStake` | **Owner** (L-2) | Stake is not ledger money. Owner-only because a manager could cancel the owner's `unlockStake` and set a 136-year delay that can never be lowered; the delay is capped at 30 days. |
| `cancelReclaim` of a pending FIRST claim (unowned project) | Owner or manager | M-1. Not a veto of an owner's re-claim: that is the project owner's, once per new owner. |
| `unlockStake` | Owner | Un-staking halts sponsorship (ERC-7562 staked status), so it is not a hot-role power. |
| `setFreeMaxFeePerGas` | Owner | |
| `setMaxFeePerGas`, `setRequiredAccountCodehash` | The project's own owner | Per-project bounds the project chooses. |
| `setManager` | Owner | |
| `setPostOpOverheadGas` | Owner | Only down to 18,000 (or back up to the deployed value). |
| `withdrawStake` | Owner | Stake is the chain's own (never a sponsor's) and a different EntryPoint balance from the deposit. |
| `transferOwnership` / `renounceOwnership` | Owner | |

**What becomes impossible after `renounceOwnership()`:**

- `setFreeTier`: the per-op cap and per-wallet limit are frozen at their last values, and **if the free tier is disabled at that moment it can never be re-enabled** (the manager can still disable it, via `pauseFreePool`, but never re-enable it).
- `setManager`: the manager can no longer be changed or removed.
- `setPostOpOverheadGas`: the overhead is frozen at its last value.
- `addStake` / `unlockStake` / `withdrawStake`: the stake is frozen as it is; staked PEPU can no longer be withdrawn by anyone.
- `transferOwnership` / `acceptOwnership` / a second `renounceOwnership`.

**What keeps working after a renounce:** every project function (claim, deposit, allowlist, limits, pause, project ownership transfer and re-claim), sponsorship validation and settlement, `creditSurplusToFreePool`, and the **manager's** operational powers (propose/execute/cancel signer and bundler additions with the timelock, instant removals, `setFreeTargets`, `pauseFreePool`, cancelling a pending first claim). Note the consequence: signer rotation after a renounce depends on the manager key being held and honest. A compromised signer with **no** manager could never be removed, and with no free-pool ceiling it could drain the free pool at the per-op cap (the on-chain per-wallet limit is per sender, and the signer can invent senders). The recommended sequences are therefore:

- **Hand over:** `transferOwnership(newOwner)` then `newOwner.acceptOwnership()` (two transactions, so a typo cannot lose the contract).
- **Freeze but keep an operator:** `renounceOwnership()` with a manager in place (accept that the manager can change signers, bundlers (after the timelock) and free destinations forever).
- **Total freeze:** `setManager(address(0))` then `renounceOwnership()`. No privileged account then exists; a leaked signer key can never be rotated, so do this only after the signer is considered permanently safe, or keep the free pool small.

---

## 5. Accounting rules

1. Ledger credit happens only from `msg.value` that is forwarded to `EntryPoint.depositTo(address(this))` in the same call (`depositFor`, `fundFreePool`), and from `creditSurplusToFreePool` (which converts existing unattributed deposit).
2. Ledger debit happens **only** at validation (full `maxCost`). Credit-back only in `postOp`, to the same sponsor. There is no other debit and no withdrawal.
3. `creditSurplusToFreePool` is bounded by `entryPoint.balanceOf(this) - totalLiabilities - SURPLUS_RESERVE`. No function pays surplus out, and no function reduces any ledger except validation.
4. `totalLiabilities` equals the sum of balances after every external function (tested by an invariant suite).
5. The EntryPoint deposit decreases by `maxCost` right before our validation runs and is refunded `maxCost - finalCost` after `postOp`; `charge >= finalCost` therefore keeps `deposit >= totalLiabilities` (4.5).
6. If `postOp` reverts (should not happen): see 4.5, the sponsor is overcharged, the ledger is never short.

### Off-chain accounting (service)

- Every approval writes a `usage_events` row with the **worst-case reservation** and the sponsor it committed to. When `UserOpSettled` is seen, the row's `final_wei` is set to the *actual charge*; users' free allowance is computed on `final ?? reserved`. This replaces v1's "book worst case forever, no reconciler".
- An approval whose `validUntil` has passed **and** the chain has been scanned past that time (minus a 60 s margin for indexing lag) with no settlement is `voided` (it can never execute) and stops counting toward the per-user caps. Its off-chain RESERVATION stops counting the instant its signature expires (the outstanding queries are time-gated on `validUntil`, no reconciler run needed).
- Outstanding (unexpired, unsettled) approvals are subtracted from the chain balance (and from the per-wallet limit, per wallet) when deciding the next op, so concurrent requests cannot all pass on the same balance.
- A re-request for the same (sponsor, sender, nonce) **replaces** the earlier unexecuted approval **only if the new reservation is at least as large** (review 3, L-4): only one op per nonce can execute, so the exposure per nonce is the MAX of its live signatures, and the earlier signature stays valid until its own `validUntil` even after a replacement. A smaller re-request therefore leaves the earlier, larger approval live (counted against the balance, limits and per-user caps until it expires); while both are live the smaller one also counts, which is conservative and bounded by the signature lifetime (60 s). Before the fix, alternating an expensive and a cheap request for one nonce held many valid expensive signatures while the caps saw only the cheap ones (free tier: 20 approvals worth 119.6 PEPU against a 30 PEPU hourly cap; project: 24 live approvals worth 143 PEPU against a 100 PEPU balance); the on-chain limits held either way. The replacement is atomic with the caps check: a denied re-request leaves the earlier approval intact.
- **Reservation caps (audit M-1).** Because an unexecuted approval still reserves budget off-chain, the PUBLIC client token is limited to: 2 live unexecuted approvals per wallet; per IP, 5% of the project's budget (`min(balance, daily limit)`); in total across IPs, 25% of that budget. Every scope may always hold at least 2 worst-case ops so small budgets stay usable. The secret server key is exempt. Env: `SPONSORSHIP_RESERVATION_PER_SENDER_MAX_COUNT`, `..._PER_IP_BPS`, `..._PER_CREDENTIAL_BPS`, `..._MIN_OPS`.

---

## 6. Free tier, project selection and caps

### 6.1 Service decision pipeline (`SponsorshipEngine.evaluate`)

0. **Before the body is read** (review 3, M-3): `POST /v2/sponsor` is limited **per IP** (default 600/min, `RATE_LIMIT_SPONSOR_PER_IP_PER_MIN`); an ERC-7677 request whose URL token resolves to no credential is limited **per IP only** (default 60/min, `RATE_LIMIT_RPC_UNKNOWN_TOKEN_PER_IP_PER_MIN`), because keying on the token gave every junk token a fresh bucket. Known tokens keep the per-token+IP limit.
1. Credential -> project: the request's `X-Api-Key` / URL token is looked up by hash (constant-time compare) and is either the project's **server key** or its **client token**; suspended rows are denied. A missing or unknown credential is denied **without writing an audit row** (it is counted in memory and reported by `GET /v2/admin/overview` as `unauthenticated.unknownCredentialDenials`): an unauthenticated caller must not be able to cause a synchronous SQLite insert per request. Client-token requests are **rate limited per IP** (default 30 evaluations/min, `RATE_LIMIT_CLIENT_TOKEN_PER_IP_PER_MIN`) before any work is done.
1b. **Account deployment switch (L-5):** if `SPONSORSHIP_V2_ALLOW_ACCOUNT_DEPLOYMENT=false` and the op carries `factory`/`factoryData`, deny `account_deployment_disabled` (403). This is in the engine, so `POST /v2/sponsor` and the ERC-7677 route both enforce it (the ERC-7677 route keeps its JSON-RPC error shape).
2. Decode callData (Kernel `execute`), deny undecodable.
2b. **Bound the user-supplied gas fields (audit L-4).** Deny (`gas_limits_out_of_bounds` / `fee_out_of_bounds`) unless `preVerificationGas <= 1,000,000`, `verificationGasLimit <= 1,500,000`, `callGasLimit <= 3,000,000`, `maxFeePerGas <= min(3 x current base fee, 40,000 gwei)`, `maxPriorityFeePerGas <= min(base fee, maxFeePerGas)` (all configurable: `SPONSORSHIP_V2_MAX_*`). The base fee is read from the latest block; a read failure denies (fail closed). Per sponsor, an op above the sponsor's **on-chain** fee cap is also refused (`fee_above_onchain_cap`) so no approval is wasted on an op the contract would reject.
3. Compute `maxCost` exactly as EntryPoint does (sum of five gas limits x `maxFeePerGas`, using v2 paymaster gas limits).
4. Resolve identity (section 7): a verified Privy token -> `privy:<id>`; no usable token -> a bare `sender:<addr>`. An invalid token is denied.
5. **Project path** (only if the row is bound to an on-chain project):
   - *client token*: the request `Origin` must be one of the project's allowed origins (none configured = the client token cannot spend the project at all); *server key*: no origin check;
   - `requireIdentity` (opt-in) satisfied; on-chain state (<= 2 s cache): exists, not paused, **a non-zero on-chain per-wallet limit (`project_sender_limit_not_set`, mirroring the contract's L-1)**, all targets on the on-chain allowlist, `balance - outstanding >= maxCost`, project daily limit room, the on-chain per-wallet limit (reserved plus this wallet's outstanding approvals), for a **client token** the reservation caps (section 5, `reservation_cap_exceeded`), and the off-chain per-user cap. All pass -> sponsor = project.
6. **Free path** (project path failed or the app is free-tier-only): requires `identity.kind == privy` (else `free_tier_identity_required`), all targets on the on-chain free list, per-user hourly/daily spend and count, on-chain pool `enabled`, `maxCost <= maxOpCost`, `balance - outstanding >= maxCost`, per-wallet limit (if set on-chain). No chain-wide ceiling check exists.
7. Compute the validity window (60 s; `validAfter` 5 s before now), 97-byte prefix **including sponsorId**, hash; atomically (synchronous SQLite transaction) insert the usage row (unique on the paymaster-hash and EP userOpHash); sign.
8. Every decision (approve or deny) that reached a project is written to `audit_log_v2` with the sponsor and reasons; rows older than `SPONSORSHIP_AUDIT_RETENTION_DAYS` (default 30; 0 = keep) are deleted by the reconciler timer (at most hourly). Unknown-credential denials are not written (step 1).

### 6.2 Denial reasons

`project_not_claimed_onchain`, `project_owner_changed`, `project_paused`, `project_balance_exhausted`, `project_daily_limit_reached`, `project_sender_limit_reached`, `project_sender_limit_not_set`, `account_deployment_disabled`, `project_user_cap_exceeded`, `project_identity_required`, `project_origin_not_allowed`, `target_not_allowed_onchain`, `free_tier_identity_required`, `free_tier_disabled`, `free_tier_user_daily_exceeded`, `free_tier_user_hourly_exceeded`, `free_tier_count_exceeded`, `free_tier_sender_limit_reached`, `free_pool_empty`, `free_pool_op_too_large`, `gas_limits_out_of_bounds`, `fee_out_of_bounds`, `fee_above_onchain_cap`, `reservation_cap_exceeded`, `rate_limited`, `app_suspended`, plus the v1 reasons that still apply (`invalid_or_expired_token`, `sender_not_owned_by_token_user`, `calldata_decode_failed`, ...). Removed: `free_tier_chain_ceiling_reached`, `free_tier_anonymous_ceiling_reached`.

---

## 7. Free-tier gating and sybil resistance

**Only users with a Privy account can draw the free tier, proven by a verified Privy access token.** The service verifies the token with the Privy app secret it holds (`PRIVY_APP_ID`), and the budget key is `privy:<userId>`.

| Path | How the Privy user is established | Free tier |
|---|---|---|
| `POST /v2/sponsor` | `Authorization: Bearer <Privy access token>`, verified; with `requireSenderOwnership`, the token user must own `sender` (`getBySmartWalletAddress`) | Keyed on `privy:<id>` |
| `POST /v2/paymaster/:token` | `context.privyAccessToken` in the ERC-7677 request, same verification | Keyed on `privy:<id>` |
| Any request without a verified token | none | **Denied** (`free_tier_identity_required`) |

There is **no anonymous tier** and **no sender-to-user lookup without a token**: a smart-account address is public and free to mint, so neither a fresh address nor an address Privy happens to link proves who is asking, and a lookup would let anyone burn another user's allowance by quoting their address. The earlier "anonymous tier" flags (`ANON_FREE_TIER_*`) and the no-token Privy lookup are removed; old env vars are ignored.

Identity can only be verified for the Privy app whose credentials the process holds. A token from a **third-party** project's own Privy app cannot be verified: it is ignored (granting nothing), so those users draw on the project that sponsors them (which needs no identity), never the free tier.

Backstops without a chain-wide ceiling, strongest first: (1) on-chain per-op cap `maxOpCost` and per-wallet `senderDailyLimit`, which a leaked signer key cannot exceed per wallet; (2) per-Privy-user daily/hourly caps; (3) `isBundlerAllowed` (only our bundler can be paid out of the deposit); (4) the pool balance itself. A leaked signer key can invent wallets, so its worst case is the free pool balance, bounded operationally by funding the pool in tranches and by `removeSigner`.

**Residual risk, stated honestly (R2).** An attacker with N real Privy accounts gets N x 50 PEPU/day of free tier. Creating Privy accounts costs the attacker an email/social login each (Privy-side rate limits apply) but is not free to zero. With no chain-wide ceiling, abuse is bounded by the pool balance rather than a daily ceiling: the owner's decision is that funds can only pay gas, so refusing honest users to cap abusers was judged worse than the risk. Mitigate operationally by funding the pool in tranches and watching `UserOpSettled` volume.

### 7a. Authorizing project-sponsored requests (a stranger must not drain a project)

A project can sponsor **any wallet**, including users with no Privy account, so user identity is not the control. What authorizes a project-sponsored request:

1. **A credential only the project controls issues the request.**
   - **Server API key** (`ppk_...`, secret): used from the project's backend in `X-Api-Key` against `POST /v2/sponsor` (or as the ERC-7677 URL token from a server-side client). Accepted for any wallet, no origin restriction. Never ship it to a browser. Rotatable independently (`POST /v2/projects/:id/server-key/rotate`).
   - **Client token** (`ppt_...`, publishable): the ERC-7677 URL for the Privy dashboard field or a browser client. It is visible to anyone using the app, so it spends the project's budget **only when the request's `Origin` is in the project's `allowedOrigins`**. A project with no allowed origins cannot be spent with its client token at all. Origins are plain `scheme://host[:port]` (no paths or wildcards; `http` only for localhost). Honest limit: browsers enforce `Origin`, but a non-browser client can forge it, so this stops drive-by browser abuse and casual copying of the URL, not a determined attacker holding the token. A holder could also try to LOCK the budget (not spend it) by requesting approvals for fake senders that are never executed: this is bounded by the reservation caps and per-IP rate limit (section 5, threat T18).
2. **The contract's own limits, independent of the service and of its signing key:** calls only to the project's on-chain allowlist; a **per-wallet daily limit** (`senderDailyLimit`, **required > 0 and enforced on-chain**: a project with no limit set reverts `ZeroDailyLimit` at validation, review 3 L-1; before the fix a freshly claimed project ran with 0 = off and one wallet could burn the whole `dailyLimit`), so one stranger wallet can consume at most that much per day; a project-wide `dailyLimit`; and the project balance. Anyone who steals a client token can therefore spend at most `dailyLimit` per day (and `senderDailyLimit` per wallet) on contracts the project itself allowlisted.
3. **Service-side:** per-user daily cap (default 200 PEPU), the option `requireIdentity` (only verified Privy users), rate limiting per token+IP on the RPC route, per IP on `POST /v2/sponsor` (before the body is read), per IP for unknown ERC-7677 tokens, and per IP on the client-token path, the client-token reservation caps, project suspension, and token/key rotation.
4. **The free tier is not a fallback for these wallets** (section 7): when the project is empty, non-Privy wallets are denied, never paid by the chain.

---

## 8. Invariants (tested)

- I1: `totalLiabilities == sum(sponsors[*].balance)` after any sequence of operations.
- I2: `totalLiabilities <= entryPoint.balanceOf(paymaster)` (the mock EntryPoint simulates real v0.7 prefund/refund accounting, including measured postOp gas **and the unused-gas penalty**).
- I3: A project's balance never underflows; validation reverts instead of going negative.
- I4: **No function of any role can move sponsor-ledger funds out of the EntryPoint deposit; the only outflow is gas settlement.** There is no withdrawal function (project or free pool) and the contract never calls `entryPoint.withdrawTo`. **Indirect extraction** (the hot role adds a signer and a bundler it controls, then submits ops with inflated gas so the EntryPoint pays the attacker as beneficiary) is bounded exactly as follows, and no more: (i) a signer or bundler ADDITION cannot take effect sooner than `adminChangeDelay` (immutable, constructor floor 48 h) after `AdminChangeProposed`, so a project that sees the proposal can **pause**, and tighten its fee cap and limits, before the change matters (pausing is instant and a paused project's ledger cannot be spent by any signer); (ii) the gas PRICE any sponsor can be charged per op is capped on-chain (`maxFeePerGas` cap); (iii) per-project `dailyLimit` and `senderDailyLimit` apply to every op. **Not covered:** a compromise of a signer and a bundler that were ALREADY authorised (it can burn each unpaused project's `dailyLimit` per day, with unbounded gas QUANTITIES at up to the fee cap, until the signer is removed, which is instant); projects that do not watch the proposal events and do not pause; a `dailyLimit` above the balance; and the free pool (chain money, which cannot pause its way out but is bounded by its pool balance and per-op cap).
- I5: The sum of ETH held by the EntryPoint is at least `sum(deposits)` (conservation of ETH in the mock).
- I6: The owner's (and manager's) balance only ever increases by its own stake returned through `withdrawStake`: no ledger, surplus, residue or donation can reach it **through the contract's own functions** (there is no free-pool withdrawal any more). This is a statement about direct calls: the owner or manager acting as a signer and bundler is the indirect path covered by I4, not by I6.
- I7: `surplus()` equals deposit minus the sum of balances, never negative.
- I8: Against the REAL EntryPoint v0.7 (vendored sources), the ledger charge is at least the EntryPoint's true debit for every op, including the slot-restoring op at the owner-lowerable overhead floor (`PepuSponsoredPaymasterV7.RealEntryPoint.t.sol`, fuzzed at 2,000 runs), and one sponsor's op never moves another sponsor's ledger.
- I10: **Outflow invariant (new).** `entryPoint.balanceOf(paymaster) + gas paid to the beneficiary == everything ever deposited` (the "`sum(ledgers) + surplus == deposit`" identity is true by construction of `surplus()` and is no longer asserted; delta review I-5), over random sequences of claims, re-claims, ownership transfers, deposits (to claimed and unclaimed projects and the free pool), donations, surplus credits, pausing, limit changes, stake add/unlock/withdraw, time warps, and single and bundled ops (`PepuSponsoredPaymasterV7.Invariant.t.sol`, `invariant_DepositOnlyLeavesAsGasPaidToBeneficiary`). Equivalently, sum of ledgers plus surplus only ever decreases via gas settlement.
- I9: After every settlement the project and per-sender day counters have moved by exactly what was charged, whatever mix of older and newer `validAfter` days the ops carried (fuzzed).

---

## 9. Project identity, claims and deposits

### 9.1 Deposits and claims (on-chain first; API optional)

1. **Anyone deposits** with `depositFor(projectId)` (`projectId = keccak256(bytes(appId))`; SDKs and UIs compute it from the Privy app id). It works whether or not the project has been claimed. The funds sit in that project's ledger and become spendable once the project is claimed and within the owner's settings. A depositor should read `getProject(projectId).projectOwner` first: it shows exactly whose settings will govern the money (`address(0)` = unclaimed).
2. **The app's developer claims it.** They sign in with SIWE (the API's existing login) and call `POST /v2/projects/verify { appId, appSecret, ownerAddress }`. The service checks the secret against Privy's REST API and returns an EIP-712 `ProjectClaim(string appId,address newOwner,uint256 nonce,uint256 deadline)` attestation signed by the policy signer (domain `PepuSponsoredPaymaster`/`1` with `chainId` and the paymaster address, so it is bound to this chain and this contract; single-use via `claimUsed`; expires at `deadline`, default 10 min, and the contract rejects a deadline more than 1 hour ahead). Anyone may then submit `claimProject(claim)`; the attestation fixes the owner. **A project with no deposited funds is claimed immediately. A project that already holds funds (ledger balance > 0, even 1 wei) is PENDING (review 3, M-1):** the claim records `pendingReclaim[projectId]` (new owner, `executableAt = now + adminChangeDelay`, attesting signer), emits `ProjectClaimProposed`, and anyone finishes it with `executeReclaim` after the delay (and within 30 days). It is bound to the attesting signer exactly like a re-claim (it dies if that signer was removed, and does not revive if the signer is re-added), a newer attested claim replaces it and restarts the delay, and the **contract owner or manager can cancel it** with `cancelReclaim`. Why: an unowned funded project has no owner who can pause it, so before this change a compromised manager could add a rogue signer and bundler, wait the 48 h, claim the project and drain it (audit B1: 85 of 100 PEPU in the PoC), with no defence at all after a renounce; now the same attack needs the contract owner or manager not to cancel inside a second window (it is still not recoverable after a renounce with a rogue manager, see section 16). Cost: anyone can force a claim to be pending by depositing 1 wei; the delay is a latency cost for the real team, not a loss. **The claim sets no configuration** (delta review L2): the attestation cannot bind settings a relayer could otherwise choose, so there are none to choose. The project starts with an empty allowlist and `dailyLimit == 0`, so nothing is sponsorable until the owner calls `setTargets`, `setDailyLimit` and `setSenderDailyLimit` (three further transactions, or one batched by the owner's wallet). A variant that binds a hash of the initial configuration into `ProjectClaim` was built and measured at 25,290 bytes (714 over EIP-170), so it did not fit. `POST /v2/projects/prepare {action:"claimProject", attestation}` encodes it.
3. **Re-claim (owner lost their wallet, or hands over by re-verifying).** For an owned project the same attestation goes to `reclaimProject(claim)`. It only takes effect after `adminChangeDelay` (>= 48 h) via `executeReclaim` (callable by anyone), emits `ProjectReclaimProposed`, can be cancelled by the *current* owner (`cancelReclaim`) **once per (project, newOwner) pair** (review 3, M-2: a second attested re-claim by the same `newOwner` reverts `ReclaimNotCancellable` when the owner tries to cancel it, and `acceptProjectOwnership` no longer clears it, so a hostile or compromised owner cannot veto recovery forever; the veto record is kept per project and cleared when the pair executes), expires 30 days after it becomes executable, is replaced (and the delay restarted) by a newer attested re-claim, and **dies if the attesting signer has been removed since it was proposed**: `removeSigner` records `signerRemovedAt`, and `executeReclaim` requires the proposal to be newer than that, so a removed-then-re-added signer does not revive old proposals (delta review L3). A voluntary handover to a multisig uses the two-step `proposeProjectOwner` / `acceptProjectOwnership` instead; executing a re-claim clears any pending voluntary transfer, and accepting a voluntary transfer clears any pending re-claim (L3) except one the owner has already vetoed once (M-2). An owner can withdraw a nomination with `proposeProjectOwner(projectId, address(0))` (B5). Residual (option (a) of the audit): the owner's single veto per new owner is not a defence against a compromised signer that attests the SAME new owner twice; the defences against that are `removeSigner` (instant, kills the pending re-claim) and pausing. Because ownership follows the Privy secret, a holder of the secret can replace a pending re-claim with their own: rotate the Privy secret after any recovery.
4. To have the policy service sign sponsorships for a claimed project, the owner calls `POST /v2/projects {projectId | appId}` (SIWE, `owner == session address`), which returns, **once**, the **server key**, the **client token** and the paymaster URL. This step is a convenience, not a gate on the contract. `POST /v2/projects/:id/token/rotate` and `/server-key/rotate` replace the credentials; `PATCH /v2/projects/:id/settings` sets `allowedOrigins`, the per-user cap and `requireIdentity`.
5. Allowlist and limits live on-chain (`setTargets`, `setDailyLimit`, `setSenderDailyLimit`); the API returns the current list (replayed from `TargetSet` events) and prepared transactions to change them.

**Secret handling.** The Privy app secret is used for exactly one outbound request (`GET https://api.privy.io/v1/users?limit=1`, HTTP Basic `appId:appSecret` plus the `privy-app-id` header; Privy documents no dedicated app-settings read for server credentials, so a one-row user list is the cheapest authenticated read: 200 = valid, 401/403 = invalid, anything else = Privy problem, never a verdict). It is never stored, logged or echoed: request bodies on that route get fixed error messages, upstream errors are discarded, and tests assert the secret is absent from every response, from console output and from the database. The endpoint is rate limited per IP and per app id. Developers who want to can rotate the secret in the Privy dashboard right after verifying.

### 9.2 Project identity: why `keccak256(appId)` with attested ownership

**The question.** With withdrawals gone, a project's money can only be spent on gas, but *who controls its settings* (target allowlist, limits, fee cap, codehash pin, pause) still decides **what its pooled deposits are spent on**. If anyone could claim the settings of "my Privy app", a squatter could point other people's deposits at their own contracts. The owner thinks of a project as "my Privy app".

**Options weighed.**

1. *Keep `keccak256(abi.encode(registrant, appId))`, namespaced by whoever registers* (the previous design). Squatting is impossible by construction and there is no gatekeeper. But there is no canonical project per Privy app: a depositor who wants to fund "app X" must know *which registrant's* X, a squatter's label-identical project looks the same, and the real team's project is only distinguishable by an owner address a stranger has no way to verify. With open deposits that makes accidental funding of the wrong project, and phishing of depositors, easy.
2. *Key by `keccak256(appId)` alone with first-come claiming.* Canonical, but the first claimer wins the settings of an app they do not control: exactly the squatter risk.
3. **`keccak256(appId)` with ownership proven by an attestation (chosen).** One canonical project per Privy app (what the owner expects and what depositors can compute themselves), and settings ownership requires a signature from the policy signer that checked the Privy app secret. A squatter without the secret cannot obtain an attestation, so cannot claim; they can still *deposit* into the project, which only helps the real team.

**Trust model (stated plainly).** The policy signer becomes the **ownership gatekeeper** for projects. Properties:

- A compromised or malicious signer can claim a *not-yet-claimed* project (immediately if it is empty, after the admin delay if it holds funds, M-1) or start a re-claim of an owned one, and thereby become the owner who sets the allowlist and limits of a project others fund. It can **never withdraw funds**: none can be withdrawn by anyone, and since the bundler gate cannot be disabled (M1) it cannot even be paid the gas itself unless its own address is an allowlisted bundler. What it can do with such a claim is bounded by the contract exactly as T1/T2: spending only on gas for ops whose targets it allowlisted, within the limits it set, at up to the fee cap, paid to allowlisted bundlers.
- **Credentials follow the on-chain owner (delta review L4).** A project's server key and client token are issued to the owner at issuance time. The engine compares the stored owner with the chain on every evaluation (the engine's normal cached read, `SPONSORSHIP_CHAIN_CACHE_TTL_MS`, default 2 s) and, if it changed (executed re-claim or voluntary transfer), revokes BOTH credentials, clears the previous owner's allowed origins and denies with `project_owner_changed`; the owner gate does the same on the new owner's first owner-route call. The new owner fetches fresh credentials from the rotate routes.
- Re-claims of owned projects are **visible** (`ProjectReclaimProposed`), **timelocked** (`adminChangeDelay` >= 48 h, immutable), **cancellable by the current owner**, and **void if the signer is removed** before they execute. The owner can also pause in the meantime. The residual exposure is therefore concentrated on **unclaimed EMPTY** projects (immediate claim, nothing to steal yet) and on funded unclaimed projects when nobody watches `ProjectClaimProposed`: depositors should prefer projects whose owner they have checked.
- The attestation is bound to chain and contract (EIP-712 domain), to one owner address, to one nonce (single-use) and to a deadline, so it cannot be redirected, replayed or reused on another deployment (all tested, including a signature produced by the service's own code path and accepted by the real contract: `PepuSponsoredHashCrossCheck.t.sol` and `projectVerify.test.ts` share a frozen vector).
- Signer rotation (`removeSigner`, instant) invalidates unredeemed attestations and pending re-claims signed by the removed key. Projects keep their ledger and owner.
- Developers who distrust handing over the Privy secret can still use the system without claiming (the free tier and other projects keep working), and may rotate the secret after verification.

**Making it visible to depositors.** `getProject(projectId)` returns the current owner; `ProjectClaimed(projectId, owner, appId)` records the app id label; `GET /v2/projects/...` and the docs tell depositors to check the owner (and that an unclaimed project's money is not spendable until claimed).

**Two-step handover.** Teams that want a multisig as owner use `proposeProjectOwner` / `acceptProjectOwnership` (already present), or claim directly with the multisig address as `ownerAddress` (a Safe can sign the SIWE login through ERC-1271).

### 9.4 Stranded funds (trade-off and an open item)

With no withdrawals, a project's balance can never leave. If a project is **abandoned** (its team disappears, loses the key and never re-claims, or an id nobody can claim was funded by mistake), the money stays in its ledger forever, still safe (it can only pay gas for that project's allowed ops) but useless. The same holds for dust left in a project that is no longer used. This is the accepted price of the owner's decision ("anyone can deposit, no one withdraws"), and **no escape hatch has been added**. An optional future design for the owner to decide (open item OQ15): a permissionless `donateDormantToFreePool(projectId)` that, after N months of no spending (a `lastActive` timestamp updated in validation), moves the balance into the free pool ledger (so it still only pays gas, for everyone). It keeps funds inside the contract, needs one extra storage field and a size refactor (the contract has about 100 bytes of headroom), and changes the promise to depositors from "your money pays for this project's gas, forever" to "... or for the free pool if the project goes dormant".

### 9.3 Spend history

`GET /v2/projects/:id/usage` merges the audit/usage DB (who, which sender, reserved vs final) with on-chain `UserOpSettled`/`Deposited` logs (`/events`).

---

## 10. API (policy service, `/v2`)

Full contract: `policy-service/openapi.yaml`. Summary:

| Group | Auth | Endpoints |
|---|---|---|
| Public | none | `GET /v2/config`, `GET /v2/contract` (address + ABI), `GET /v2/free-tier` |
| Auth | none -> session | `GET /v2/auth/nonce`, `POST /v2/auth/login` (SIWE), `POST /v2/auth/logout`, `GET /v2/me` |
| Verify | SIWE session; `ownerAddress` must equal the session address; rate limited per IP and app id | `POST /v2/projects/verify` (Privy app id + secret -> signed claim attestation) |
| Owner | `Authorization: Bearer <session>`; session address must equal the **on-chain owner** | `POST /v2/projects`, `GET /v2/projects`, `GET /v2/projects/:id`, `POST /v2/projects/prepare`, `POST /v2/projects/:id/token/rotate`, `POST /v2/projects/:id/server-key/rotate`, `PATCH /v2/projects/:id/settings`, `GET /v2/projects/:id/usage`, `GET /v2/projects/:id/events`, `GET /v2/projects/:id/allowlist` |
| Admin | `X-Admin-Token` = `SPONSORSHIP_ADMIN_TOKEN` (separate from v1 `ADMIN_TOKEN`; disabled if unset) | `GET /v2/admin/overview`, `GET /v2/admin/projects`, `POST /v2/admin/apps` (free-tier-only app), `POST /v2/admin/projects/:id/status`, `POST /v2/admin/projects/:id/token/rotate`, `POST /v2/admin/projects/:id/server-key/rotate`, `POST /v2/admin/reconcile` |
| Sponsorship | server key, or client token from an allowed Origin; Privy token for the free tier | `POST /v2/sponsor`, `POST /v2/paymaster/:token` (ERC-7677), `OPTIONS` |

**Authentication.** SIWE (EIP-4361) via viem: server nonce (single use, 5 min), domain must be in `SIWE_DOMAINS`, `chainId` must match, `expirationTime` required and <= 10 min, `issuedAt` within skew, signature verified (EOA, or ERC-1271 for Safe owners through the chain RPC). Result: an opaque 32-byte session token (stored hashed), 1 h TTL, bound to the address. Ownership is re-checked against the chain on every owner call, so an ownership transfer takes effect immediately.

**No unauthenticated writes.** Every `POST/PATCH` except `/v2/auth/login`, `/v2/sponsor`, `/v2/paymaster/*` requires a session or admin token (`/v2/projects/verify` requires a session). Those three authenticate by signature/credential themselves.

**Rate limiting** (in-memory sliding window, single process): per IP on nonce/login (strict), per address on owner endpoints, per IP on admin endpoints (brute-force guard), per token+IP on the paymaster RPC. `POST /v2/projects/verify` has a per-IP limit (charged on every request) and a failure budget keyed on **(appId, SIWE address)** and charged only after Privy rejects the credentials, so one account cannot spend another account's budget for the same app id (delta review L1) while guessing stays bounded per account and per IP. `TRUST_PROXY=true` is required to honour `X-Forwarded-For`; the client IP is then the entry `TRUSTED_PROXY_HOPS` (default 1) from the RIGHT, never the client-controlled leftmost entry. Privy app ids are used **exactly as given** (case-sensitive, never lower-cased): they are lower-case alphanumeric cuids, `projectId = keccak256(bytes(appId))` is case-sensitive, and the service regex accepts `[A-Za-z0-9_-]`; SDKs and UIs must pass the id verbatim from the Privy dashboard.

**Deposits are never proxied, and there are no withdrawals.** The API returns contract address, ABI, state, and optionally encoded calldata (`prepare`) that the wallet signs and sends itself.

**CORS.** Owner/admin/auth endpoints send `Access-Control-Allow-Origin` only for origins in `SPONSORSHIP_API_ALLOWED_ORIGINS` (default none). The ERC-7677 route keeps v1's behaviour; the **project** origin binding is a separate, per-project check made by the engine.

---

## 11. Threat model

Assets: (A1) project balances; (A2) the free pool; (A3) unattributable surplus; (A4) the signer key's authority; (A5) availability of sponsorship.

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | Signer key compromised | On-chain: signer can only charge **claimed** sponsors, only for ops whose Kernel targets are on that sponsor's on-chain allowlist, only within the project's `dailyLimit`/`senderDailyLimit`, the free pool's `maxOpCost`/`senderDailyLimit`, and only if tx.origin is an allowlisted bundler: the gate is unconditional and the mode byte must be exactly 0x02, so no signed field can switch it off (delta review M1; before the fix, mode 0x03 let a signer self-bundle and be paid from unclaimed deposits, the free pool and any project). The gas is paid to the allowlisted bundler, not to the signer. Revocation: `removeSigner` (instant). Project defence: **pause** (instant) and tighter limits, since nothing can be withdrawn. A compromised **hot manager** can no longer make itself a signer and bundler quickly: additions wait `adminChangeDelay` >= 48 h (T3), and a signer can also claim unclaimed projects (T21). The gas price is capped on-chain. | Loss per project per day <= its `dailyLimit` until the signer is removed (an already-authorised signer plus an already-authorised bundler can use unbounded gas quantities at up to the fee cap). **The free pool has no daily ceiling**, so the signer's worst case there is the pool balance (it can invent wallets to dodge the per-wallet limit): fund the pool in tranches. Rotation after a renounce depends on the manager (4.8). |
| T2 | Signer redirects charge to a project that did not authorise the app | Targets are decoded on-chain from signed callData and must be on the project's own allowlist; `sponsorId` is inside the signed hash | A compromised signer can still spam ops to that project's *own* allowed contracts (bounded by its limits) |
| T3 | Owner or manager steals project funds or takes surplus | **Directly:** no owner/manager function touches a project's balance or owner, and **no function of any role withdraws ledger funds at all** (project, free pool or surplus: none exist; the contract never calls `entryPoint.withdrawTo`); `adminChangeDelay` immutable; no upgradeability. **Indirectly (add self as signer and bundler, submit inflated-gas ops):** additions are timelocked by `adminChangeDelay` (immutable, constructor-enforced >= 48 h) so projects watching `AdminChangeProposed` can **pause** (instant) and tighten their fee cap and limits first, removals are instant, the owner can veto a manager's proposal, and the gas price per op is capped on-chain. The deploy script separates owner and manager and refuses to broadcast with one key holding both. I4/I6 tested (`Governance.t.sol`: the rogue-manager test shows the project pausing in time and the rogue signer then being unable to spend). | A project that does not watch the proposal events and does not pause can lose up to its `dailyLimit` per day after the delay (and its whole balance if the limit exceeds it); an already-authorised signer + bundler pair can burn daily limits (T1). The free pool has no pause-by-owner defence beyond `pauseFreePool` and its balance bound. The owner still controls the manager, free-tier parameters and can lower overhead (never raise it above the deployed value). |
| T4 | Project grief (change settings after approval to hurt the paymaster/EP deposit) | Funds are deducted at *validation*, not at signing; there is no withdrawal to race; in-flight `maxCost` is already out of the ledger | A pause or limit change during the 60 s signature window can make a signed op fail validation: the user retries |
| T5 | Insolvency from accounting error | `charge >= finalCost` by construction: overhead >= measured postOp gas, plus the **worst-case EntryPoint unused-gas penalty**, prepay-refund (failure = overcharge), `postOp` cannot revert, invariants fuzzed with a penalty-aware EntryPoint mock AND the solvency fuzz repeated against the **real vendored EntryPoint v0.7** at the overhead floor | `postOpOverheadGas` is bounded below on-chain (18,000) and above by the deployed value; the vendored EntryPoint is not the chain's deployed bytecode or gas schedule (fork test open) |
| T6 | Reentrancy | CEI + `nonReentrant` on every deposit; the only EntryPoint calls are `depositTo` and the owner/manager stake calls; validate/postOp make none; tested with a malicious owner contract receiving a stake payout | None known |
| T7 | Free-tier sybil | Section 7 (Privy accounts only, per-user caps, per-wallet limit, per-op cap) | R2: N accounts -> N x 50/day; bounded by the pool balance (no ceiling) |
| T8 | Leaked project credential | Server key is secret and rotatable; the client token is origin-bound; both are bounded by the contract's allowlist, per-wallet limit (**required and enforced on-chain for projects**, L-1) and daily limits, and the per-user cap | Anyone holding a leaked client token can spend up to the project's own limits from a forged Origin; rotate it. Griefing by reserving the budget without spending: see T18 |
| T9 | SIWE replay/phishing | Single-use nonce, domain binding, chain id, short expiry, session TTL, on-chain owner re-check | Phishing of the wallet signature of a login message gives a session, **not** fund access (funds only move via on-chain owner txs); it could mint/rotate credentials |
| T10 | Project owner key compromised | Two-step project ownership transfer; the attacker can only re-point the project's *gas spending* (allowlist, limits, pause), never withdraw (nothing can be); the real team can re-claim through a fresh Privy attestation (timelocked 48 h, visible). The compromised owner can veto that re-claim only ONCE per new owner (M-2); the second attested re-claim by the same new owner cannot be cancelled and survives `acceptProjectOwnership` | Attacker with the owner key controls that project's settings until a re-claim completes (about two delays); there is no guardian (OQ6) |
| T11 | Decoder differential (our Kernel decode vs Kernel's own); **fake-Kernel accounts** | Same semantics as v1's decoder; unsupported modes revert; callData self-calls denied unless allowlisted. Optional per-project **account pin** (`setRequiredAccountCodehash`): only senders with that runtime codehash are sponsored | A malformed-but-accepted encoding that Kernel decodes differently is theoretically possible; recommend differential fuzzing against Kernel's `ExecLib` before mainnet. **Without a pin**, any contract implementing the Kernel selector with different semantics passes the allowlist: treat the allowlist as a usage policy, bounded in cost by balance, limits and fee cap (L-2). The pin trusts the account code, including any upgrade path it has |
| T12 | DoS of sponsorship (RPC down, pool drained) | Project path is independent of the free pool; chain read failure fails closed | Free pool can be exhausted by many accounts (no ceiling); chain RPC outage halts v2 signing |
| T13 | Squatting an app id / hijacking the settings of a project others fund | Settings ownership needs a signer attestation backed by the Privy app secret (9.2); the first claim of an empty project is immediate but only for the verified owner; the first claim of a FUNDED project and every re-claim are timelocked, visible, cancellable (M-1), signer-bound, and expire after 30 days | Depends on the signer being honest (T21); depositors to an unclaimed project accept that its owner is not yet known |
| T21 | Signer is the ownership gatekeeper and is compromised | Can claim unclaimed projects and start re-claims; cannot withdraw (none exists); a claim of a FUNDED project and every re-claim are timelocked (>= 48 h), visible (`ProjectClaimProposed` / `ProjectReclaimProposed`), cancellable (owner or manager for an unowned project; the project owner, once per new owner, for an owned one), void on `removeSigner`; attestations are chain+contract bound, single-use, short-lived; secret never stored/logged; a sponsor cap cannot be raised above the immutable default | A compromised signer can immediately take an EMPTY unclaimed project, and a funded one if nobody cancels or removes it within the delay. After a renounce with a rogue manager there is no canceller (section 16). Claim promptly after funding, and treat signer custody as critical |
| T22 | Stranded funds (abandoned or unclaimable project) | Money can only pay gas, never leaves, never reaches anyone | Locked forever; optional dormant-balance design is open (9.4, OQ15) |
| T14 | Dishonest `validAfter` to reset day counters | Forward-only day index; EntryPoint enforces `validAfter <= now` at inclusion; reservations are released from the bucket they landed in (L-1 fix, fuzzed) | None |
| T15 | Project over-charged by overhead/penalty bounds | Bounded overhead; worst-case penalty is a few percent; residue goes to the free pool, never to an account | Projects pay slightly more than actual gas (disclose); an orphaned prepay after a postOp revert is not refunded on-chain (4.5) |
| T16 | Contract bug | Foundry unit/fuzz/invariant tests, minimal surface, OZ primitives | **No external audit has been done.** Do not deposit large amounts before one |
| T18 | **Reservation griefing**: a holder of the public client token requests approvals for fake senders and never executes them, locking honest users out of a project's budget | Client-token reservations capped per wallet (2), per IP (5% of budget, min 2 ops) and in total (25%); per-IP rate limit; reservations expire with the 60 s signature; same (sender, nonce) replaces; the server key is exempt; the on-chain limits are unchanged | An attacker with many source addresses can hold up to 25% of the budget (and the client-token pool) continuously; honest users arriving from fresh addresses are denied only while that pool is saturated; the server-key path is unaffected. Rotate the token to cut the attacker off |
| T19 | Signer approves user-inflated gas fields | Service bounds each gas field and fee against limits and the live base fee (6.1 step 2b); the contract caps `maxFeePerGas` per sponsor on-chain | Gas QUANTITIES within the service bounds are still approved; on-chain only the price is capped |
| T20 | `tx.origin` bundler gate is banned by ERC-7562 | Documented (4.4 step 2): supported only behind a self-run bundler with the opcode ban off; additions to the bundler list are timelocked | A conformant public bundler cannot be used; third-party bundlers see ops that simulate but revert at inclusion. The gate is unconditional (no mode bit disables it), so the bundler allowlist and its 48h+ timelock bind a compromised signer too (delta M1) |
| T17 | Renounce footguns | 4.8 documents each consequence; two-step transfer for hand-over; `setManager(0)` + renounce is the explicit total freeze | Renouncing while the free tier is disabled bricks it; renouncing with a bad manager leaves a permanent bad manager |

### Top residual risks

1. **No audit** of an immutable contract that holds third-party money (T16), and **no fork test against the real EntryPoint yet** (13a).
2. **Free-tier sybil with no ceiling** is mitigated, not eliminated (R2); loss bounded by the pool balance.
3. **Hot signer key**: loss bounded per project/day by on-chain limits, and for the free pool by its balance; monitoring is operational.
4. Reliance on the **bundler allowlist + ORIGIN** semantics (works with Alto safe-mode off; breaks if a bundler enforces ERC-7562 opcode bans). Documented, not removed (T20).
5. Kernel-only destination decoding (a different account type needs a new contract version), and the allowlist is a usage policy unless a project pins the account codehash (T11).
6. **Contract size:** the runtime is 23,722 bytes against the 24,576-byte EIP-170 limit (854 bytes of margin) **only because `PepuSponsoredPaymasterV7` is compiled with 8,000 optimizer runs** (25,115 bytes at 1,000,000). Any further contract change needs a size check; the contingency is a project-ownership registry contract (section 16).
7. **The signer is the ownership gatekeeper (T21)** and **funds can be stranded (T22)**; both are consequences of the deposit-only decision and are documented, not removed.

---

## 12. Migration from the current paymaster

1. **Nothing changes in v1.** Contract `0x2B6F...8B0` and the service on 8788 keep their config, DB and routes.
2. Review and broadcast `contracts/deploy-sponsored-paymaster.sh` (dry-run by default, section 13). It deploys v2 (never reuses `deployed-address.txt`), the **deployer is the owner** (optional `PAYMASTER_OWNER_ADDRESS` override), optionally stakes, sets the free tier (the initial signer and bundler list are constructor arguments, effective immediately), and writes `deployed-address-v2.txt`. Use a **separate manager address** (`PAYMASTER_MANAGER_ADDRESS`).
3. Fund the free pool (`fundFreePool`); e.g. withdraw from the v1 deposit with the v1 owner `withdrawTo`, keeping v1's float for the demo. With no ceiling, fund it in tranches.
4. Register the chain's own demo app as a project (or admin free-tier app) and add its destinations to the free list.
5. Start the service with `SPONSORSHIP_V2_ENABLED=true` and the v2 env (restart is a deliberate step, outside this change). `/v2/*` is then live next to v1.
6. Validate end-to-end on a canary (Alto against the new paymaster: `ORIGIN`/storage behaviour, post-op gas, settlement events), after the fork test in 13a.
7. Switch Privy's dashboard Paymaster URL to `https://<host>/v2/paymaster/<token>`. v1 stays as a rollback (change the URL back). Free-tier requests must also carry `context.privyAccessToken`.
8. Once v2 is proven, drain v1's deposit to the v2 free pool and retire v1.

---

## 13. Deploy script

`contracts/deploy-sponsored-paymaster.sh` (run from WSL). No arguments = **plan only**: rebuilds with `forge build --force`, compares the creation-bytecode hash to a pinned constant, prints deployer/owner/manager/signer/limits, checks the RPC and whether `deployed-address-v2.txt` already points at live code, then exits. `--broadcast` is the only way to send transactions. The script **warns loudly if manager == owner** (and when that address is also the deployer) and **refuses to broadcast** in that case unless `ALLOW_SINGLE_KEY_ROLES=1`. Constructor arguments: signer, bundler list, admin change delay (default and floor 48 h), postOp overhead (default 20,000), default max fee per gas (`DEFAULT_MAX_FEE_PER_GAS_GWEI`, default 40,000). The pinned creation hash (`0x86153ab5c7faa3a83ea9949b2a44ebba196ce367227d376b9a28290e3a468164`) covers the 8,000-run build of the sponsored contract and only reproduces from LF-line-ending sources; the root `.gitattributes` (`* text=auto eol=lf`) now enforces that on every checkout, regardless of `core.autocrlf`. **The deployer is the owner by default**; `PAYMASTER_OWNER_ADDRESS` is an optional manual override and is **not** required to broadcast. Post-deploy configuration runs only for roles the deployer holds; otherwise the exact `cast send` commands are printed. After broadcasting, the script prints the `transferOwnership` / `setManager(0)` / `renounceOwnership` commands for later hand-over or freezing (section 4.8).

---

## 13a. Pre-deploy checklist

- [x] Solvency, postOp gas and day-bucket tests also run against the **real EntryPoint v0.7 sources** (`contracts/test/PepuSponsoredPaymasterV7.RealEntryPoint.t.sol`: the vendored `EntryPoint.sol`, a Kernel-shaped account, the real paymaster), in addition to the mock-EntryPoint suites. Done in the internal review follow-up.
- [ ] **Fork test against the ACTUAL PEPU chain's EntryPoint v0.7 and gas schedule (Arbitrum Nitro, ArbOS 51) is still required before deploy.** The harness above uses the vendored sources on a local EVM (london), not the deployed bytecode or Nitro's gas accounting; re-measure postOp gas there and confirm the 18,000 floor still holds (13,918 measured cold on the vendored sources; 4,082 gas of margin).
- [ ] **External audit is still outstanding.** `audits/2026-10-internal-review.md` is an INTERNAL AI-assisted review (pashov methodology), not an audit. Do not deposit large amounts before an external audit.
- [ ] Canary on the production Alto config (OQ8): `ORIGIN` gate, estimation with `address(0)`, storage and `EXTCODEHASH` access, settlement events.
- [ ] Deploy from a checkout with LF sources (enforced by `.gitattributes`; re-checkout if the hash mismatches) so the pinned creation hash reproduces; use a separate manager address.

## 14. Decisions

### Resolved

- **D1 Free tier numbers.** **50 PEPU per user per day**, 40 PEPU max per op. The **chain-wide daily ceiling on the free pool is removed entirely** (contract, service, config, spec, docs, tests). Rationale: funds can only pay gas, and a cap that limits the whole chain to about 20 maximum-usage users is worse than the risk. Per-user limits, the per-op cap and the delay are unchanged; an on-chain per-wallet backstop is kept.
- **D2 Deposits and claims (superseded by D15 to D17).** Deposits are direct, open contract calls with no registrar, approval or minimum, **and one-way**. Project settings ownership is claimed on-chain with a signer attestation (9.2). The SIWE `/v2` API is a convenience layer and is not required for deposits.
- **D3 Ownership.** The **deployer is the owner by default**; `PAYMASTER_OWNER_ADDRESS` is an optional override and not required to broadcast. `Ownable2Step` (`transferOwnership` + `acceptOwnership`) plus `renounceOwnership`. The precise consequences of a renounce are in 4.8; nothing projects need depends on the owner.
- **D4 Who can be sponsored.** The **chain free tier is only for users with a Privy account** (a verified Privy access token is required; anonymous tier removed). **Project budgets may sponsor any wallet**, including non-Privy users and native/EOA wallets via smart accounts, and the free tier never pays for them. Project-sponsored requests are authorized by a project-issued server key (backend) or an origin-bound client token, plus the on-chain allowlist and per-wallet daily limit (7a).
- **D5 Surplus.** Whoever paid is entitled to it: every unused prepay is refunded in `postOp` to the exact sponsor that was charged (project or free pool). The owner sweep is removed. The unattributable residue (the gap between the overhead and worst-case-penalty gas charged and the real post-op cost, plus donations) can only be credited to the free pool. `postOpOverheadGas` is tightened (20,000 deployed, 18,000 floor, above the real-EntryPoint worst case; see section 15) and the owner can only lower it.
- **D6 Anonymous tier** (was OQ5): removed.
- **D7 Admin custody** (was OQ3): the deployer is the owner; hand over or freeze later with the two-step transfer / renounce (4.8).
- **D8 Surplus policy** (was OQ7): see D5.

- **D9 Admin timelock (internal review M-2), restated by D17.** Signer and bundler ADDITIONS take effect `adminChangeDelay` (immutable, constructor floor 48 h) after the proposal so projects can pause first; removals stay instant; the manager role is separate from the owner at deploy. Chosen over making the manager unable to add signers, because key rotation is a routine operation that must not need the owner key.
- **D10 On-chain fee cap (M-2b / L-4).** Every sponsor has a cap on an op's `maxFeePerGas` (immutable default, project override, owner-set for the free pool). Gas QUANTITIES are not capped on-chain (the contract size budget and the variety of legitimate ops make a per-op cost cap unsafe to hard-code); they are bounded by the service (6.1) and by the daily limits.
- **D11 Account pin (L-2).** An optional per-project codehash pin instead of a chain-wide factory allowlist; the free tier has none (Privy sender ownership covers it).
- **D12 Bundler gate kept (L-3), unconditional (delta M1).** The `tx.origin` gate is kept and documented as unsupported by conformant bundlers, because it is the only on-chain restriction on who can be paid. It is the ONLY on-chain restriction on who can be paid and it cannot be disabled by any signed field: `paymasterAndData` mode byte must be exactly 0x02, and the allowAllBundlers bit of the v1 layout is rejected.
- **D13 Reservation caps (M-1).** Client-token reservations are capped per wallet, per IP and in total; the server key is exempt; the on-chain limits are the backstop. Not eliminated: a many-address attacker can hold the client-token pool.
- **D14 postOp floor 18,000 (L-5)** and 60 s approval window with 5 s `validAfter` skew.
- **D15 Deposits are one-way (owner decision).** "Anyone can create a Privy app id and deposit funds for gas. So remove the withdraw option. Even if someone else creates the deposit for my Privy app, it doesn't harm me or my users. Let anyone deposit and no one withdraw." All withdrawal paths are removed: project withdrawals, the withdraw delay, and the owner's free-pool withdrawal. No code path moves ledger funds out of the EntryPoint deposit except gas settlement; only stake (a separate balance) can leave. An invariant test pins this (I10).
- **D16 Project identity and ownership.** `projectId = keccak256(bytes(appId))`, one canonical project per Privy app; `depositFor(projectId)` is open to anyone even before a claim; settings ownership requires an on-chain claim backed by an EIP-712 attestation from a signer that verified the Privy app secret; the first claim is immediate, a re-claim of an owned project is timelocked (`adminChangeDelay`), visible, cancellable by the current owner and void if the signer is removed; the two-step voluntary transfer is kept. Chosen over the registrant-namespaced id (9.2). The policy service exposes `POST /v2/projects/verify` and never stores, logs or echoes the secret.
- **D17 Governance timelock restated.** Projects cannot exit, so the defence against a rogue signer or bundler is **pause** (plus tighter fee cap and limits), all instant, inside a fixed immutable timelock of at least 48 h (constructor-enforced; deploy default 48 h). The timelock no longer derives from a withdrawal delay.
- **D18 Stranded funds accepted, no escape hatch.** See 9.4 and OQ15.
- **D19 First claim of a funded project is pending (review 3, M-1).** A claim of a project with ledger balance > 0 is pending for `adminChangeDelay`, signer-bound, announced by `ProjectClaimProposed` and cancellable by the contract owner or manager. An empty project is still claimed immediately (nothing to protect, and the real team's first claim stays one transaction). Sponsor fee caps can only tighten the immutable default.
- **D20 One veto per (project, newOwner) (review 3, M-2).** Option (a) of the audit: the project owner can cancel a re-claim once; the same new owner's second attested re-claim is final. Chosen over a guardian (adds a trust point, OQ6) and over a cancel-window cut (does not stop a determined owner).
- **D21 Projects fail closed without a per-wallet limit (review 3, L-1)**; **`addStake` is owner-only with a 30-day cap (L-2)**; **`address(0)` may be a bundler (L-3)**; **pending claims, re-claims and admin additions expire 30 days after they become executable, and a nomination can be unset (B5)**; **`postOp` charges a validation-time snapshot (L-6)**.
- **D22 The sponsored contract uses 8,000 optimizer runs (review 3).** The levers were applied in order: the L-6 snapshot (+98 bytes net with L-1), code tightening (-170), then lower optimizer runs (-1,752 against the 25,474 of the fixed source at 1,000,000 runs). A separate project-ownership registry was NOT needed. The cost is +156 gas on validation (+0.2%) and +75 on the worst-case postOp (+0.5%). Only `PepuSponsoredPaymasterV7` gets the lower runs (`compilation_restrictions` in `foundry.toml`); the deployed v1 contract's creation hash is unchanged.

### Still open

- **Audit and fork test.** An external audit (who, and what deposit cap applies until then) and a fork test against the ACTUAL PEPU chain's EntryPoint v0.7 (13a; the vendored-source harness is done) are required before any deployment.
- **OQ14 Contract size margin:** 854 bytes under EIP-170 at 8,000 optimizer runs. A future feature needs a refactor or a library split; the prepared contingency is a `PepuProjectRegistry` that owns claim, reclaim, transfer, nominee and veto state and that the paymaster consults for `owner(projectId)` (not sized). It was not needed for review 3.
- **OQ4 Third-party Privy apps:** a token from a Privy app whose secret we do not hold cannot be verified, so those users can only be sponsored by a project (no free tier). Decide whether to support multiple Privy apps by holding additional app credentials.
- **OQ6 Project key loss/compromise:** the recovery path is an attested re-claim (timelocked 48 h, 9.1). Is a guardian address (can cancel a pending re-claim, or pause) also wanted? Adds a trust point.
- **OQ15 Dormant balances (owner decision needed):** do nothing (funds of abandoned projects stay locked), or add a permissionless `donateDormantToFreePool(projectId)` after N months of inactivity (9.4). Needs a size refactor and changes the depositor promise.
- **OQ16 Signer custody for ownership claims:** the signing key gates project ownership as well as sponsorship. The claim attestor and the sponsorship signer share ONE signer set (`signers`): a second entry in `signers` does NOT narrow its power, because every signer can both approve ops and attest claims (delta review I-2). A dedicated claim key needs a separate role: a `claimSigners` mapping checked in `_verifyClaim`, a third `kind` in `proposeAdminChange`/`executeAdminChange` (timelocked) and its own removal function and events; estimated at 400 to 600 bytes of runtime code. That would now fit in the 854 bytes left under EIP-170 (8,000 optimizer runs), but it is a separate design decision and is not implemented. Unclaimed-project claims are now timelocked when the project holds funds (D19); an empty project is still claimed immediately.
- **OQ17 Delta review:** done internally on 2026-10-02 (`audits/2026-10-delta-review.md`): 1 Medium and 4 Low, all fixed, plus the cheap leads; no external audit has been done.
- **OQ8 Bundler conformance:** confirm on a canary that the new validation (own-storage and sender-associated writes, `tx.origin` gate) is accepted by the production Alto config; should the paymaster stay staked (v1 has 100 PEPU / 86400 s)?
- **OQ10 Account types:** only Kernel v3 `execute` is decoded. Other accounts or `executeUserOp` require a contract revision. Pinning the account codehash (D11) is opt-in.
- **OQ11 Funding asset:** is paying gas in native PEPU the only funding asset? Any plan for stablecoin deposits?
- **OQ12 Orphaned prepay:** whether to add an on-chain claim for the rare postOp-revert case (4.5), at the cost of validation gas or signer trust.
- **OQ13 Free-pool funding policy:** with no ceiling, how large is each tranche and who tops it up? (Operational; the contract has no opinion.)

---

## 15. Implementation notes (as built)

- **Measured gas, real EntryPoint v0.7** (vendored sources, london EVM, sponsored contract at 8,000 optimizer runs, EntryPoint at 1,000,000; the vendored EntryPoint is instrumented ONLY to emit `preGas - gasleft()` around the `postOp` call, i.e. gas as the EntryPoint attributes it, dispatch included; contract state written in `setUp`, so the test transaction starts COLD, review 3 L-6): `postOp` honest op **8,317**; op that restores the sponsor's `balance` and `totalLiabilities` slots from its own execution and changes `senderDailyLimit` (the worst case an attacker can force) **13,918** (13,843 at 1,000,000 runs; the auditor measured 16.2k to 18.1k for the code before the snapshot). `validatePaymasterUserOp` for a first project op from a cold sender: **72,393** (72,237 at 1,000,000 runs). The earlier 9,101 / 12,701 / 64,393 / 69,407 figures were callee-gas trace readings with a warmed overhead slot and are superseded. `claimProject` costs about 154k to 178k gas depending on the allowlist size. The earlier isolated-cold-storage figures (85k to 99k validation, 12.7k postOp "including a 3k dispatch allowance") came from the mock and are superseded. Contract constants: `MIN_POSTOP_OVERHEAD_GAS = 18,000`, `HARD_MAX_POSTOP_OVERHEAD_GAS = 30,000`, deployed default 20,000 (also the owner's ceiling); `MIN_POSTOP_GAS_LIMIT = 40,000`; `SURPLUS_RESERVE = 1 PEPU`. Service defaults: `paymasterVerificationGasLimit 200,000`, `paymasterPostOpGasLimit 40,000` (the contract minimum; a larger value only adds unused-gas penalty). These are measurements on a local EVM, not on the PEPU chain (13a).
- **Tests:** 195 Foundry tests pass (18 v1 + 177 for v2: 105 unit/fuzz on the mock EntryPoint, 20 on the REAL EntryPoint v0.7 harness (incl. the delta-review regressions M1, L2, L3, the review-3 L-1 and L-6 regressions, deadline and delay caps), 22 governance/timelock/fee-cap/signature/day-bucket tests, 19 review-3 regressions (`PepuSponsoredPaymasterV7.Review3.t.sol`: audit B's PoCs for M-1, M-2, L-2, L-3 and B5 on the real EntryPoint, now failing as attacks), 3 reentrancy, 6 invariant incl. a non-vacuity guard, the deposit-outflow invariant and an owner-receives-only-its-stake invariant, 2 cross-language vectors: the hash vector and the claim-attestation vector), also at 2,000 fuzz runs. Claim coverage includes replay, expiry, wrong chain, wrong paymaster, tampered fields, non-signer and removed-signer signatures, malformed signatures, unclaimed-project deposits that cannot be spent, re-claim timelock/cancel/replace/signer-removed, and a bytecode scan proving `entryPoint.withdrawTo` is never called. Mutations are caught: dropping the postOp overhead, and dropping the unused-gas-penalty term, each fail the fuzz and invariant suites. Policy service: 328 tests (v1 untouched plus the v2 suites, including the verify endpoint, its secret-redaction and rate-limit tests, 18 reservation-cap and gas-bound regression tests, and the review-3 regressions: audit C's PoCs for L-4 (1 and 1b), M-3 (2), L-5 (3) and C-L1 (4) in `test/sponsorship/review3.test.ts` and `api.test.ts`).
- **Identity coverage:** identity can only be verified for Privy apps whose credentials the process holds (`PRIVY_APP_ID`). Free-tier-only apps whose label is another Privy app are never identity-verified (free tier denied); for admin-created free-tier-only apps use the real Privy app id as the `label` so identity resolves.
- **`requireSenderOwnership`** (default true, `SPONSORSHIP_V2_REQUIRE_SENDER_OWNERSHIP`) makes a Privy token user prove they own `sender` (Smart Wallets must link the wallet). Set false if Privy does not link the smart wallets (then the token alone keys the budget).
- **Separate database:** `data/sponsorship.db` (`SPONSORSHIP_V2_DB_PATH`); v1's `policy.db` is never opened by v2. A database from before server keys/origins existed is migrated in place.
- **Event matching:** approvals are stored with the EntryPoint userOpHash computed from the final `paymasterAndData` (signature included); `SponsorReserved`/`UserOpSettled` carry the same hash. Set `SPONSORSHIP_V2_DEPLOY_BLOCK` so the reconciler and log queries do not scan from genesis.
- **Not verified on the PEPU chain or the production bundler:** the contract tests use the mock simulator and the vendored EntryPoint v0.7 sources on a local EVM, not the deployed EntryPoint, Nitro's gas schedule, or Alto. Run the fork test (13a) and OQ8 on a canary before pointing Privy at v2.
- **Line endings:** the pinned creation hash covers the source text (solc metadata), so it reproduces only from LF sources, now enforced by the root `.gitattributes`. Contract size: 23,722 bytes runtime (854 bytes under EIP-170) at 8,000 optimizer runs for this contract only. The pinned creation hash is `0x86153ab5c7faa3a83ea9949b2a44ebba196ce367227d376b9a28290e3a468164`, verified from a `git archive` extraction.
- **Signing-window caveat:** the on-chain limits and the service's `outstanding` accounting both count the full `maxCost` while an approval is live, so a tight limit can show `project_daily_limit_reached` or `*_sender_limit_reached` earlier than actual spend suggests.

---

## 16. Internal review #3 (2026-10): fixes, size levers, and what is documented but not fixed

Report: `audits/2026-10-review-3.md` (fix-status table with the test for each finding). Three auditors ran in parallel against the real vendored EntryPoint v0.7; none could move ledger funds, forge or replay a signature, bypass the on-chain limits, or regress an earlier fix. 0 Critical, 0 High, 3 Medium, 6 Low.

### 16.1 Fixed

| Id | Fix | Where |
|---|---|---|
| M-1 | First claim of a project with ledger balance > 0 is pending for `adminChangeDelay`, signer-bound, cancellable by the contract owner or manager; an empty project is still claimed immediately; sponsor fee caps cannot exceed `defaultMaxFeePerGas` | 4.1, 9.1, D19 |
| M-2 | One veto per (project, newOwner): the second attested re-claim by the same new owner cannot be cancelled and survives `acceptProjectOwnership` | 9.1, D20 |
| M-3 | Unknown-credential denials are not persisted (in-memory counter); per-IP limiter on `POST /v2/sponsor` before the body is read; unknown ERC-7677 tokens limited per IP; `audit_log_v2` retention (30 days) on the reconciler timer | 6.1 |
| L-1 | Projects fail closed when `senderDailyLimit == 0` (`ZeroDailyLimit`); the service mirrors it (`project_sender_limit_not_set`) | 4.4, 7a, T8 |
| L-2 | `addStake` owner-only, delay <= 30 days | 4.8 |
| L-3 | `address(0)` can be proposed and executed as a bundler (never as a signer) | 4.1 |
| L-4 | Same (sender, nonce) replacement keeps the larger reservation until the old `valid_until` | 5 |
| L-5 | `allowAccountDeployment=false` enforced in `engine.evaluate` | 6.1 |
| L-6 | `postOp` charges a validation-time snapshot of the overhead and a "sender tracked" marker; worst case 16.2k-18.1k -> 13.9k | 4.4, 4.5 |
| B5 | Pending claims, re-claims and admin additions lapse 30 days after they become executable (an expired entry behaves as absent and an expired admin proposal can be re-proposed); a nomination can be unset with `address(0)` | 4.1 |
| C-L1 | `POST /v2/projects` takes an `appId` from the chain event, or from the request only if it hashes to the `projectId` (`app_id_mismatch` otherwise) | 10 |
| A7 | `setFreeTier` rejects a non-zero per-sender limit below the per-op cap | 1 |
| openapi | 400 and 413 documented on `/v2/sponsor` (plus the new 403/429 reasons) | `openapi.yaml` |

### 16.2 Contract size: the levers, in order

`PepuSponsoredPaymasterV7` was 24,405 of 24,576 bytes (EIP-170). Measured after each lever (forge 1.5.1, solc 0.8.26, london):

1. **L-6 postOp snapshot + L-1**: 24,503 bytes (the snapshot saves a few bytes; the `+ 1` tracked marker and the L-1 branch cost more).
2. All remaining fixes (M-1, M-2, L-2, L-3, B5, A7, fee cap): 25,644 bytes (1,068 over).
3. **Code tightening** (one shared effective-fee-cap getter, the redundant `amount > uint128.max` check in `_credit` dropped): 25,474 bytes (-170).
4. **Lower optimizer runs for this contract only**: 8,000 runs gives **23,722 bytes (854 spare)**. For reference the same source is 24,539 at 15,000 runs, 23,177 at 4,000 and 22,227 at 2,000. Gas cost on the real-EntryPoint harness (cold state): validation 72,237 -> 72,393 (+156, +0.2%), honest postOp 8,242 -> 8,317 (+75), worst-case postOp 13,843 -> 13,918 (+75, +0.5%).
5. **Not needed:** moving project ownership (claim, reclaim, transfer, nominee, veto) into a separate `PepuProjectRegistry`. If a later change does not fit, the design is: the registry stores `owner`, `pendingReclaim`, `pendingProjectOwner`, `vetoedReclaimant` and `claimUsed` and verifies claim attestations against the paymaster's signer set (a view the paymaster exposes); the paymaster keeps ledgers, validation and `postOp` and reads `registry.ownerOf(projectId)` in `_checkProjectOwner` and `_reserve` (one extra external staticcall per validation, about 2.6k gas cold). The invariants and the tests above are unchanged by that split because they exercise the public functions.

The pinned creation hash covers the 8,000-run build (13). `foundry.toml` applies the lower runs to `src/PepuSponsoredPaymasterV7.sol` only, so the deployed v1 `PepuVerifyingPaymasterV7` still builds to `0xe987efab...`.

### 16.3 Documented, not fixed (Info and leads)

- **C-L2 owner routes rescan `eth_getLogs` from `SPONSORSHIP_V2_DEPLOY_BLOCK`** on every uncached call. Cost grows with chain age and anyone who claims a project can trigger it (they are rate limited per address). Set the deploy block; a checkpoint cursor in `kv` (or letting the reconciler index) is the follow-up.
- **A4 constant overcharge (~11.2k gas per op)** goes to the free pool as surplus. A tighter penalty bound would need a measured per-op cap; accepted because it keeps the second solvency term independent.
- **A5 midnight liveness gap**: an op signed just before UTC midnight carries a `validAfter` in the old day and is charged against the old bucket (the refund is released from the right bucket, L-1 of the first review); a very busy project can see a short window of `DailyLimitExceeded` after midnight until a new-day op resets the counter. Retry with a fresh approval.
- **A6 the 40k gwei fee cap is immutable and now also the ceiling for every sponsor cap.** If the base fee ever exceeds the default, the free pool and unconfigured projects stop validating until a new paymaster is deployed. A project owner can already choose a LOWER cap; none can raise it. Size the default with headroom at deploy (the measured base fee is about 12,500 gwei).
- **A8 stranded funds** under deposit-only: inventory unchanged (9.4); no escape hatch.
- **Free-pool sybil cost**: about 50 PEPU per verified Privy account per day with no aggregate bound, by design (R2). Fund the pool in tranches and watch `UserOpSettled` volume.
- **B leads:** `setFreeTargets` is an instant manager power with no timelock (a sybil-farming vector, bounded by per-user caps); the owner can self-bundle the free pool after the 48 h bundler timelock (T3, residual); a re-claim inherits the previous owner's allowlist, codehash pin and limits (the new owner should review them right away; the credentials are revoked at once); signers must be EOAs (no ERC-1271); a fee cap cannot be reset to "use the default" with 0 (set it to the default value instead, which is now the maximum); after a renounce with a rogue manager there is no canceller for a pending first claim and `pauseFreePool` cannot be undone. The last one is why the recommended end state keeps a trustworthy manager.
- **C info:**
  - A conformant ERC-7562 bundler would reject this paymaster (ORIGIN opcode, global slot 15 `totalLiabilities` written by every op, stake needed). It needs a self-run Alto with safe-mode off and an allowlisted executor: a hard requirement (T20), not a bug.
  - `TRUST_PROXY` and `TRUSTED_PROXY_HOPS` must match the real proxy chain; otherwise one caller can exhaust the shared IP buckets (now also the new `/v2/sponsor` bucket).
  - At the maximum claim TTL of 3,600 s clock skew can trip `ClaimDeadlineTooFar`; the default of 600 s is fine.
  - The verify failure budget is peek-then-charge and races under concurrency; the per-IP limit still bounds it.
  - A nonce above 2^256-1 returns a 500.
  - The Privy cross-app secret check is still untested against two live apps (open before launch).
