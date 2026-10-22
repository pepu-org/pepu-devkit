import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  CALL_TYPE_BATCH,
  CALL_TYPE_SINGLE,
  decodeKernelExecuteCallData,
} from "../src/kernelDecoder.js";
import {
  buildBatchKernelExecuteCallData,
  buildExecuteCallDataWithModeByte,
  buildSingleKernelExecuteCallData,
} from "./helpers/kernelCallData.js";

// Pure-digit addresses so there's no EIP-55 checksum ambiguity for viem to reject.
const TARGET_A = "0x0000000000000000000000000000000000000001" as Address;
const TARGET_B = "0x0000000000000000000000000000000000000002" as Address;

describe("decodeKernelExecuteCallData", () => {
  it("decodes a single-call execute() and extracts the one target", () => {
    const callData = buildSingleKernelExecuteCallData(TARGET_A);
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.callType).toBe(CALL_TYPE_SINGLE);
    expect(result.targets).toEqual([TARGET_A]);
  });

  it("decodes a batch execute() and extracts every target in call order", () => {
    const callData = buildBatchKernelExecuteCallData([
      { target: TARGET_A, value: 0n, callData: "0x" },
      { target: TARGET_B, value: 0n, callData: "0x" },
    ]);
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.callType).toBe(CALL_TYPE_BATCH);
    expect(result.targets).toEqual([TARGET_A, TARGET_B]);
  });

  it("denies a batch execute() with zero executions", () => {
    const callData = buildBatchKernelExecuteCallData([]);
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("batch_empty");
  });

  it("denies callData with a selector other than execute(bytes32,bytes)", () => {
    const result = decodeKernelExecuteCallData("0xdeadbeef00000000000000000000000000000000000000000000000000000000");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_execute_selector");
  });

  it("denies callData too short to even contain a selector", () => {
    const result = decodeKernelExecuteCallData("0xab");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("callData_too_short_for_selector");
  });

  it("denies a static-call-flavored execute (CALLTYPE_STATIC = 0xFE)", () => {
    const callData = buildExecuteCallDataWithModeByte("0xfe");
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_call_type");
  });

  it("denies a delegatecall-flavored execute (CALLTYPE_DELEGATECALL = 0xFF)", () => {
    const callData = buildExecuteCallDataWithModeByte("0xff");
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_call_type");
  });

  it("denies single-call executionCalldata too short to contain target+value", () => {
    const callData = buildExecuteCallDataWithModeByte("0x00", "0x1234"); // way too short (need >= 52 bytes)
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("single_execution_too_short");
  });

  it("denies an unrecognized CallType that is neither single, batch, static, nor delegatecall", () => {
    const callData = buildExecuteCallDataWithModeByte("0x05");
    const result = decodeKernelExecuteCallData(callData);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_call_type");
  });
});
