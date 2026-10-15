import { parseAbi } from "viem";

/**
 * PepuSwap's `SwapRouter02` ABI subset, at
 * `0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb` on mainnet (see
 * `pepuSwapContracts.swapRouter02` in `../dex.js`).
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 24,497 bytes of bytecode.
 * - `factory()` returns `0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807` — the
 *   independently-verified {@link pepuSwapV3FactoryAbi} address.
 * - `WETH9()` returns `0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8` — the
 *   independently-verified WPEPU address (see `../abi/wpepu.js`).
 *
 * `exactInputSingle`/`exactOutputSingle` are Uniswap's standard SwapRouter02
 * signatures (unchanged across the many chains that run this exact
 * contract); they were not separately simulated because a real swap needs a
 * funded, approved caller. The two verified read functions above confirm
 * this is a genuine, matching SwapRouter02 deployment rather than a
 * same-address coincidence.
 */
export const pepuSwapRouterAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
  "function multicall(uint256 deadline, bytes[] calldata data) payable returns (bytes[] memory results)",
]);
