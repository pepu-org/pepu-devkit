/**
 * pepu_encode_calls
 *
 * WHAT: ABI-encodes one or more contract calls (viem `encodeFunctionData`)
 * from an ABI or a Solidity signature, and optionally wraps them:
 *
 *  - "calldata":        each call's calldata, as is.
 *  - "multicall3":      one `aggregate3` call to PEPU's Multicall3 (NOT the
 *                       canonical address), via the SDK's `encodeAggregate3`
 *                       and `getMulticall3`.
 *  - "kernel-execute" / "userop-callData": the ERC-7579 `execute` calldata a
 *                       Kernel v3 account puts in a UserOperation's callData
 *                       (single mode for one call, batch mode for several).
 *
 * Pure: nothing is signed or sent.
 */

import { z } from "zod";
import { encodeAbiParameters, encodeFunctionData, encodePacked, isAddress, isHex, pad, size, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encodeAggregate3, getMulticall3 } from "@pepu-chain/sdk";
import { STATIC_READ } from "../annotations.js";
import { coerceArgs, findFunctionInAbi, parseFunctionInput, type FunctionInput } from "../abi-input.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { sdkCall } from "../sdk-helpers.js";

const callSchema = z.object({
  to: z.string().describe("Target contract address (0x...)."),
  signature: z.string().optional().describe("Solidity signature, e.g. 'transfer(address to, uint256 amount)'. Give signature, or abi plus functionName."),
  abi: z.array(z.record(z.string(), z.unknown())).optional().describe("JSON ABI (full or just the one function). Use with functionName."),
  functionName: z.string().optional().describe("Function to call in abi."),
  args: z.array(z.unknown()).default([]).describe("Arguments in order. uint and int values may be strings or numbers; arrays and tuples as JSON."),
  value: z.string().regex(/^\d+$/).default("0").describe("Native PEPU to send, in wei, as a decimal string."),
  allowFailure: z.boolean().default(false).describe("multicall3 only: let this call fail without reverting the batch."),
});

const inputSchema = {
  calls: z.array(callSchema).min(1).max(50).describe("The calls to encode, in order."),
  as: z
    .enum(["calldata", "multicall3", "kernel-execute", "userop-callData"])
    .default("calldata")
    .describe("calldata: each call alone. multicall3: one aggregate3 to PEPU's Multicall3. kernel-execute and userop-callData: the Kernel v3 ERC-7579 execute calldata (same bytes; the second name is what you put in a UserOperation)."),
};

type CallInput = z.infer<typeof callSchema>;

function resolveFunction(call: CallInput): AbiFunction {
  if (call.signature !== undefined) return parseFunctionInput(call.signature as FunctionInput, "signature");
  if (call.abi !== undefined && call.functionName !== undefined) {
    return findFunctionInAbi(call.abi as unknown as Abi, call.functionName, call.args.length);
  }
  return actionableError("A call needs a signature, or abi plus functionName.", "Neither was given.", "Add signature: 'tap()' or abi + functionName.");
}

const ZERO_MODE_SINGLE = pad("0x00", { size: 32, dir: "right" }) as Hex;
const MODE_BATCH = pad("0x01", { size: 32, dir: "right" }) as Hex;

const EXECUTE_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "execMode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

// TODO(sdk): the SDK builds Kernel callData only through a live account (`account.encodeCalls`). This is the standard
// ERC-7579 default-mode encoding, kept local so the tool works without an account. Expose a pure encoder in @pepu-chain/sdk/aa/kernel.
function encodeKernelExecute(calls: { to: Address; value: bigint; data: Hex }[]): Hex {
  if (calls.length === 1 && calls[0]) {
    const c = calls[0];
    return encodeFunctionData({
      abi: EXECUTE_ABI,
      functionName: "execute",
      args: [ZERO_MODE_SINGLE, encodePacked(["address", "uint256", "bytes"], [c.to, c.value, c.data])],
    });
  }
  const batch = encodeAbiParameters(
    [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
    [calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))]
  );
  return encodeFunctionData({ abi: EXECUTE_ABI, functionName: "execute", args: [MODE_BATCH, batch] });
}

