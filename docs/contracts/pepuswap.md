# PepuSwap Addresses

PepuSwap is PEPU's main DEX, operated by a third party (0sum.io): a white-labelled Uniswap V3 fork. Several of its contracts sit at non-canonical addresses, and two of them (a multicall and a Permit2) are easy to mistake for general infrastructure. This page lists them and the do-not-substitute rules.

Addresses are in the SDK's PepuSwap registry (`getPepuSwapContract`, `listPepuSwapContracts`). These are third-party contracts: PEPU does not operate them and they are outside this repository's security policy. `live-check` covers `pepuContracts` only, so confirm a contract with `pepu_check_contract_deployed` before relying on it. Mainnet only.

## Address table

| Registry key | Name | Address | Notes |
|---|---|---|---|
| `v3Factory` | UniswapV3Factory | `0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807` | Source verified on pepuscan; other PepuSwap contracts' `factory()` return it |
| `swapRouter02` | SwapRouter02 | `0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb` | `factory()` and `WETH9()` resolve to the factory and WPEPU |
| `universalRouter` | UniversalRouter | `0x0dE72b751b77d3c74fB96C5fAd0320Cd8d133d36` | No public getters |
| `positionManager` | NonfungiblePositionManager | `0xe2060CbdE18b5e765c86e5Cd6EE68AF209a9faa7` | LP NFTs list as "Launchpad V3 Positions NFT" / UNI-V3-POS |
| `quoterV2` | QuoterV2 | `0xd647b2D80b48e93613Aa6982b85f8909578b4829` | Quote with `eth_call` or `simulateContract` only; never send a real transaction |
| `tickLens` | TickLens | `0x4EB8aA84c066f9bf210eAfE33B30AE49BfafD9a6` | Stateless |
| `v3Migrator` | V3Migrator | `0xFE406d6c3fc0BB3a6D195b089eFADfc8658206D5` | No dedicated ABI in the SDK |
| `v3Staker` | V3Staker | `0x0a875d1C72cb4e1CD61401c3C49f85Df45071f83` | Uniswap LP incentive staking, unrelated to "stake PEPU". No dedicated ABI in the SDK |
| `multicallNonCanonical` | UniswapInterfaceMulticall | `0x927af2a6B76d2d8206d93004463F8C122701383B` | **Not Multicall3** |
| `permit2NonCanonical` | PepuSwap Permit2 | `0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B` | **Not the canonical Permit2** |

Tokens it trades (also in `@pepu-chain/sdk` tokens): WPEPU `0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8` (18 decimals), USDT `0x06f69A40C33C5A4Cd038BBE1DA689D4D636Ec448` (6 decimals), USDC `0x20fB684Bfc1aBAaD3AceC5712f2Aa30bd494dF74` (6), WETH `0x7CCC51754216C04D4Bb1210630cCA16e5430Aa70` (18). Get PepuSwap's token list from `https://raw.githubusercontent.com/0sum-io/tokens/refs/heads/main/pepu-mainnet2.json` rather than hardcoding more.

## Do-not-substitute table

| If you want | Use | Never use |
|---|---|---|
| Batched reads (Multicall3 `aggregate3`) | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` ([Multicall3](multicall3.md)) | PepuSwap's `0x927a…383B` (a Multicall2-style contract with a different function set), and not `0xcA11…CA11`, which has no code |
| Permit2 for your own contracts and libraries | `0x000000000022D473030F116dDEE9F6B43aC78BA3` ([Permit2](permit2.md)) | PepuSwap's `0xB461…8b4B` |
| Integrating with PepuSwap's UI or routers | PepuSwap's own addresses above | The canonical Permit2 (its frontend overrides `PERMIT2_ADDRESS` for chain 97741) |

The two Permit2 deployments respond to `DOMAIN_SEPARATOR()` with different values, so signatures are not interchangeable. The SDK ships separate ABIs (`pepuSwapMulticallAbi`, `pepuSwapPermit2Abi`) so the confusion is visible in types.

## Using the registry

```ts
import { getPepuSwapContract, listPepuSwapContracts } from "@pepu-chain/sdk";

const router = getPepuSwapContract(97741, "swapRouter02");
const all = listPepuSwapContracts(97741);
```

Other PepuSwap ABIs shipped: router, quoter, position manager, V3 factory, V3 pool, tick lens and universal router.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Batched calls to `0x927a…` revert or return the wrong shape | It is not Multicall3 | Use PEPU's Multicall3 |
| Permit2 signature rejected by PepuSwap | Signed for the canonical domain | Sign against PepuSwap's Permit2 domain |
| Quoter call spends gas | Sent as a transaction | Use `eth_call` or `simulateContract` |

## Related

- [Address Map](address-map.md)
- [Deployed Contracts Reference](deployed-contracts.md)
- [The Multicall3 Trap](multicall3.md)
- [Permit2](permit2.md)
