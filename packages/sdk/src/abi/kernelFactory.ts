import { parseAbi } from "viem";

/**
 * ZeroDev Kernel v3 account factory ABI, at
 * `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` (deployed on PEPU mainnet
 * only; see `pepuContracts.kernelFactory` in `../contracts.js`).
 *
 * Verified live against mainnet 2026-09-24 via `eth_call`:
 * - `implementation()` returns `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` —
 *   ZeroDev's Kernel v3.1 singleton implementation address, deployed at the
 *   same address on every chain that has it via CREATE2.
 * - `getAddress(bytes,bytes32)`, called with empty `data` and a zero salt,
 *   returns a computed address without reverting.
 * - `createAccount(bytes,bytes32)`, simulated (not sent) with the same
 *   empty `data` and zero salt via `eth_call`, returns the **same** address
 *   `getAddress` computed for those inputs — exactly the counterfactual-
 *   address behavior a CREATE2 account factory is supposed to have.
 *
 * What this package does NOT ship: a helper that encodes the `data`
 * argument (Kernel v3.1's `initialize(...)` calldata — root validator,
 * hook, validator data, hook data, init config). No account has ever been
 * created through this factory on PEPU yet (its transaction history is
 * empty as of the verification date above), so there was nothing on-chain
 * to check a hand-rolled encoding against, and guessing one here would be
 * exactly the kind of invented byte layout this package's rules forbid.
 * Use ZeroDev's own `@zerodev/sdk` (or the public Kernel contracts source)
 * to build that payload, then pass the resulting bytes into
 * `getAddress`/`createAccount` from this ABI.
 */
export const kernelFactoryAbi = parseAbi([
  "function implementation() view returns (address)",
  "function getAddress(bytes calldata data, bytes32 salt) view returns (address)",
  "function createAccount(bytes calldata data, bytes32 salt) payable returns (address)",
]);

/**
 * The verified Kernel v3.1 singleton implementation address that
 * `kernelFactoryAbi`'s `implementation()` resolves to on PEPU mainnet. Same
 * address ZeroDev uses across every chain that has this Kernel version.
 */
export const KERNEL_V3_1_IMPLEMENTATION_ADDRESS =
  "0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d" as const;
