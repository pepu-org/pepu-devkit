import { parseAbi } from "viem";

/**
 * PepuSwap's own multicall contract, at
 * `0x927af2a6B76d2d8206d93004463F8C122701383B` on mainnet (see
 * `pepuSwapContracts.multicallNonCanonical` in `../dex.js`). **Not**
 * Multicall3 and not interchangeable with `pepuContracts.multicall3` — see
 * that entry's notes.
 *
 * A first pass at verifying this contract tried a Multicall2-style
 * `getBlockNumber()` probe, which reverted, and concluded no ABI could be
 * shipped for it. That probe used the wrong function name: pepuscan
 * (Blockscout) has this contract verified as Uniswap's
 * `UniswapInterfaceMulticall` — "a fork of Multicall2 specifically tailored
 * for the Uniswap Interface" — which exposes `getCurrentBlockTimestamp()`
 * and `getEthBalance(address)` instead of Multicall2's `getBlockNumber()`/
 * `getEthBalance()` pair, plus a `multicall(Call[])` that returns
 * `(blockNumber, Result[])` rather than Multicall3's `(success, returnData)[]`
 * shape (its `Call`/`Result` structs also carry a per-call `gasLimit`/
 * `gasUsed`, which neither Multicall2 nor Multicall3 do the same way) — so
 * it is not a drop-in for either.
 *
 * Verified live against mainnet 2026-09-24:
 * - The ABI below is exactly what pepuscan reports as this contract's
 *   verified source-matched interface.
 * - `getCurrentBlockTimestamp()` returns a value equal to the current
 *   block's own `timestamp` (checked against the same block via
 *   `eth_getBlockByNumber`).
 * - `getEthBalance(0x0)` returns a live, non-zero value (the zero address's
 *   real native-PEPU balance).
 *
 * `multicall(Call[])` was not independently simulated (it needs real
 * `target`/`callData` values per call to return a meaningful result); the
 * two verified getters above are enough to confirm this is a genuine,
 * matching deployment of the verified source, not a same-address
 * coincidence.
 */
export const pepuSwapMulticallAbi = parseAbi([
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
  "function multicall((address target, uint256 gasLimit, bytes callData)[] calls) returns (uint256 blockNumber, (bool success, uint256 gasUsed, bytes returnData)[] returnData)",
]);
