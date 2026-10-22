import { parseAbi } from "viem";

/**
 * Minimal Uniswap V3 pool ABI for reading a PepuSwap pool's state — enough
 * to price a pair and locate its liquidity, without the full swap/mint/burn
 * surface.
 *
 * Verified live against mainnet 2026-09-24 against the real WPEPU/USDT
 * 0.3% pool (`0x4bE3Af53800AADE09201654CD76D55063c7bdE70`, returned by
 * `pepuSwapV3FactoryAbi`'s `getPool`):
 * - `slot0()` decodes cleanly into the standard 7-field tuple (a live tick
 *   of 372469 at the time of verification).
 * - `tickSpacing()` returns `60`, the standard spacing for a 0.3% pool.
 * - `token0()`/`token1()` return USDT/WPEPU respectively, matching the
 *   factory's `getPool` inputs.
 */
export const pepuSwapV3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);
