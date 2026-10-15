# PEPU ecosystem addresses (not in the SDK registry)

The network facts and the PEPU core contracts (Multicall3, Permit2, EntryPoints, Kernel stack, paymaster) are in [chain-facts.md](chain-facts.md), generated from the SDK.
This file holds third-party and L1 addresses the SDK registry does not track as core infra. For PepuSwap contracts prefer the SDK: `getPepuSwapContract`, `listPepuSwapContracts` from `@pepu-chain/sdk`. Verify any address with `pepu_check_contract_deployed` before relying on it.

## PepuSwap's non-canonical substitutes (don't confuse these with the real thing)

PepuSwap (PEPU's main DEX, operated by a third party, "0sum.io") is a white-labelled Uniswap V3
fork. It deployed its own versions of contracts that are normally found at canonical addresses:

| Contract | Address | Note |
|---|---|---|
| Non-canonical Multicall | `0x927af2a6B76d2d8206d93004463F8C122701383B` | 2.7KB, a small custom multicall — **not** Multicall3-compatible |
| Non-canonical Permit2 | `0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B` | Overrides `PERMIT2_ADDRESS` specifically for chain 97741 in PepuSwap's own frontend code |
| V3 Core Factory | `0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807` | Verified on pepuscan as `UniswapV3Factory` |
| SwapRouter02 | `0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb` | |
| UniversalRouter | `0x0dE72b751b77d3c74fB96C5fAd0320Cd8d133d36` | |
| NonfungiblePositionManager | `0xe2060CbdE18b5e765c86e5Cd6EE68AF209a9faa7` | LP NFTs show as "Launchpad V3 Positions NFT" / "UNI-V3-POS" |
| QuoterV2 | `0xd647b2D80b48e93613Aa6982b85f8909578b4829` | |

If you're integrating with PepuSwap specifically (not writing general PEPU tooling), you need
these addresses, not the canonical ones. Get PepuSwap's official token list from
`https://raw.githubusercontent.com/0sum-io/tokens/refs/heads/main/pepu-mainnet2.json` rather than
hardcoding token addresses.

## Token addresses

| Token | Chain | Address | Decimals |
|---|---|---|---|
| PEPU (native gas token) | L2 | `0x0000000000000000000000000000000000000000` (native, zero-address convention) | 18 |
| PEPU (ERC-20 backing the gas token) | Ethereum L1 | `0x93aA0ccD1e5628d3A841C4DbdF602D9eb04085d6` | 18 |
| WPEPU (wrapped native) | L2 | `0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8` | 18 |
| USDT (bridged) | L2 | `0x06f69A40C33C5A4Cd038BBE1DA689D4D636Ec448` | 6 |
| USDC (bridged) | L2 | `0x20fB684Bfc1aBAaD3AceC5712f2Aa30bd494dF74` | 6 |
| WETH (bridged) | L2 | `0x7CCC51754216C04D4Bb1210630cCA16e5430Aa70` | 18 |

**Warning**: web searches turn up several other Ethereum addresses labelled "Pepe Unchained
(PEPU)" that are unrelated/likely clone tokens. Only `0x93aA0ccD1e5628d3A841C4DbdF602D9eb04085d6`
is corroborated by CoinGecko's official platform mapping (coin id `pepe-unchained-2` — note the
`-2` suffix; the plain `pepe-unchained` id on CoinGecko is the legacy V1 token and is explicitly
labelled "[OLD]").

## L1 (Ethereum) bridge contracts

| Contract | Address |
|---|---|
| Bridge | `0xd3643255ea784c75a5325CC5a4A549C7CD62E499` |
| Inbox | `0xE92Df19F4e0Fd067FE3b788Cf03ffD06Cd9Be4A7` |
| SequencerInbox | `0x93CA3db0dF3e78e798004bbE14e1ADE222B14dFa` |
| Outbox | `0xd2E3B3be0ddA5E3214f551aF5A4f4049b9D031A9` |
| Rollup / RollupProxy | Two independent sources disagree on this one address — verify directly on Etherscan before relying on it for anything (not needed for ordinary app development; only relevant if you're building against the rollup contract itself) |

Standard Arbitrum token bridge (GatewayRouter, Standard ERC20 Gateway, Custom Gateway) addresses
are also confirmed and available if you're building bridge-adjacent tooling — ask for the full
table if you need it; it's omitted here as out of scope for ordinary app/contract development.
