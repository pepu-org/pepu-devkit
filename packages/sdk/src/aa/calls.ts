import { encodeAbiParameters, encodeFunctionData, encodePacked, pad, parseEventLogs } from "viem";
import type { Abi } from "viem";
import type { Address, Hex, TransactionReceipt } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

import { PepuPolicyError } from "../errors.js";
import type { Call } from "./types.js";

/** A call in the exact `{ to, value, data }` shape smart-account clients take. */
export interface EncodedCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * Normalize {@link Call}s: encode `abi`/`functionName`/`args` into `data`,
 * default `value` to 0 and `data` to `0x`. Throws a PepuError for an empty
 * list or an ambiguous call.
 *
 * @example
 * normalizeCalls([{ to, abi: tapScoreAbi, functionName: "tap" }]);
 */
export function normalizeCalls(calls: readonly Call[]): EncodedCall[] {
  if (calls.length === 0) {
    throw new PepuPolicyError("POLICY_UNSCOPED", "A sponsored send needs at least one call.", {
      hint: "Pass calls: [{ to, data }] or [{ to, abi, functionName, args }].",
    });
  }
  return calls.map((c, i) => {
    if (c.data !== undefined && c.functionName !== undefined) {
      throw new PepuPolicyError("POLICY_UNSCOPED", `Call ${i} sets both data and functionName.`, {
        hint: "Use either raw data or abi plus functionName, not both.",
      });
    }
    let data: Hex = c.data ?? "0x";
    if (c.functionName !== undefined) {
      if (!c.abi) {
        throw new PepuPolicyError("POLICY_UNSCOPED", `Call ${i} has functionName but no abi.`, {
          hint: "Pass the contract abi alongside functionName.",
        });
      }
      data = encodeFunctionData({
        abi: c.abi,
        functionName: c.functionName,
        ...(c.args ? { args: c.args } : {}),
      } as Parameters<typeof encodeFunctionData>[0]);
    }
    return { to: c.to, value: c.value ?? 0n, data };
  });
}

/**
 * Read who paid and how much from a bundle transaction receipt's
 * `UserOperationEvent` (EntryPoint v0.7). Returns `null` when the receipt has
 * no event for `sender`.
 *
 * @example
 * const paid = userOpEventFromReceipt(receipt, smartAccountAddress);
 */
export function userOpEventFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  sender: Address,
): { userOpHash: Hex; paymaster: Address | null; actualGasCost: bigint; success: boolean } | null {
  const events = parseEventLogs({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
    strict: false,
  });
  const ev = events.find((e) => e.args.sender?.toLowerCase() === sender.toLowerCase());
  if (!ev || ev.args.userOpHash === undefined) return null;
  const pm = ev.args.paymaster;
  const zero = "0x0000000000000000000000000000000000000000";
  return {
    userOpHash: ev.args.userOpHash,
    paymaster: pm && pm.toLowerCase() !== zero ? pm : null,
    actualGasCost: ev.args.actualGasCost ?? 0n,
    success: ev.args.success ?? false,
  };
}

/** One UserOperationEvent from a bundle receipt. */
export interface UserOpEvent {
  sender: Address;
  userOpHash: Hex;
  nonce: bigint;
  /** The paymaster the EntryPoint charged, or `null` when the account paid for itself. */
  paymaster: Address | null;
  actualGasCost: bigint;
  actualGasUsed: bigint;
  success: boolean;
}

/**
 * Every `UserOperationEvent` in a receipt, without knowing the sender. A
 * bundle can carry several operations; use this to inspect them all (for
 * example when you only have a transaction hash). Pure.
 *
 * @example
 * const events = userOpEventsFromReceipt(receipt);
 * events.map((e) => [e.sender, e.success]);
 */
export function userOpEventsFromReceipt(receipt: Pick<TransactionReceipt, "logs">): UserOpEvent[] {
  const zero = "0x0000000000000000000000000000000000000000";
  const out: UserOpEvent[] = [];
  for (const ev of parseEventLogs({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
    strict: false,
  })) {
    const a = ev.args;
    if (a.sender === undefined || a.userOpHash === undefined) continue;
    out.push({
      sender: a.sender,
      userOpHash: a.userOpHash,
      nonce: a.nonce ?? 0n,
      paymaster: a.paymaster && a.paymaster.toLowerCase() !== zero ? a.paymaster : null,
      actualGasCost: a.actualGasCost ?? 0n,
      actualGasUsed: a.actualGasUsed ?? 0n,
      success: a.success ?? false,
    });
  }
  return out;
}

const KERNEL_EXECUTE_ABI = [
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

/** ERC-7579 execution modes: callType (1 byte) then zeros, default exec type. */
const EXEC_MODE_SINGLE: Hex = pad("0x00", { size: 32, dir: "right" });
const EXEC_MODE_BATCH: Hex = pad("0x01", { size: 32, dir: "right" });

/**
 * The ERC-7579 `execute(bytes32 mode, bytes executionCalldata)` callData a
 * Kernel v3 account puts in a UserOperation. One call uses single mode
 * (callType 0x00, packed `target ++ value ++ data`); several use batch mode
 * (callType 0x01, ABI-encoded `Execution[]`). Pure: needs no live account. It
 * is the same bytes `account.encodeCalls(calls)` returns for a Kernel v3.1
 * account (`toPepuKernelAccount`, `@pepu-chain/sdk/aa/kernel`).
 *
 * Calls take either raw `data` or `abi` + `functionName` (+ `args`), like
 * `sendSponsored`. Throws a PepuError for an empty list or ambiguous call.
 *
 * @example
 * const callData = encodeKernelExecute([{ to: tapScore, abi: tapScoreAbi, functionName: "tap" }]);
 */
export function encodeKernelExecute(calls: readonly Call[]): Hex {
  const encoded = normalizeCalls(calls);
  if (encoded.length === 1 && encoded[0]) {
    const c = encoded[0];
    return encodeFunctionData({
      abi: KERNEL_EXECUTE_ABI,
      functionName: "execute",
      args: [EXEC_MODE_SINGLE, encodePacked(["address", "uint256", "bytes"], [c.to, c.value, c.data])],
    });
  }
  const batch = encodeAbiParameters(
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
    [encoded.map((c) => ({ target: c.to, value: c.value, callData: c.data }))],
  );
  return encodeFunctionData({ abi: KERNEL_EXECUTE_ABI, functionName: "execute", args: [EXEC_MODE_BATCH, batch] });
}
