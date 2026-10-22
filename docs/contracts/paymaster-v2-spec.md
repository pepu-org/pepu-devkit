# Paymaster v2 Spec Summary

A readable summary of the tiered gas-sponsorship specification (`services/paymaster/SPONSORSHIP-SPEC.md`): model, invariants, security considerations and design decisions. The full spec is the source of truth; this page is the map. Read it to understand what v2 guarantees and where its limits are.

Deployed at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`. The numbers below are the spec's design numbers; the live per-user free allowance is 100 PEPU per day and 50 PEPU per hour, enforced by the policy service. The v1 paymaster is retired.

## Model

| Tier | Funded by | Who draws | Bound |
|---|---|---|---|
| Free tier | The chain: a free pool anyone can fund | **Verified Privy users only** | 100 PEPU per user per day and 50 PEPU per hour (service). Spec design numbers: 50 PEPU per day, 40 PEPU max per operation. On-chain per-wallet backstop, the pool balance. **No chain-wide ceiling** |
| Project tier | A project, funded by anyone depositing on chain | **Any wallet** the project sponsors | Project balance, daily limit, per-wallet limit, destination allowlist, gas-price cap |

Per operation, atomically and never split: the project pays if it can; otherwise the free tier, only for a verified Privy account with allowance; otherwise denied. The free tier never pays for non-Privy wallets, even when a project is empty.

One contract is both paymaster and vault. All PEPU sits in its EntryPoint deposit and an internal ledger records each sponsor's share (`sponsorId` 0 is the free pool; otherwise `keccak256(bytes(appId))`). Validation deducts the full `maxCost` from the sponsor; `postOp` refunds `maxCost - charge` to that same sponsor.

## Decisions

| | Decision |
|---|---|
| Deposits | **One-way.** Anyone deposits into any project (claimed or not) or the free pool; **nothing can withdraw**, not project owners, the contract owner or the manager. The only outflow is gas settlement |
| Project identity | `projectId = keccak256(bytes(appId))`: one canonical project per Privy app, case-sensitive |
| Ownership | Privy-verified. The policy service checks the Privy app secret, issues an EIP-712 attestation, the developer calls `claimProject`. **The claim sets only the owner**; the owner then calls `setTargets`, `setDailyLimit`, `setSenderDailyLimit` (all three are required: a project with no per-wallet limit is rejected on chain). An **empty** project is claimed immediately; a project that **already holds funds** is pending for the admin delay (cancellable by the contract owner or manager) |
| Re-claim | Of an owned project: timelocked at least 48 hours, announced on chain, cancellable by the current owner **once per new owner** (a second attested re-claim by the same new owner is final), void if the attesting signer was removed, lapses 30 days after it becomes executable |
| Exit | **Pausing is the exit**, instant. Funds cannot leave |
| Contract owner | The deployer by default; `Ownable2Step`, renounce supported. Nothing a project needs depends on the owner |
| Free tier numbers | 50 PEPU per user per day, 40 PEPU per operation |
| Surplus | Unused prepay returns to the exact sponsor that was charged; unattributable residue (and donations) can only go to the free pool, never to the owner |
| Governance | Signer and bundler **additions** wait an immutable `adminChangeDelay` (at least 48 hours, at most 30 days); removals instant; manager separate from owner |
| Gas-price cap | On-chain per-sponsor cap on `maxFeePerGas` (deploy default 40,000 gwei; a sponsor can only tighten it) plus service bounds |
| Bundler gate | Unconditional on-chain `tx.origin` allowlist; mode byte must be exactly `0x02` |
| Credentials | Server key `ppk_` (secret, any wallet) or client token `ppt_` (publishable, origin-bound) |
| Stranded funds | Accepted: an abandoned project's money stays locked, no escape hatch |

## Differences from v1

| | v1 | v2 |
|---|---|---|
| Caps | Off-chain only | Off-chain plus on-chain allowlist, limits and fee cap per sponsor |
| Accounting | One shared deposit | Per-sponsor ledger, actual-cost settlement and refunds |
| Who funds | One operator | Anyone, per project, plus a free pool |
| Onboarding | Manual registration | Self-serve claim |
| Mode byte | `0x00` | `0x02` only (sponsor id in the signed data) |
| Bundler gate | None | Required allowlisted bundler |

## Invariants

- Ledgers sum to `totalLiabilities`, and `totalLiabilities` is at most the EntryPoint deposit; balances never underflow.
- **No function of any role moves ledger funds out of the EntryPoint deposit**; the contract never calls `entryPoint.withdrawTo` (a test scans the bytecode). Only stake, a separate balance, can be withdrawn by the owner.
- The deposit plus gas paid to the beneficiary equals everything ever deposited, over random sequences of claims, deposits, donations, pauses, stake moves and operations.
- On the real EntryPoint v0.7 sources, the ledger charge is at least the EntryPoint's true debit for every operation, including the worst-case slot-restoring attack at the overhead floor (post-op overhead floor 18,000 gas, deployed 20,000; measured worst case 13,918 gas with cold state, after the overhead is snapshotted at validation).
- Day counters track charges exactly; one sponsor's operation never moves another sponsor's ledger.

## Security considerations

- The policy signer is the **ownership gatekeeper** for projects as well as the sponsorship signer (one shared signer set). A compromised signer can claim an **empty unclaimed** project immediately, claim a funded one after the admin delay unless the contract owner or manager cancels it (or the signer is removed), or start a re-claim of an owned one, but can never withdraw funds. Its spending is bounded on chain: only claimed sponsors, only allowlisted targets, only within the daily and per-wallet limits, only paid to an allowlisted bundler, at no more than the fee cap. The free pool's worst case is its balance, because a signer can invent wallets.
- A hot manager cannot quickly add itself as signer and bundler: additions are timelocked, so projects that watch `AdminChangeProposed` can pause first.
- Re-claims and the first claim of a funded project are visible, timelocked, cancellable and die with a removed signer; credentials follow the on-chain owner and are revoked on change. The owner can veto a re-claim once per new owner, so a hostile owner cannot block recovery forever.
- The `tx.origin` gate means v2 works only behind a bundler with safe mode off and an allowlisted executor, which is how the hosted PEPU bundler runs; a conformant public-mempool bundler rejects it.
- Design limitations:
  - Free-tier sybil: N Privy accounts get N times the per-user free allowance a day, bounded by the pool balance.
  - A many-address attacker can hold up to 25% of a client token's reservation pool.
  - The contract is immutable and holds third-party deposits that cannot be withdrawn.
  - Destination decoding supports Kernel accounts only.
  - Runtime size is 23,722 of 24,576 bytes, built with 8,000 optimizer runs.

## Full detail

- Full spec: `services/paymaster/SPONSORSHIP-SPEC.md` (sections: model, architecture, contract, accounting, free tier, sybil resistance, invariants, claims, API, threat model T1 to T22, migration, decisions D1 to D22 and open questions).
- Contract reference: [PepuSponsoredPaymasterV7 Contract](../infra/paymaster/contracts.md).
- API: [REST API v2](../infra/paymaster/rest-api-v2.md). Procedure: [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md).
- User-facing model: [Sponsorship Tiers](../onboarding/sponsorship-tiers.md).

## Related

- [Security Reviews](audits.md)
- [Paymaster Overview](../infra/paymaster/overview.md)
- [Address Map](address-map.md)
