/**
 * Byte layout for EntryPoint v0.7's `paymasterAndData` blob and the
 * "unpacked" JSON-RPC `paymasterData` field, for Pimlico's
 * `SingletonPaymasterV7` verifying mode. Per the engineering brief (verified
 * against `BaseSingletonPaymaster.sol` / `SingletonPaymasterV7.sol`):
 *
 *   paymasterAndData = paymaster(20) || paymasterVerificationGasLimit(16)
 *                       || paymasterPostOpGasLimit(16) || paymasterData(...)
 *   PAYMASTER_DATA_OFFSET = 52  (20 + 16 + 16)
 *
 *   paymasterData (verifying mode, mode = 0) =
 *     modeByte(1) || validUntil(6, BE uint48) || validAfter(6, BE uint48) || signature(65)
 *
 *   modeByte's low bit = allowAllBundlers (0 here: this paymaster restricts
 *   to on-chain-allowlisted bundlers, a contract-level concern, but the bit
 *   signed over must match what's submitted). modeByte's high 7 bits
 *   (combinedByte >> 1) = mode, which must be 0 for verifying mode.
 *   => modeByte is always 0x00 for this service.
 *
 *   paymasterAndData[0:65] (the slice `_getHash` commits to, EXCLUDING the
 *   signature) = paymaster(20) || pmVerificationGasLimit(16) ||
 *                pmPostOpGasLimit(16) || modeByte(1) || validUntil(6) || validAfter(6)
 *   = exactly 65 bytes.
 */
import { concat, numberToHex, pad, size, type Address, type Hex } from "viem";

/** Always 0 for this service: verifying mode (bits 1-7) + allowAllBundlers=0 (bit 0). */
export const MODE_BYTE: Hex = "0x00";

/** 20 (paymaster) + 16 (pmVerificationGasLimit) + 16 (pmPostOpGasLimit). */
export const PAYMASTER_DATA_OFFSET = 52;

/** paymaster(20) + pmVerificationGasLimit(16) + pmPostOpGasLimit(16) + modeByte(1) + validUntil(6) + validAfter(6). */
export const PAYMASTER_HASH_PREFIX_LENGTH = 65;

/** ECDSA signature length (r(32) + s(32) + v(1)). */
export const SIGNATURE_LENGTH = 65;

export interface PaymasterGasLimits {
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

export interface ValidityWindow {
  /** Unix seconds, uint48. */
  validUntil: number;
  /** Unix seconds, uint48. */
  validAfter: number;
}

function uint48BigEndian(value: number): Hex {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffffffff) {
    throw new RangeError(`value ${value} does not fit in a uint48`);
  }
  return pad(numberToHex(BigInt(value)), { size: 6 });
}

/**
 * Builds the 65-byte `paymasterAndData[0:65]` slice that `_getHash` commits
 * to — i.e. everything EXCEPT the trailing 65-byte signature. This is what
 * gets keccak256'd and placed into the outer `abi.encode` in
 * `computeUserOpHash` (see userOpHash.ts).
 */
export function buildPaymasterHashPrefix(
  gasLimits: PaymasterGasLimits,
  window: ValidityWindow,
): Hex {
  const prefix = concat([
    gasLimits.paymaster,
    pad(numberToHex(gasLimits.paymasterVerificationGasLimit), { size: 16 }),
    pad(numberToHex(gasLimits.paymasterPostOpGasLimit), { size: 16 }),
    MODE_BYTE,
    uint48BigEndian(window.validUntil),
    uint48BigEndian(window.validAfter),
  ]);
  if (size(prefix) !== PAYMASTER_HASH_PREFIX_LENGTH) {
    throw new Error(
      `internal error: paymaster hash prefix is ${size(prefix)} bytes, expected ${PAYMASTER_HASH_PREFIX_LENGTH}`,
    );
  }
  return prefix;
}

/**
 * Builds the full `paymasterData` field for the v0.7 "unpacked" JSON-RPC
 * UserOperation shape: `modeByte || validUntil || validAfter || signature`
 * (i.e. the 65-byte hash prefix's mode/validUntil/validAfter portion, minus
 * the leading `paymaster`/gas-limit fields which are separate top-level RPC
 * fields, plus the signature appended).
 */
export function buildPaymasterData(window: ValidityWindow, signature: Hex): Hex {
  if (size(signature) !== SIGNATURE_LENGTH) {
    throw new Error(
      `signature must be ${SIGNATURE_LENGTH} bytes, got ${size(signature)}`,
    );
  }
  return concat([
    MODE_BYTE,
    uint48BigEndian(window.validUntil),
    uint48BigEndian(window.validAfter),
    signature,
  ]);
}

/**
 * Computes `[validAfter, validUntil]` for a short signing window that
 * starts `nowSeconds` (default: now) and lasts `windowSeconds`. Per the
 * brief: this bounds how long a captured-but-unsubmitted signature stays
 * valid (AA nonce replay protection is EntryPoint's job, not this window's).
 */
export function computeValidityWindow(
  windowSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): ValidityWindow {
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new RangeError("windowSeconds must be a positive integer");
  }
  return { validAfter: nowSeconds, validUntil: nowSeconds + windowSeconds };
}
