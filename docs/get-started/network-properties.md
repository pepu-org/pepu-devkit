# Network Properties

This page states plainly what kind of chain Pepe Unchained V2 is, including the parts that are trade-offs rather than selling points. Serious builders check third-party risk assessments before shipping to a chain regardless of what any docs page says — better they read it here first than find it independently and wonder why it wasn't mentioned.

## Stack

Pepe Unchained V2 runs on **Arbitrum Orbit**, using the **Nitro** execution stack, on **ArbOS 51**, operated by Conduit. It settles to Ethereum L1. This is a standard, largely unmodified Orbit deployment — see [Deploy & Verify a Contract](../contracts/deployment.md) for confirmation that ordinary Hardhat/Foundry tooling works against it without special handling.

## Data availability: AnyTrust, 1-of-1 committee

The chain runs in **AnyTrust** mode (sometimes referred to as Optimium), not full Rollup mode. The distinction matters:

- A full Rollup posts all transaction data to Ethereum L1, so anyone can reconstruct chain state from L1 data alone.
- An AnyTrust chain instead relies on a **Data Availability Committee (DAC)**: a set of parties who attest that they're holding the data off-chain. As long as enough committee members are honest and available, the data stays retrievable; if they aren't, data availability isn't guaranteed by L1 alone.

Pepe Unchained's DAC currently has **one member (1-of-1)**. There is no redundancy: data availability depends on that single party. This is a meaningfully weaker trust assumption than either a full Rollup or an AnyTrust chain with a larger, more distributed committee.

## Newer EVM features live on this chain

- **EIP-7702 is live.** EOAs can delegate execution to contract code without a full smart-account migration.
- **The P256 precompile is live at `0x100`.** This makes secp256r1 signature verification (as used by passkeys) cheap to do on-chain — a building block for passkey-based authentication, though it is only one piece of that puzzle. See [Social Login & Embedded Wallets](../onboarding/privy-embedded-wallets.md) for how login and wallets are wired up.
- **An ERC-4337 EntryPoint (v0.6 and v0.7), a ZeroDev Kernel v3 smart-account factory, and a funded, staked paymaster are deployed on mainnet.** Smart accounts and gas sponsorship are available through PEPU's hosted bundler and paymaster; an app needs a funded project. See [Sponsored Transactions](../onboarding/sponsored-transactions.md) and [Smart Accounts](../onboarding/smart-accounts.md).

## L2BEAT assessment

[L2BEAT's "Pepe Unchained" page](https://l2beat.com/scaling/projects/pepeunchained) exists, but it is not an assessment of this chain. It covers the **archived V1 chain — chain ID `3409`, an Optimium on the OP Stack** — and carries L2BEAT's own banner stating the project is archived and no longer maintained, having migrated from OP Stack to Orbit. Its stage rating and critical-severity findings (including things like an unenforced upgrade delay and non-permissionless fraud proofs) describe that dead chain, not V2. If you land on that page while researching Pepe Unchained, read it as V1 history — see [V1 vs V2](v1-vs-v2.md) — not as current risk information.

**V2 (chain ID `97741`) has no independent L2BEAT assessment or equivalent third-party risk rating at this time.** No separate L2BEAT page tracks the Orbit chain. That absence is stated here as a fact, not a reassurance — it means the centralization properties described above (the 1-of-1 data availability committee in particular) haven't been independently rated by L2BEAT or a comparable third party, in either direction. Judge V2 on its own documented properties, not on V1's findings and not on the assumption that "no rating" implies a good one.

## What this means practically

None of the above prevents you from deploying and using standard EVM contracts today — the execution environment works as documented in [Deploy & Verify a Contract](../contracts/deployment.md). It does mean you should factor the chain's current centralization and maturity profile into any decision that assumes L1-grade trust guarantees (for example, holding significant value in a bridge or contract that assumes fully trustless exit paths).

