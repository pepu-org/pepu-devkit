/**
 * Turn what a model passes (a human-readable signature or a JSON ABI fragment)
 * into viem ABI function items, and coerce JSON arguments into the types viem
 * encodes (uint and int values arrive as strings or numbers, never bigint).
 */

import { parseAbiItem, type Abi, type AbiFunction, type AbiParameter } from "viem";
import { actionableError } from "./errors.js";

export type FunctionInput = string | Record<string, unknown>;

/** `tap()`, `transfer(address,uint256)`, `function mint(address to) payable`, or a JSON ABI item. */
export function parseFunctionInput(input: FunctionInput, label = "function"): AbiFunction {
  if (typeof input === "string") {
    const text = input.trim();
    const signature = /^function\s/.test(text) ? text : `function ${text}`;
    try {
      const item = parseAbiItem(signature);
      if (item.type !== "function") throw new Error("not a function");
      return item;
    } catch {
      return actionableError(
        `Could not parse ${label} "${text}".`,
        "Signatures look like tap() or transfer(address to, uint256 amount).",
        'Pass a Solidity signature string, or a JSON ABI item such as {"type":"function","name":"tap","inputs":[],"outputs":[],"stateMutability":"nonpayable"}.'
      );
    }
  }
  if (input["type"] !== "function" || typeof input["name"] !== "string") {
    actionableError(`The ${label} ABI item is not a named function.`, "It needs type: 'function' and a name.", "Pass a function fragment, not an event, error or constructor.");
  }
  return {
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
    ...input,
  } as unknown as AbiFunction;
}

/** Find a function in a full ABI by name (first overload unless `args` length disambiguates). */
export function findFunctionInAbi(abi: Abi, name: string, argCount?: number): AbiFunction {
  const matches = abi.filter((i): i is AbiFunction => i.type === "function" && i.name === name);
  if (matches.length === 0) {
    actionableError(`The ABI has no function named "${name}".`, `Functions present: ${abi.filter((i) => i.type === "function").map((i) => (i as AbiFunction).name).join(", ") || "none"}.`, "Check the name, or pass a signature string instead.");
  }
  const exact = argCount === undefined ? undefined : matches.find((m) => m.inputs.length === argCount);
  return (exact ?? matches[0]) as AbiFunction;
}

/** Coerce one JSON value to the type an ABI parameter expects. */
export function coerceArg(param: AbiParameter, value: unknown): unknown {
  const type = param.type;
  if (type.endsWith("]")) {
    if (!Array.isArray(value)) {
      actionableError(`Argument "${param.name ?? type}" must be an array.`, `Its type is ${type}.`, "Pass a JSON array.");
    }
    const inner = { ...param, type: type.slice(0, type.lastIndexOf("[")) } as AbiParameter;
    return (value as unknown[]).map((v) => coerceArg(inner, v));
  }
  if (type === "tuple") {
    const components = (param as AbiParameter & { components?: readonly AbiParameter[] }).components ?? [];
    if (Array.isArray(value)) return components.map((c, i) => coerceArg(c, value[i]));
    if (value && typeof value === "object") {
      return Object.fromEntries(components.map((c) => [c.name ?? "", coerceArg(c, (value as Record<string, unknown>)[c.name ?? ""])]));
    }
    return value;
  }
  if (/^u?int\d*$/.test(type)) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" || typeof value === "string") {
      try {
        return BigInt(value);
      } catch {
        return actionableError(`Argument "${param.name ?? type}" is not an integer.`, `Got ${JSON.stringify(value)} for ${type}.`, 'Pass a whole number, as a string for large values, e.g. "1000000000000000000".');
      }
    }
    return value;
  }
  return value;
}

export function coerceArgs(fn: AbiFunction, args: readonly unknown[]): unknown[] {
  if (args.length !== fn.inputs.length) {
    actionableError(`${fn.name} takes ${fn.inputs.length} argument(s), got ${args.length}.`, `Signature: ${fn.name}(${fn.inputs.map((i) => `${i.type}${i.name ? " " + i.name : ""}`).join(", ")}).`, "Pass exactly the arguments the signature lists, in order.");
  }
  return fn.inputs.map((p, i) => coerceArg(p, args[i]));
}
