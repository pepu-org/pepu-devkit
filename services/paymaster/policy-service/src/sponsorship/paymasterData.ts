/**
 * paymasterAndData layout for PepuSponsoredPaymasterV7 (mode 1, "sponsored").
 * Authoritative spec: services/paymaster/SPONSORSHIP-SPEC.md section 4.2 and the NatSpec of
 * contracts/src/PepuSponsoredPaymasterV7.sol. This differs from v1 (src/paymasterData.ts) in two ways:
 *
 *   - modeByte is 0x02 (mode 1, allowAllBundlers = 0), because mode 0 is rejected by the v2 contract;
 *   - a 32-byte `sponsorId` follows validUntil/validAfter and is INSIDE the signed prefix, so the signature
 *     commits to which sponsor (project id, or the all-zero free pool) pays.
 *
 *   paymasterAndData = paymaster(20) | pmVerificationGasLimit(16) | pmPostOpGasLimit(16)
 *                    | modeByte(1)=0x02 | validUntil(6) | validAfter(6) | sponsorId(32) | signature(65)
 *   signed prefix    = paymasterAndData[0:97]   (everything except the signature)
 *
 * The hash itself (keccak over sender/nonce/limits/initCode/callData/keccak(prefix), then chainId) is identical to
 * v1 and is reused from ../userOpHash.ts, which takes any prefix.
 */
import { concat, encodeAbiParameters, keccak256, numberToHex, pad, size, toBytes, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import type { ValidityWindow } from "../paymasterData.js";

export const SPONSORED_MODE_BYTE: Hex = "0x02";
export const SPONSORED_PREFIX_LENGTH = 97;
export const SIGNATURE_LENGTH = 65;
/** sponsorId of the chain-owned free pool. */
export const FREE_POOL_ID: Hex = `0x${"00".repeat(32)}`;

export interface SponsoredGasLimits {
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

function uint48BigEndian(value: number): Hex {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffffffff) {
    throw new RangeError(`value ${value} does not fit in a uint48`);
  }
  return pad(numberToHex(BigInt(value)), { size: 6 });
}

/**
 * A project id is `keccak256(bytes(appId))` (the contract's `projectIdOf`): ONE canonical project per Privy app id.
 * Anyone may deposit into it at any time; its settings are controlled by the owner established through a
 * signer-attested claim (see `projectVerify.ts`).
 */
export function projectIdOf(appId: string): Hex {
  return keccak256(toBytes(appId));
}

export function isBytes32Hex(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function assertSponsorId(sponsorId: Hex): void {
  if (!isBytes32Hex(sponsorId)) throw new Error("sponsorId must be a 32-byte hex string");
}

/** The 97-byte slice the contract's `getHash` commits to (everything except the signature). */
export function buildSponsoredHashPrefix(gas: SponsoredGasLimits, window: ValidityWindow, sponsorId: Hex): Hex {
  assertSponsorId(sponsorId);
  const prefix = concat([
    gas.paymaster,
    pad(numberToHex(gas.paymasterVerificationGasLimit), { size: 16 }),
    pad(numberToHex(gas.paymasterPostOpGasLimit), { size: 16 }),
    SPONSORED_MODE_BYTE,
    uint48BigEndian(window.validUntil),
    uint48BigEndian(window.validAfter),
    sponsorId.toLowerCase() as Hex,
  ]);
  if (size(prefix) !== SPONSORED_PREFIX_LENGTH) {
    throw new Error(`internal error: sponsored prefix is ${size(prefix)} bytes, expected ${SPONSORED_PREFIX_LENGTH}`);
  }
  return prefix;
}

/** `paymasterData` in the v0.7 unpacked shape: modeByte | validUntil | validAfter | sponsorId | signature. */
export function buildSponsoredPaymasterData(window: ValidityWindow, sponsorId: Hex, signature: Hex): Hex {
  assertSponsorId(sponsorId);
  if (size(signature) !== SIGNATURE_LENGTH) {
    throw new Error(`signature must be ${SIGNATURE_LENGTH} bytes, got ${size(signature)}`);
  }
  return concat([
    SPONSORED_MODE_BYTE,
    uint48BigEndian(window.validUntil),
    uint48BigEndian(window.validAfter),
    sponsorId.toLowerCase() as Hex,
    signature,
  ]);
}

export interface SignedUserOpFields {
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

/**
 * EntryPoint v0.7's canonical userOpHash for the final op (paymasterAndData INCLUDING our signature). This is the
 * hash emitted by `SponsorReserved` / `UserOpSettled`, which is how the reconciler matches on-chain settlements to
 * approvals. The account's own signature is not part of the hash, so it does not matter that it is not known yet.
 */
export function computeEntryPointUserOpHash(params: {
  userOp: SignedUserOpFields;
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterData: Hex;
  entryPointAddress: Address;
  chainId: number;
}): Hex {
  const { userOp } = params;
  return getUserOperationHash({
    chainId: params.chainId,
    entryPointAddress: params.entryPointAddress,
    entryPointVersion: "0.7",
    userOperation: {
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
      paymaster: params.paymaster,
      paymasterData: params.paymasterData,
      paymasterVerificationGasLimit: params.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: params.paymasterPostOpGasLimit,
      signature: "0x",
    },
  });
}
