/**
 * Reproduces, byte-for-byte, the hash Pimlico's `SingletonPaymasterV7.sol`
 * (`BaseSingletonPaymaster._getHash`, verifying-mode path) computes over a
 * v0.7 UserOperation, plus the EIP-191 personal-sign step the contract
 * recovers with OpenZeppelin's `ECDSA.recover(toEthSignedMessageHash(...))`.
 *
 * Source of truth (per the engineering brief, read directly by the brief's
 * author against `github.com/pimlicolabs/singleton-paymaster` commit
 * `1e2305d1102242379b582142f62bd17add12b8c2`, `BaseSingletonPaymaster.sol`):
 *
 *   userOpHash = keccak256(abi.encode(
 *     userOp.sender,               // address
 *     userOp.nonce,                // uint256
 *     userOp.accountGasLimits,     // bytes32 (verificationGasLimit<<128 | callGasLimit)
 *     userOp.preVerificationGas,   // uint256
 *     userOp.gasFees,              // bytes32 (maxPriorityFeePerGas<<128 | maxFeePerGas)
 *     keccak256(userOp.initCode),
 *     keccak256(userOp.callData),
 *     keccak256(paymasterAndData[0:65])   // EXCLUDES the signature
 *   ))
 *   finalHash = keccak256(abi.encode(userOpHash, block.chainid))
 *   signature = ECDSA.sign(toEthSignedMessageHash(finalHash), signerKey)
 *
 * This module does NOT re-derive `accountGasLimits`/`gasFees`/`initCode`
 * packing by hand — it delegates to viem's own
 * `toPackedUserOperation` (`viem/account-abstraction`), read directly at
 * `node_modules/.pnpm/viem@2.56.8_.../node_modules/viem/account-abstraction/utils/userOperation/toPackedUserOperation.ts`
 * before writing this file, specifically to avoid hand-rolling the uint128
 * high/low packing (a well-known source of off-by-one/byte-order bugs).
 * Confirmed there: `accountGasLimits = concat([pad(verificationGasLimit,16), pad(callGasLimit,16)])`
 * and `gasFees = concat([pad(maxPriorityFeePerGas,16), pad(maxFeePerGas,16)])` —
 * i.e. exactly the high-128-bits-first packing the contract expects.
 *
 * The EIP-191 personal-sign step is verified against viem's own source
 * (`viem/accounts/utils/signMessage.ts` -> `hashMessage` ->
 * `toPrefixedMessage`, all read directly before writing this file): passing
 * `{ raw: finalHash }` (a 32-byte hex value) as the message makes
 * `toPrefixedMessage` prefix it with
 * `"\x19Ethereum Signed Message:\n" + size(message)` where `size(message)`
 * is computed from the raw bytes (== 32 for a bytes32), which is exactly
 * OpenZeppelin's `toEthSignedMessageHash(bytes32)` behavior. This was
 * independently re-verified in this session, not merely taken on the
 * brief's word — see policy-service/README.md "What was independently
 * re-verified vs taken on trust".
 */
import {
  concat,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { toPackedUserOperation } from "viem/account-abstraction";
import type { LocalAccount } from "viem/accounts";

/**
 * The subset of a v0.7 "unpacked" UserOperation this module needs to
 * compute the hash. Deliberately mirrors the JSON-RPC `eth_sendUserOperation`
 * shape (factory/factoryData rather than a single initCode blob) since
 * that's what a bundler and `viem/account-abstraction` both expect — see
 * `getInitCode.ts`, read directly before writing this file.
 */
export interface HashableUserOperation {
  sender: Address;
  nonce: bigint;
  factory?: Address | undefined;
  factoryData?: Hex | undefined;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The 65-byte pre-signature paymaster data slice — see paymasterData.ts. */
export type PaymasterAndDataPrefix = Hex;

/**
 * Computes `userOpHash` (the inner `keccak256(abi.encode(...))` in the
 * contract) exactly as `BaseSingletonPaymaster._getHash` does for a v0.7 op.
 */
export function computeUserOpHash(
  userOp: HashableUserOperation,
  paymasterAndDataPrefix: PaymasterAndDataPrefix,
): Hex {
  // Delegate accountGasLimits/gasFees/initCode packing to viem's verified
  // implementation. We deliberately do NOT pass paymaster fields here — we
  // only want the account-side packed fields; the paymaster hash input is
  // built separately (see paymasterData.ts) because it must exclude the
  // eventual signature, which toPackedUserOperation's own paymasterAndData
  // concatenation is not aware of at this stage.
  const packed = toPackedUserOperation({
    sender: userOp.sender,
    nonce: userOp.nonce,
    factory: userOp.factory,
    factoryData: userOp.factoryData,
    callData: userOp.callData,
    callGasLimit: userOp.callGasLimit,
    verificationGasLimit: userOp.verificationGasLimit,
    preVerificationGas: userOp.preVerificationGas,
    maxFeePerGas: userOp.maxFeePerGas,
    maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
    signature: "0x",
  });

  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        userOp.sender,
        userOp.nonce,
        packed.accountGasLimits,
        userOp.preVerificationGas,
        packed.gasFees,
        keccak256(packed.initCode),
        keccak256(userOp.callData),
        keccak256(paymasterAndDataPrefix),
      ],
    ),
  );
}

/** `finalHash = keccak256(abi.encode(userOpHash, chainId))`. */
export function computeFinalHash(userOpHash: Hex, chainId: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [userOpHash, BigInt(chainId)],
    ),
  );
}

/**
 * Signs `finalHash` the way the contract expects to recover it:
 * `ECDSA.recover(toEthSignedMessageHash(finalHash), signature)`. In viem,
 * `account.signMessage({ message: { raw: finalHash } })` produces exactly
 * this EIP-191 personal-sign signature over a raw 32-byte hash — see the
 * module doc comment above for the verification trail.
 */
export async function signFinalHash(
  account: LocalAccount,
  finalHash: Hex,
): Promise<Hex> {
  return account.signMessage({ message: { raw: finalHash } });
}

/** Convenience: pad + concat helpers re-exported so callers building the
 * paymasterData prefix (paymasterData.ts) use the same primitives this
 * module trusts, instead of reinventing padding elsewhere. */
export const hashUtils = { concat, pad, toHex, keccak256 };
