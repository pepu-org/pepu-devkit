import { parseAbi } from "viem";

/**
 * PepuSwap's `TickLens` ABI, at
 * `0x4EB8aA84c066f9bf210eAfE33B30AE49BfafD9a6` on mainnet (see
 * `pepuSwapContracts.tickLens` in `../dex.js`). `TickLens` is stateless
 * (it takes a pool address as an argument to every call rather than storing
 * one), so it has no zero-argument getter to probe.
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 1,385 bytes of bytecode.
 * - `getPopulatedTicksInWord(pool, wordPosition)` was called against the
 *   real WPEPU/USDT 0.3% pool (`0x4bE3Af53800AADE09201654CD76D55063c7bdE70`)
 *   at the word position derived from that pool's own live `slot0().tick`
 *   and `tickSpacing()`. It returned successfully (an empty populated-ticks
 *   array for that particular word, which is itself a valid, non-reverting
 *   result) — confirming the exact function selector against a real pool.
 */
export const pepuSwapTickLensAbi = parseAbi([
  "function getPopulatedTicksInWord(address pool, int16 tickBitmapIndex) view returns ((int24 tick, int128 liquidityNet, uint128 liquidityGross)[] populatedTicks)",
]);
