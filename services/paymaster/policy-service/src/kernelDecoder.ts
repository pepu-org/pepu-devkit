/**
 * Narrow, explicit decoder for Kernel v3 (ERC-7579) `execute(bytes32,bytes)`
 * calldata — the ONE well-understood UserOp shape this service will ever
 * sponsor. Anything else (a different selector, an unsupported CallType, or
 * malformed bytes) is an automatic denial, not a "best effort" decode.
 *
 * Verified directly against cached local copies of ZeroDev Kernel's
 * upstream source (`github.com/zerodevapp/kernel`, main branch:
 * `IERC7579Account.sol`, `ExecLib.sol`, `Constants.sol`) fetched
 * during this session — NOT re-fetched live from GitHub (no network fetch
 * tool was used for this; see policy-service/README.md "What was
 * independently re-verified vs taken on trust" for the honest accounting).
 * What WAS independently re-derived in this session (not just trusted from
 * the cache or the brief) is the function selector: computed live via
 * `viem`'s `toFunctionSelector("function execute(bytes32 mode, bytes executionCalldata)")`,
 * which returned `0xe9ae5c53`, matching the brief exactly.
 *
 * Confirmed from the cached source:
 * - `Constants.sol`: CALLTYPE_SINGLE = 0x00, CALLTYPE_BATCH = 0x01,
 *   CALLTYPE_STATIC = 0xFE, CALLTYPE_DELEGATECALL = 0xFF (the mode's most
 *   significant byte).
 * - `ExecLib.decodeSingle`: `target = bytes20(executionCalldata[0:20])`,
 *   `value = uint256(executionCalldata[20:52])`,
 *   `callData = executionCalldata[52:]` — encodePacked, plain concatenation.
 * - `ExecLib.decodeBatch`: standard `abi.decode(executionCalldata, (Execution[]))`
 *   where `Execution = (address target, uint256 value, bytes callData)`.
 *
 * This module is intentionally narrow: it does not attempt to special-case
 * `executeFromExecutor`, `installModule`, EIP-7702-flavored calldata, or any
 * other Kernel entry point. If callData doesn't match the one supported
 * pattern exactly, sponsorship is denied.
 */
import { decodeAbiParameters, size, slice, type Address, type Hex } from "viem";

/** `cast sig "execute(bytes32,bytes)"`, independently re-derived via viem in this session. */
export const KERNEL_EXECUTE_SELECTOR = "0xe9ae5c53" as const;

export const CALL_TYPE_SINGLE = 0x00;
export const CALL_TYPE_BATCH = 0x01;
export const CALL_TYPE_STATIC = 0xfe;
export const CALL_TYPE_DELEGATECALL = 0xff;

export type KernelDecodeFailureReason =
  | "callData_too_short_for_selector"
  | "not_execute_selector"
  | "callData_too_short_for_mode"
  | "unsupported_call_type"
  | "single_execution_too_short"
  | "batch_decode_failed"
  | "batch_empty";

export interface KernelDecodeSuccess {
  ok: true;
  callType: typeof CALL_TYPE_SINGLE | typeof CALL_TYPE_BATCH;
  /** Every destination address this UserOp would call, in call order. */
  targets: Address[];
}

export interface KernelDecodeFailure {
  ok: false;
  reason: KernelDecodeFailureReason;
  /** Human-readable detail for logs/audit trail — never contains secrets. */
  detail: string;
}

export type KernelDecodeResult = KernelDecodeSuccess | KernelDecodeFailure;

const EXECUTION_TUPLE_ARRAY_ABI = [
  {
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" },
    ],
  },
] as const;

/**
 * Decode a top-level UserOp `callData` under the assumption it is a Kernel
 * v3 `execute(bytes32 mode, bytes executionCalldata)` call, extracting every
 * destination `target`. Returns a structured failure (never throws) for
 * anything that doesn't match — callers must treat every failure as "deny
 * sponsorship", per the brief.
 */
