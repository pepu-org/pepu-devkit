import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  slice,
} from "viem";
import type { Hex } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";

import { encodeKernelExecute, userOpEventsFromReceipt } from "../src/aa/calls.js";
import * as aa from "../src/aa/index.js";

const A = "0x00000000000000000000000000000000000000aa" as const;
const B = "0x00000000000000000000000000000000000000bb" as const;
const EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const tapAbi = parseAbi(["function tap()", "function add(uint256 n)"]);

const EXECUTE = parseAbi(["function execute(bytes32 execMode, bytes executionCalldata)"]);
const mode = (n: string): Hex => `0x${n}${"00".repeat(31)}`;

describe("encodeKernelExecute", () => {
  it("one call: single mode, packed target ++ value ++ data", () => {
    const data = encodeKernelExecute([{ to: A, abi: tapAbi, functionName: "tap" }]);
    const { functionName, args } = decodeFunctionData({ abi: EXECUTE, data });
    expect(functionName).toBe("execute");
    expect(args?.[0]).toBe(mode("00"));
    const packed = args?.[1] as Hex;
    const tapData = encodeFunctionData({ abi: tapAbi, functionName: "tap" });
    expect(slice(packed, 0, 20).toLowerCase()).toBe(A);
    expect(BigInt(slice(packed, 20, 52))).toBe(0n);
    expect(slice(packed, 52)).toBe(tapData);
  });

  it("carries value in single mode", () => {
    const data = encodeKernelExecute([{ to: A, value: 5n, data: "0x1234" }]);
    const packed = decodeFunctionData({ abi: EXECUTE, data }).args?.[1] as Hex;
    expect(BigInt(slice(packed, 20, 52))).toBe(5n);
    expect(slice(packed, 52)).toBe("0x1234");
  });

  it("several calls: batch mode, ABI-encoded Execution[]", () => {
    const data = encodeKernelExecute([
      { to: A, abi: tapAbi, functionName: "add", args: [7n] },
      { to: B, value: 1n },
    ]);
    const { args } = decodeFunctionData({ abi: EXECUTE, data });
    expect(args?.[0]).toBe(mode("01"));
    const [execs] = decodeAbiParameters(
      [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
      args?.[1] as Hex,
    );
    expect(execs).toHaveLength(2);
    expect(execs[0]?.target.toLowerCase()).toBe(A);
    expect(execs[0]?.callData).toBe(encodeFunctionData({ abi: tapAbi, functionName: "add", args: [7n] }));
    expect(execs[1]).toMatchObject({ value: 1n, callData: "0x" });
  });

  it("rejects an empty list and is exported from /aa", () => {
    expect(() => encodeKernelExecute([])).toThrow();
    expect(aa.encodeKernelExecute).toBe(encodeKernelExecute);
  });
});

function opLog(sender: Hex, hash: Hex, paymaster: Hex, success: boolean, cost: bigint, nonce: bigint) {
  const topics = encodeEventTopics({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    args: { userOpHash: hash, sender, paymaster },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
    [nonce, success, cost, 99n],
  );
  return { address: EP, topics, data } as never;
}

describe("userOpEventsFromReceipt", () => {
  it("returns every UserOperationEvent without knowing the sender", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    const pm = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0";
    const events = userOpEventsFromReceipt({
      logs: [
        opLog(A, `0x${"11".repeat(32)}`, pm, true, 1234n, 3n),
        opLog(B, `0x${"22".repeat(32)}`, zero, false, 7n, 0n),
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ userOpHash: `0x${"11".repeat(32)}`, success: true, actualGasCost: 1234n, nonce: 3n, actualGasUsed: 99n });
    expect(events[0]?.sender.toLowerCase()).toBe(A);
    expect(events[0]?.paymaster?.toLowerCase()).toBe(pm.toLowerCase());
    expect(events[1]).toMatchObject({ success: false, paymaster: null });
  });

  it("returns an empty list for a receipt with no events", () => {
    expect(userOpEventsFromReceipt({ logs: [] })).toEqual([]);
    expect(aa.userOpEventsFromReceipt).toBe(userOpEventsFromReceipt);
  });
});
