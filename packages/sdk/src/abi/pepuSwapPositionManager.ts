import { erc721Abi, parseAbi } from "viem";

/**
 * PepuSwap's `NonfungiblePositionManager` ABI subset, at
 * `0xe2060CbdE18b5e765c86e5Cd6EE68AF209a9faa7` on mainnet (see
 * `pepuSwapContracts.positionManager` in `../dex.js`). LP positions on
 * PepuSwap are ERC-721 tokens minted by this contract — on pepuscan they
 * show up as "Launchpad V3 Positions NFT" / `UNI-V3-POS`.
 *
 * Extends viem's own {@link erc721Abi} (this contract genuinely is an
 * ERC-721) with the one PepuSwap/Uniswap-V3-specific read, `positions`.
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 24,384 bytes of bytecode.
 * - `factory()` returns the verified `pepuSwapV3FactoryAbi` address.
 * - `WETH9()` returns the verified WPEPU address.
 *
 * `positions(tokenId)` is the standard Uniswap V3 signature; not
 * independently simulated here since it requires a minted `tokenId`; the
 * verified getters above confirm this is a genuine, matching deployment.
 */
export const pepuSwapPositionManagerAbi = [
  ...erc721Abi,
  ...parseAbi([
    "function factory() view returns (address)",
    "function WETH9() view returns (address)",
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  ]),
] as const;