export function decodeKernelExecuteCallData(callData: Hex): KernelDecodeResult {
  if (size(callData) < 4) {
    return {
      ok: false,
      reason: "callData_too_short_for_selector",
      detail: `callData is ${size(callData)} bytes, need at least 4 for a selector`,
    };
  }

  const selector = slice(callData, 0, 4);
  if (selector.toLowerCase() !== KERNEL_EXECUTE_SELECTOR) {
    return {
      ok: false,
      reason: "not_execute_selector",
      detail: `selector ${selector} is not execute(bytes32,bytes) (${KERNEL_EXECUTE_SELECTOR}); refusing to special-case any other Kernel entry point`,
    };
  }

  // The remaining bytes are the standard ABI encoding of (bytes32, bytes).
  // mode occupies the first 32-byte word; executionCalldata is ABI-encoded
  // as a dynamic `bytes` after it. Decode with viem rather than hand-slicing
  // offsets, since the dynamic-bytes offset/length header is standard ABI
  // encoding, not part of the Kernel-specific layout we're trusting the
  // cached source for.
  const encodedArgs = slice(callData, 4);
  if (size(encodedArgs) < 32) {
    return {
      ok: false,
      reason: "callData_too_short_for_mode",
      detail: `only ${size(encodedArgs)} bytes after the selector, need at least 32 for mode`,
    };
  }

  let mode: Hex;
  let executionCalldata: Hex;
  try {
    [mode, executionCalldata] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes" }],
      encodedArgs,
    );
  } catch (error) {
    return {
      ok: false,
      reason: "callData_too_short_for_mode",
      detail: `failed to ABI-decode (bytes32 mode, bytes executionCalldata): ${String(error)}`,
    };
  }

  // mode's most significant byte (byte 0 of the bytes32 word) is the
  // CallType per ERC-7579's mode encoding (confirmed against Constants.sol
  // above). slice(mode, 0, 1) reads that first byte.
  const callTypeByte = parseInt(slice(mode, 0, 1).slice(2), 16);

  if (callTypeByte === CALL_TYPE_STATIC || callTypeByte === CALL_TYPE_DELEGATECALL) {
    return {
      ok: false,
      reason: "unsupported_call_type",
      detail: `mode byte 0x${callTypeByte.toString(16).padStart(2, "0")} is static-call or delegatecall-flavored execute; never sponsored regardless of target`,
    };
  }

  if (callTypeByte === CALL_TYPE_SINGLE) {
    // target(20) || value(32) || callData(rest), plain concatenation (encodePacked).
    if (size(executionCalldata) < 52) {
      return {
        ok: false,
        reason: "single_execution_too_short",
        detail: `single-call executionCalldata is ${size(executionCalldata)} bytes, need at least 52 (target20+value32)`,
      };
    }
    const target = slice(executionCalldata, 0, 20) as Address;
    return { ok: true, callType: CALL_TYPE_SINGLE, targets: [target] };
  }

  if (callTypeByte === CALL_TYPE_BATCH) {
    let decoded: readonly { target: Address; value: bigint; callData: Hex }[];
    try {
      [decoded] = decodeAbiParameters(EXECUTION_TUPLE_ARRAY_ABI, executionCalldata) as [
        readonly { target: Address; value: bigint; callData: Hex }[],
      ];
    } catch (error) {
      return {
        ok: false,
        reason: "batch_decode_failed",
        detail: `failed to ABI-decode Execution[]: ${String(error)}`,
      };
    }
    if (decoded.length === 0) {
      return {
        ok: false,
        reason: "batch_empty",
        detail: "batch execute() with zero Executions — nothing to sponsor",
      };
    }
    return {
      ok: true,
      callType: CALL_TYPE_BATCH,
      targets: decoded.map((execution) => execution.target),
    };
  }

  return {
    ok: false,
    reason: "unsupported_call_type",
    detail: `mode byte 0x${callTypeByte.toString(16).padStart(2, "0")} is neither single (0x00) nor batch (0x01)`,
  };
}
