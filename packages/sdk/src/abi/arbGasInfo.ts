import { parseAbi } from "viem";

/**
 * Arbitrum Nitro's `ArbGasInfo` precompile — lives at the same fixed address
 * on every Arbitrum Orbit/Nitro chain, including PEPU. Exposes the L2
 * execution / L1 data-posting fee breakdown that {@link explainDualFeeModel}
 * (`../gas.js`) describes.
 *
 * Verified live against PEPU mainnet 2026-09-24 via `eth_call`:
 * - `getPricesInWei()` returns `(perL2Tx: 0, perL1CalldataUnit: 0,
 *   perStorageAllocation: 250000000000000000, perArbGasBase: 12500000000000,
 *   perArbGasCongestion: 0, perArbGasTotal: 12500000000000)`. `perArbGasBase`
 *   / `perArbGasTotal` (12,500 gwei) match the block's own `baseFeePerGas`
 *   at the same height, and `perL1CalldataUnit` is `0` — see the module doc
 *   on `../gas.js` for what that means for PEPU's L1 data-posting fee today.
 * - `getL1BaseFeeEstimate()` returns `0`, consistent with the same reading.
 */
export const arbGasInfoAbi = parseAbi([
  "function getPricesInWei() view returns (uint256 perL2Tx, uint256 perL1CalldataUnit, uint256 perStorageAllocation, uint256 perArbGasBase, uint256 perArbGasCongestion, uint256 perArbGasTotal)",
  "function getL1BaseFeeEstimate() view returns (uint256)",
  "function getMinimumGasPrice() view returns (uint256)",
]);

/**
 * Fixed address of the `ArbGasInfo` precompile. Identical on every
 * Arbitrum Orbit/Nitro chain (it's a precompile, not a deployed contract),
 * confirmed responding on PEPU mainnet as noted above.
 */
export const ARB_GAS_INFO_ADDRESS =
  "0x000000000000000000000000000000000000006C" as const;
