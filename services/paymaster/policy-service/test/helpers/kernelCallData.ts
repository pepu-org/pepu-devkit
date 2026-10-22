/**
 * Test-only helper: builds Kernel v3 `execute(bytes32,bytes)` callData for a
 * single call, matching exactly what `src/kernelDecoder.ts` expects to
 * decode (same selector, same mode/executionCalldata layout -- see that
 * module's doc comment for the verification trail this mirrors). Kept out
 * of `src/` deliberately: this is fixture-construction for tests, not
 * production decoding logic.
 */
import { concatHex, encodeAbiParameters, pad, toHex, type Address, type Hex } from "viem";

const KERNEL_EXECUTE_SELECTOR = "0xe9ae5c53" as const;
// IMPORTANT: `dir: "right"` is load-bearing here, not the default `"left"`.
// The mode's CallType occupies the FIRST (most significant) byte of the
// bytes32 word (kernelDecoder.ts reads it via `slice(mode, 0, 1)`), so the
// call-type byte must be padded on the right (zeros trailing), not the left
// (zeros leading) -- the latter would put the byte in the LAST position
// instead and silently produce a different (wrong) CallType.
const CALL_TYPE_SINGLE_MODE = pad("0x00", { size: 32, dir: "right" });

export function buildSingleKernelExecuteCallData(
  target: Address,
  value: bigint = 0n,
  innerCallData: Hex = "0x",
): Hex {
  const executionCalldata = concatHex([target, pad(toHex(value), { size: 32 }), innerCallData]);
  const encodedArgs = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes" }],
    [CALL_TYPE_SINGLE_MODE, executionCalldata],
  );
  return concatHex([KERNEL_EXECUTE_SELECTOR, encodedArgs]);
}

const CALL_TYPE_BATCH_MODE = pad("0x01", { size: 32, dir: "right" });

/** For tests that need an arbitrary/invalid CallType byte (e.g. 0xFE, 0xFF). */
export function buildExecuteCallDataWithModeByte(callTypeByte: Hex, executionCalldata: Hex = "0x"): Hex {
  const mode = pad(callTypeByte, { size: 32, dir: "right" });
  const encodedArgs = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes" }], [mode, executionCalldata]);
  return concatHex([KERNEL_EXECUTE_SELECTOR, encodedArgs]);
}

export function buildBatchKernelExecuteCallData(
  executions: readonly { target: Address; value: bigint; callData: Hex }[],
): Hex {
  const executionCalldata = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    [executions],
  );
  const encodedArgs = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes" }],
    [CALL_TYPE_BATCH_MODE, executionCalldata],
  );
  return concatHex([KERNEL_EXECUTE_SELECTOR, encodedArgs]);
}
