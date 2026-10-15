import { parseAbi } from "viem";

/**
 * PepuSwap's `QuoterV2` ABI subset, at
 * `0xd647b2D80b48e93613Aa6982b85f8909578b4829` on mainnet (see
 * `pepuSwapContracts.quoterV2` in `../dex.js`).
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 8,273 bytes of bytecode.
 * - `factory()` returns the verified `pepuSwapV3FactoryAbi` address.
 * - `WETH9()` returns the verified WPEPU address.
 *
 * `quoteExactInputSingle`/`quoteExactOutputSingle` are QuoterV2's standard
 * signatures. Like the router's swap functions, they weren't independently
 * simulated here (a quote needs a real, liquid pool + valid amounts to
 * return a meaningful result, not just "doesn't revert"); the two verified
 * getters above confirm this is a genuine, matching QuoterV2 deployment.
 * QuoterV2 is gas-inefficient by design (it's meant to be called off-chain
 * via `eth_call`, e.g. through `client.simulateContract`) — never send it a
 * real transaction.
 */
export const pepuSwapQuoterAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
