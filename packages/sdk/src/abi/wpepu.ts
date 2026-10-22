import { erc20Abi, parseAbi } from "viem";

/**
 * WPEPU (Wrapped Pepe Unchained) ABI.
 *
 * WPEPU is a WETH9-style wrapper around the native PEPU gas token, deployed
 * at `0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8` on mainnet (see
 * `pepuTokenList` in `../tokens.js`). This extends viem's own {@link erc20Abi}
 * with the two WETH9-specific functions and their events, rather than
 * re-declaring the ERC-20 surface from scratch.
 *
 * Verified live against mainnet on 2026-09-24:
 * - `deposit()` and `withdraw(uint256)` both simulate successfully via
 *   `eth_call` (a zero-value deposit and a zero-amount withdraw), confirming
 *   both selectors exist and don't revert.
 * - `decimals()` -> `18`, `symbol()` -> `"WPEPU"`, `name()` -> `"Wrapped PEPU"`.
 * - The contract is verified on pepuscan against the canonical `WETH9`
 *   source.
 */
export const wpepuAbi = [
  ...erc20Abi,
  ...parseAbi([
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "event Deposit(address indexed dst, uint256 amount)",
    "event Withdrawal(address indexed src, uint256 amount)",
  ]),
] as const;
