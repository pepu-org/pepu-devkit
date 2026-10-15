import { parseAbi } from "viem";

/**
 * PepuSwap's `UniversalRouter` ABI, at
 * `0x0dE72b751b77d3c74fB96C5fAd0320Cd8d133d36` on mainnet (see
 * `pepuSwapContracts.universalRouter` in `../dex.js`). UniversalRouter is a
 * command-dispatcher contract — almost everything routes through the one
 * `execute` entrypoint below, with a `commands` byte-string selecting which
 * internal actions run.
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 17,958 bytes of bytecode.
 * - Unlike the other PepuSwap contracts, UniversalRouter does not expose
 *   its configured Permit2/factory addresses through public getters (a
 *   `PERMIT2()`/`V2_FACTORY()`/`V3_FACTORY()`/`poolManager()` probe all
 *   reverted — expected, since a dispatcher contract with no matching
 *   function selector just reverts, it doesn't imply anything is wrong).
 * - Instead, `execute(bytes,bytes[],uint256)` was called directly via
 *   `eth_call` with an empty `commands` byte-string, an empty `inputs`
 *   array, and a far-future deadline. It returned successfully with no
 *   revert — confirming the exact function selector Uniswap's
 *   `UniversalRouter` uses, dispatched correctly with zero commands to run.
 */
export const pepuSwapUniversalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);
