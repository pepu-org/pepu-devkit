import { parseAbi } from "viem";

/**
 * ZeroDev Kernel v3 ECDSA validator module ABI, at
 * `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` (deployed on PEPU mainnet
 * only; see `pepuContracts.ecdsaValidator` in `../contracts.js`). This is
 * the ERC-7579 validator module that lets a Kernel account be controlled by
 * a plain ECDSA key (the common case — a Privy/embedded-wallet EOA signs
 * UserOperations on behalf of the smart account).
 *
 * Verified live against mainnet 2026-09-24 via `eth_call`:
 * - `ecdsaValidatorStorage(address)`, called with the zero address, returns
 *   `address(0)` — the expected result for a kernel account that was never
 *   registered, and confirmation the getter itself works.
 * - `isModuleType(1)` returns `true`. `1` is the ERC-7579 `MODULE_TYPE_VALIDATOR`
 *   constant, so this independently confirms the contract both implements
 *   the standard ERC-7579 `IModule` interface and self-reports as a
 *   validator module — not just a contract that happens to expose a
 *   same-named storage getter.
 *
 * `onInstall`/`onUninstall` are part of the same ERC-7579 `IModule`
 * interface `isModuleType` confirmed this contract implements; they take a
 * non-trivial `bytes` payload (the encoded owner address) and mutate state,
 * so — like EntryPoint's `depositTo`/`withdrawTo` — they were not
 * separately simulated. Included because a Kernel account's installation
 * flow calls them, so a caller building that flow needs the selectors.
 */
export const kernelEcdsaValidatorAbi = parseAbi([
  "function ecdsaValidatorStorage(address kernel) view returns (address owner)",
  "function isModuleType(uint256 moduleTypeId) view returns (bool)",
  "function isInitialized(address kernel) view returns (bool)",
  "function onInstall(bytes calldata data) payable",
  "function onUninstall(bytes calldata data) payable",
]);

/**
 * ERC-7579 module type IDs (EIP-7579 §Module Types). `isModuleType` on any
 * conforming module — including {@link kernelEcdsaValidatorAbi}'s contract,
 * confirmed live above — is called with one of these.
 */
export const ERC7579_MODULE_TYPE = {
  validator: 1n,
  executor: 2n,
  fallback: 3n,
  hook: 4n,
} as const;
