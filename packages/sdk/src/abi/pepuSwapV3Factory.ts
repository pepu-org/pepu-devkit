import { parseAbi } from "viem";

/**
 * PepuSwap's Uniswap V3 core factory ABI, at
 * `0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807` on mainnet (see
 * `pepuSwapContracts.v3Factory` in `../dex.js`). PepuSwap is a Uniswap V3
 * fork; this is a standard `UniswapV3Factory` ABI subset.
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 24,535 bytes of bytecode.
 * - `owner()` returns a live, non-zero address.
 * - `getPool(WPEPU, USDT, fee)` returns a real, non-zero pool address for
 *   fee tiers 100/500/3000/10000, and that pool's own `token0()`/`token1()`
 *   independently resolve to USDT/WPEPU.
 * - Four independent contracts on this chain (SwapRouter02,
 *   NonfungiblePositionManager, QuoterV2, V3Migrator, V3Staker) each
 *   read their own `factory()` immutable and all five return this exact
 *   address — see the notes on each of their ABI files.
 */
export const pepuSwapV3FactoryAbi = parseAbi([
  "function owner() view returns (address)",
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
  "function feeAmountTickSpacing(uint24 fee) view returns (int24)",
  "function createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)",
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
]);
