# The Multicall3 Trap

This is the single most important gotcha on Pepe Unchained V2. Read it before you wire up any tooling that reads multiple contracts at once — viem's `multicall()`, wagmi's `useReadContracts`, or anything built on top of either.

## The short version

**Multicall3 is deployed on PEPU mainnet — but not at the address almost every EVM tool assumes.**

| | |
|---|---|
| Canonical Multicall3 address (works on nearly every other EVM chain) | `0xcA11bde05977b3631167028862bE2a173976CA11` — **has no code on PEPU. It is permanently unreachable here — see why below.** |
| PEPU's actual Multicall3 address | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` — deployed, verified on pepuscan, confirmed working with viem's `multicall()`. |

If your chain configuration doesn't explicitly set this address, or if a library you're using hardcodes the canonical one, batched reads will either throw a confusing "no code at this address" error or silently fail — not something an unfamiliar developer will trace back to "wrong Multicall3 address" quickly.

## Why the canonical address is unreachable here — not just unused

Other canonical contracts could be recovered on PEPU because they were deployed through CREATE2: the deterministic deployer is live, so the same source deployed the same way reproduces the canonical address (that is how Permit2 was deployed; see [Permit2](permit2.md)). Multicall3 is different.

Multicall3's canonical deployment on other chains was **not** done via CREATE2. It used a plain `CREATE` from a specific burn EOA, via a **pre-signed transaction with a hardcoded 1,000,000 gas limit**. That transaction is replayed, unmodified, on every new chain to get Multicall3 at the same address everywhere.

Arbitrum Nitro chains — including PEPU — need roughly **14.3 million gas** to deploy the same Multicall3 bytecode. The pre-signed transaction's fixed 1,000,000 gas limit means it **cannot execute here**, on this chain, ever, using that original signed transaction. There is no version of "just run the deploy script again" that fixes this — the transaction that would recreate the canonical address doesn't have enough gas headroom for this chain's execution costs, and it can't be re-signed with a higher limit without changing its hash (and therefore its resulting address).

The only way to get Multicall3 at the canonical address on PEPU would be for Conduit to add it as a **predeploy** at genesis — something only the chain operator can do, and not something that helps a chain that has already launched.

## What PEPU did instead

A PEPU-specific Multicall3 was deployed:

1. Built from the canonical [`mds1/multicall3`](https://github.com/mds1/multicall3) source, compiled with solc `0.8.12`, optimizer runs set to `10,000,000` — matching the canonical build as closely as possible so the bytecode's behavior is identical.
2. Deployed via the CREATE2 deterministic deployer (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) with a zero salt, which is why the resulting address (`0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`) is reproducible from the same inputs, just not equal to the canonical one (different deployment method → different resulting address, by construction).
3. Verified on pepuscan.
4. Confirmed working end-to-end with viem's `multicall()` action against it.

It behaves exactly like Multicall3 everywhere else — it's simply at a different address, and every tool that talks to it needs to be told that explicitly.

## Deployment receipt and verification

| | |
|---|---|
| Address | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` (in the SDK registry as `multicall3`) |
| Deployer contract | CREATE2 deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, salt all zeros |
| Transaction | `0xf9d8f45010e2a2020871af9a677d134e9b43e039a0a73c09bcd22d1825f99241` |
| Block | 10521048 (`0xa089d8`), the `blockCreated` used in the chain definition |
| Gas used | 874,693 (`0xd58c5`) |
| Runtime size | 3,808 bytes, checked with `eth_getCode` by `pnpm --filter @pepu-chain/sdk live-check` on 2026-10-03 |
| Source | `contracts/multicall3/src/Multicall3.sol`, solc 0.8.12, optimizer 10,000,000 runs (`contracts/multicall3/foundry.toml`) |
| Receipt and script | `deploy/multicall3-receipt.json`, `deploy/deploy-multicall3.sh`, `deploy/verify-multicall3.sh` |

The same live check confirms the canonical `0xcA11bde0…CA11` has no code. See [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md) for reproducing the address.

## What to do about it

**If you're using `@pepu-chain/sdk`:** nothing extra — `pepuMainnet.contracts.multicall3` is already set to the correct address. `getPublicClient(pepuMainnet)` and any wagmi config built from `pepuChains` pick it up automatically, and viem's `multicall()` action just works. See [`@pepu-chain/sdk` Reference](../sdk/reference.md).

**If you're hand-rolling a chain definition**, set the address explicitly rather than relying on a default:

```ts
import { defineChain } from "viem";

export const pepuMainnet = defineChain({
  id: 97741,
  name: "Pepe Unchained V2",
  nativeCurrency: { name: "Pepe Unchained", symbol: "PEPU", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"] } },
  contracts: {
    multicall3: {
      address: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
      blockCreated: 10521048,
    },
  },
});
```

**Never substitute the canonical `0xcA11bde0…` address for PEPU.** It has no code here — any call against it returns empty data, and viem/wagmi's batching will fail for every read routed through it.

**If you omit `contracts.multicall3` entirely**, viem and wagmi fall back to individual per-call requests instead of batching. This is safe — you lose batching performance, not correctness — but it's strictly worse than setting the correct address above, since PEPU does have a working Multicall3 today.

## Don't confuse it with PepuSwap's "multicall"

PepuSwap (PEPU's native DEX, a Uniswap V3 fork) deployed its own small, non-canonical multicall-named contract at `0x927af2a6B76d2d8206d93004463F8C122701383B`. It is **not** Multicall3-compatible — it's a router-adjacent contract sized for PepuSwap's own needs, not general-purpose batching. Don't point generic tooling at it. See [Deployed Contracts Reference](deployed-contracts.md) for the full list of these app-specific, easy-to-confuse addresses.

## Recipe

Once your chain definition has the right address, batching reads is exactly the same code you'd write on any chain with Multicall3 — see [Batch Reads with Multicall3](../recipes/batch-reads-with-multicall3.md) for a copy-pasteable example.

