import { parseAbi } from "viem";

/**
 * ERC-4337 EntryPoint v0.7 ABI — the subset a dapp actually needs to manage
 * a smart account's gas deposit and read its nonce, at the canonical address
 * `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (deployed on PEPU mainnet
 * only; see `pepuContracts.entryPoint07` in `../contracts.js`).
 *
 * This is NOT the full `IEntryPoint` interface (no `handleOps`,
 * `simulateValidation`, etc.) — those are normally called by a bundler, and
 * PEPU has no publicly hosted bundler yet (see `getSponsorshipStatus` in
 * `../aa/status.js`). This ABI only covers deposit/nonce management, which works
 * today with a plain viem wallet client and no bundler at all.
 *
 * Verified live against mainnet 2026-09-24 via `eth_call`:
 * - `getNonce(address,uint192)` for the zero address/key returns `0`.
 * - `balanceOf(address)` for the zero address returns `0`.
 * - `getDepositInfo(address)` for the zero address returns a 5-word
 *   (all-zero) tuple, matching the v0.7 `DepositInfo` struct shape
 *   `(uint256 deposit, bool staked, uint96 stake, uint32 unstakeDelaySec,
 *   uint48 withdrawTime)` field-for-field.
 * `depositTo`/`withdrawTo` share the same `IStakeManager` interface as the
 * verified `getDepositInfo`/`balanceOf` pair and are standard across every
 * EntryPoint version; they were not separately simulated (both mutate
 * state, and simulating a withdrawal from an empty deposit would only prove
 * it reverts, not that it works).
 */
export const entryPointV07Abi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
  "function balanceOf(address account) view returns (uint256)",
  "function depositTo(address account) payable",
  "function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount)",
  "function getDepositInfo(address account) view returns ((uint256 deposit, bool staked, uint96 stake, uint32 unstakeDelaySec, uint48 withdrawTime) info)",
  "event Deposited(address indexed account, uint256 totalDeposit)",
  "event Withdrawn(address indexed account, address withdrawAddress, uint256 amount)",
]);