export function registerEncodeCallsTool(server: McpServer): void {
  server.registerTool(
    "pepu_encode_calls",
    {
      title: "Encode PEPU contract calls",
      description:
        "ABI-encode contract calls (viem encodeFunctionData) from a Solidity signature or ABI, and optionally wrap them: 'multicall3' builds one aggregate3 call to PEPU's own Multicall3 using encodeAggregate3 and getMulticall3 from @pepu-chain/sdk (never the canonical 0xcA11 address, which has no code here); 'kernel-execute' or 'userop-callData' builds the ERC-7579 execute calldata for a Kernel v3 UserOperation (single or batch mode). Returns hex, a decoded echo, and a gas hint. Pure: nothing is signed or sent.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ calls, as }) => {
      const encoded = calls.map((call, i) => {
        if (!isAddress(call.to)) {
          actionableError(`calls[${i}].to is not a valid address.`, `Got "${call.to}".`, "Pass a 0x address with 40 hex characters.");
        }
        const fn = resolveFunction(call);
        const args = coerceArgs(fn, call.args);
        const data = encodeFunctionData({ abi: [fn], functionName: fn.name, args } as Parameters<typeof encodeFunctionData>[0]);
        return {
          to: call.to as Address,
          value: BigInt(call.value),
          data,
          fn,
          args: call.args,
          allowFailure: call.allowFailure,
        };
      });

      const echo = encoded.map((c) => ({
        to: c.to,
        function: `${c.fn.name}(${c.fn.inputs.map((p) => p.type).join(",")})`,
        selector: c.data.slice(0, 10),
        args: c.args,
        valueWei: c.value.toString(),
        calldata: c.data,
        bytes: size(c.data),
      }));

      const gasHint =
        "Nitro estimation undershoots on PEPU because the L1 data cost is not in the plain estimate: add about 20% headroom (withGasLimitBuffer from @pepu-chain/sdk/session) and expect the L1 component to grow with calldata size.";

      if (as === "calldata") {
        return jsonResult({ as, calls: echo, gasHint, sdkFunction: "viem encodeFunctionData" });
      }

      if (as === "multicall3") {
        if (encoded.some((c) => c.value !== 0n)) {
          actionableError("multicall3 aggregate3 cannot carry native value.", "aggregate3 is not payable.", "Send value-bearing calls on their own, or use kernel-execute (a smart account can send value per call).");
        }
        const multicall = getMulticall3();
        const data = await sdkCall("encodeAggregate3", () => encodeAggregate3(encoded.map((c) => ({ target: c.to, allowFailure: c.allowFailure, callData: c.data }))));
        return jsonResult({
          as,
          to: multicall.address,
          data,
          value: "0",
          note: "to is PEPU's Multicall3 deployment, not the canonical 0xcA11bde0... address (which has no code on this chain).",
          calls: echo,
          gasHint,
          sdkFunctions: "encodeAggregate3, getMulticall3 (@pepu-chain/sdk)",
        });
      }

      const callData = encodeKernelExecute(encoded.map((c) => ({ to: c.to, value: c.value, data: c.data })));
      if (!isHex(callData)) actionableError("Encoding failed.", "viem returned a non-hex value.", "Report this.");
      return jsonResult({
        as,
        callData,
        mode: encoded.length === 1 ? "ERC-7579 single (callType 0x00)" : "ERC-7579 batch (callType 0x01)",
        note: "Put this in a UserOperation's callData for a Kernel v3 account. With a live account object you can get the same bytes from account.encodeCalls(calls) (toPepuKernelAccount, @pepu-chain/sdk/aa/kernel).",
        calls: echo,
        gasHint,
        sdkFunction: "viem encodeFunctionData (ERC-7579 execute); account.encodeCalls via toPepuKernelAccount (@pepu-chain/sdk/aa/kernel)",
      });
    }
  );
}
