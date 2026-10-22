# Self-relaying a UserOperation on PEPU (no bundler required)

This is the fallback path when there's no bundler RPC to talk to — which is PEPU's situation
today (see SKILL.md). "Self-relaying" means: you build a valid `PackedUserOperation` yourself and
call the EntryPoint contract's own `handleOps(userOps, beneficiary)` function directly, as an
ordinary transaction from a wallet you control. This is a real, standard ERC-4337 technique (it's
literally what a bundler does internally — a bundler is just an automated, mempool-aware version
of this same call) and is explicitly used for local testing in the ERC-4337 ecosystem. It is low
freedom, fragile if any field is wrong, and worth validating one step at a time rather than
assembling the whole thing blind.

## Contents
- What you're building and why it's fragile
- Step 1: build the calls you actually want to execute
- Step 2: get the account's nonce and gas figures
- Step 3: assemble the PackedUserOperation
- Step 4: sign it
- Step 5: call handleOps
- Gas payment mechanics — who actually pays, and how
- Verification checklist before trusting any of this with real funds

## What you're building and why it's fragile

A `PackedUserOperation` (the ERC-4337 v0.7 struct) has a specific field layout — `sender`, `nonce`,
`initCode`, `callData`, `accountGasLimits` (verification + call gas limits packed into one
`bytes32`), `preVerificationGas`, `gasFees` (priority + max fee packed into one `bytes32`),
`paymasterAndData`, `signature`. Get the packing wrong (wrong byte order, wrong field width) and
`handleOps` will revert with an opaque error, not a helpful one. Pull the **exact** struct
definition, encoding helpers, and EntryPoint ABI from the canonical source —
[`eth-infinitism/account-abstraction`](https://github.com/eth-infinitism/account-abstraction),
the `v0.7` release tag — rather than hand-typing the struct from memory or from this document. This
document tells you the shape of the process; it deliberately does not restate the exact ABI, so
that you go to the canonical source of truth instead of a possibly-stale copy of it.

## Step 1: build the calls you actually want to execute

A Kernel account's `callData` for a UserOperation is an encoded call to its own `execute` function
(single call) or `executeBatch` (multiple calls), wrapping whatever contract call you actually want
the account to perform. Encode this with viem's `encodeFunctionData` against Kernel's ABI — the
account object from `toKernelSmartAccount` (see SKILL.md) typically exposes an `encodeCalls()`-style
helper for this; check the version you installed for the exact method name rather than assuming.

## Step 2: get the account's nonce and gas figures

- **Nonce**: call the EntryPoint's `getNonce(sender, key)` — for a first-ever transaction from a
  not-yet-deployed account, this returns `0`. Use `pepu:pepu_read_contract` (or `cast call`) against
  the live EntryPoint address to confirm this before assembling anything, rather than assuming.
- **initCode**: for a not-yet-deployed account, this is the factory address plus the calldata that
  deploys it (via the Kernel factory/MetaFactory addresses in SKILL.md) — omit it (empty bytes) once
  the account already has code on-chain.
- **Gas limits and fees**: since there's no bundler to estimate these for you, get a real number
  from `eth_estimateGas`-style simulation against the intended call, and price it with
  `pepu:pepu_estimate_gas_cost` — remember PEPU's base fee is naturally ~12,500 gwei-equivalent
  (not a bug, don't lowball it — see `pepu-chain-setup`). Pad verification gas generously on a first
  attempt; the whole point of this path is that nobody is simulating it for you first.

## Step 3: assemble the PackedUserOperation

Populate every field per the canonical struct definition (Step "What you're building" above).
`paymasterAndData` must be empty (`0x`) for this self-paid path. To have gas sponsored instead, do
not self-relay: get `paymasterAndData` from the hosted paymaster service
(`https://paymaster.pepeunchained.com/v2/paymaster/<token>`, via `createPepuSponsoredClient` /
`sendSponsored` from `@pepu-chain/sdk/aa/kernel`) and submit through the hosted bundler. A non-empty
value without a matching signature from that service fails validation.

## Step 4: sign it

Compute the UserOperation hash (EntryPoint v0.7's `getUserOpHash`, which folds in the EntryPoint
address and `block.chainid` — this is what prevents a signature made for one chain/EntryPoint being
replayed on another) and sign it with the account owner's key, in whatever format the account's
validator expects (Kernel's ECDSA validator, in the default configuration from SKILL.md, expects a
plain ECDSA signature over that hash). Use the smart-account object's own signing helper if the
library you're using (permissionless.js) exposes one, rather than reimplementing the hash/sign
sequence by hand — the helper stays correct across library version bumps in a way a hand-rolled
copy won't.

## Step 5: call handleOps

```ts
// entryPointAbi: pulled from eth-infinitism/account-abstraction's v0.7 release, not hand-typed
await walletClient.writeContract({
  address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // EntryPoint v0.7, confirmed live on PEPU mainnet
  abi: entryPointAbi,
  functionName: "handleOps",
  args: [[packedUserOp], beneficiaryAddress],
});
```

`walletClient` here is a plain viem wallet client for an ordinary EOA — the one paying gas for
*this* transaction, exactly like any other contract call. `beneficiaryAddress` receives any surplus
the account overpaid for gas; setting it to your own submitting address is standard practice.

## Gas payment mechanics — who actually pays, and how

Two independent gas costs are in play, and it's easy to conflate them:
1. **The `handleOps` transaction itself** costs PEPU gas, paid by whoever's wallet calls it (the
   `walletClient` above) — same as any other transaction.
2. **The smart account's own UserOperation cost** is charged to the smart account by the
   EntryPoint during validation, either by pulling from a pre-existing EntryPoint deposit
   (`entryPoint.depositTo(account)`) or — the standard fallback — by the account transferring the
   "missing funds" directly to the EntryPoint from its own native PEPU balance during
   `validateUserOp`. Either way, **the smart account needs real PEPU before its first transaction**;
   a paymaster that could cover this exists on PEPU, but its sponsorship service isn't reachable by
   this self-relay path (or by any app, yet) — see SKILL.md.

If the same address both submits `handleOps` and owns the smart account being charged, these two
costs can net out close to a single ordinary transaction's gas — but confirm this empirically
(Step "Verification checklist" below) rather than assuming the netting is exact.

## Verification checklist before trusting any of this with real funds

- [ ] Confirm the EntryPoint address's bytecode is genuinely live (`pepu:pepu_verify_contract_status`
      or a direct `eth_getCode`) — don't assume from this document alone.
- [ ] Confirm `getNonce` returns the value you expect before signing anything.
- [ ] Run the full flow once against a **freshly-generated dev key with a small PEPU balance**, not
      a production wallet, and confirm the resulting transaction actually executed the intended
      call (check the emitted `UserOperationEvent`/`UserOperationRevertReason` on the EntryPoint, or
      just re-read the target contract's state via `pepu:pepu_read_contract`).
- [ ] If `handleOps` reverts, decode the revert reason before guessing — see the
      `pepu-debug-transaction` skill for how.
- [ ] Re-verify the exact `PackedUserOperation` field layout against the `v0.7` tag of
      `eth-infinitism/account-abstraction` at the time you build this, not from memory of an
      earlier version — the v0.6 and v0.7 struct shapes differ (v0.6 is unpacked, with separate
      `callGasLimit`/`verificationGasLimit`/`maxFeePerGas`/`maxPriorityFeePerGas` fields instead of
      the packed `bytes32` pairs above).
