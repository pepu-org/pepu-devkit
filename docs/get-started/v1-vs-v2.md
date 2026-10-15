# V1 vs V2: Which Chain Are You On

**Short answer: if you are building today, you are building on V2 — chain ID `97741` (mainnet) / `97740` (testnet), Arbitrum Orbit. There is an older chain, V1 — chain ID `3409`, OP Stack — and it is dead. Do not configure your tools against chain ID `3409`.**

This page exists because search results, older third-party chain listings, and cached AI answers still surface V1 details under the name "Pepe Unchained." Getting this wrong costs real time: a wrong chain ID means your wallet, RPC, and deploy scripts silently point at a chain that no longer accepts new activity.

## The two chains

| | V1 (legacy, dead) | V2 (current) |
|---|---|---|
| Chain ID | `3409` | `97741` (mainnet), `97740` (testnet) |
| Stack | OP Stack / Optimium | Arbitrum Orbit / Nitro |
| Data availability | Custom Gas Token setup via Celestia-adjacent configuration | AnyTrust/Optimium, 1-of-1 committee — see [Network Properties](network-properties.md) |
| Status | **Dead.** Legacy migration/claims portal closed **2026-01-31, 23:59 UTC**. No new deployments, no supported RPC. | **Live.** This is the chain the rest of these docs cover. |
| RPC | Not documented here — do not use | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` (mainnet), `https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` (testnet) |

The migration from V1 to V2 happened because Conduit deprecated the Custom Gas Token feature V1 depended on. V2 is a separate chain, not an upgrade in place — different chain ID, different stack, different RPC, no shared state.

## Where the confusion comes from

- **Third-party chain-list and SDK pages have been observed showing incorrect V2 testnet data** — including a wrong chain ID and a wrong gas-token currency for testnet `97740`. Always verify against this page or a direct `eth_chainId` call against the RPC URLs above rather than trusting a third-party listing.
- Generic "Pepe Unchained" search results and some cached AI answers may still describe the V1 chain's architecture (OP Stack, Celestia-style DA) as if it were current. If you see chain ID `3409` mentioned anywhere in the same breath as architectural claims about Pepe Unchained, that content is describing the dead chain.
- A separate, unrelated chain called "Pepe Chain Mainnet" also exists on some chain-list sites under a different chain ID. It is not related to Pepe Unchained at all — don't confuse the two by name alone.

## What to do

- Configure your wallet, Hardhat/Foundry, and any chain-definition objects against chain ID `97741` (mainnet) or `97740` (testnet) only. See [Network Reference](network-reference.md) for the full, copy-pasteable parameters.
- If you're citing an architectural fact about "Pepe Unchained" from a source you didn't get from this docs set, check whether it's talking about chain `3409` before you rely on it.

