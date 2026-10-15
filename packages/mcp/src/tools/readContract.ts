/**
 * pepu_read_contract
 *
 * WHAT: Calls a read-only (view/pure) contract method on PEPU via RPC, given
 * an address, an ABI fragment for just that one function, and its args.
 * Works on both mainnet and testnet since it talks to the RPC directly, not
 * Blockscout — this is the one tool in this server that testnet users get
 * full parity on.
 *
 * WHEN TO USE: You know (or found via pepu_verify_contract_status) a
 * contract's ABI and want to call a specific view function — token balances,
 * name/symbol/decimals, ownership checks, config values, etc. Not for
 * sending state-changing transactions (this server never holds a private
 * key, by design — it's read-only tooling).
 *
 * uint/int-typed arguments may be passed as strings or numbers; they are
 * coerced to bigint automatically since JSON has no native 64-bit+ integer
 * type. Example call:
 *   { address: "0xF9Cf...FCB8", abi: [{"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]}], functionName: "symbol" }
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { isAddress, type Abi, type AbiFunction } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicClient } from "../rpc.js";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  address: z.string().describe("The contract address to call, 0x-prefixed, 40 hex characters."),
  abi: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .describe('ABI fragment as a JSON array. Only needs to include the function(s) you\'re calling, e.g. [{"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}]}].'),
  functionName: z.string().describe("Name of the function to call — must match a function in the abi array."),
  args: z.array(z.unknown()).default([]).describe("Positional arguments for the function, in order. uint/int types may be given as strings or numbers."),
  network: z.enum(["mainnet", "testnet"]).default("mainnet"),
};

/** JSON has no bigint; uint/int ABI inputs arrive as string/number and need coercing before viem encodes the call. */
function coerceArgs(abiFn: AbiFunction, args: unknown[]): unknown[] {
  return abiFn.inputs.map((input, i) => {
    const value = args[i];
    if (value === undefined) return value;
    if (/^u?int\d*$/.test(input.type) && (typeof value === "string" || typeof value === "number")) {
      try {
        return BigInt(value);
      } catch {
        actionableError(
          `Could not convert argument ${i} ("${String(value)}") to an integer for ABI type "${input.type}".`,
          "The value must be a whole number or a numeric string.",
          "Pass it as e.g. \"1000000000000000000\" for large values, or a plain number for small ones."
        );
      }
    }
    return value;
  });
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

export function registerReadContractTool(server: McpServer): void {
  server.registerTool(
    "pepu_read_contract",
    {
      title: "PEPU read contract",
      description:
        "Call a read-only (view/pure) contract method on PEPU mainnet or testnet via RPC, given the contract address, a minimal ABI fragment for the function, and its arguments. Works on testnet too (this is an RPC-direct tool, not Blockscout-backed). Use pepu_verify_contract_status first if you don't already know the ABI. Does not send transactions or require a private key.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ address, abi, functionName, args, network }) => {
      if (!isAddress(address)) {
        actionableError(`"${address}" is not a valid EVM address.`, "It must be 0x-prefixed with 40 hex characters.", "Double check the contract address.");
      }

      const typedAbi = abi as unknown as Abi;
      const abiFn = typedAbi.find((item): item is AbiFunction => item.type === "function" && item.name === functionName);
      if (!abiFn) {
        actionableError(
          `No function named "${functionName}" found in the provided ABI.`,
          `The ABI array you passed only defines: ${typedAbi.filter((i) => i.type === "function").map((i) => (i as AbiFunction).name).join(", ") || "(no functions)"}.`,
          "Add the function's ABI entry to the abi array, or check the spelling of functionName."
        );
      }
      if (abiFn.stateMutability !== "view" && abiFn.stateMutability !== "pure") {
        actionableError(
          `"${functionName}" has stateMutability "${abiFn.stateMutability}", not view/pure.`,
          "pepu_read_contract only supports read-only calls and never signs or sends transactions.",
          "If you need to change on-chain state, that requires a signer outside this MCP server's scope."
        );
      }

      const coercedArgs = coerceArgs(abiFn, args);
      const client = getPublicClient(network);

      try {
        const result = await client.readContract({
          address: address as `0x${string}`,
          abi: typedAbi,
          functionName,
          args: coercedArgs,
        });
        return jsonResult({ address, network, functionName, result: toJsonSafe(result) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        actionableError(
          `The call to ${functionName}(${coercedArgs.map(String).join(", ")}) on ${address} (${network}) reverted or failed.`,
          `RPC error: ${message}`,
          "Check that the address actually implements this function (wrong ABI against the wrong contract is the most common cause), that arguments are in the right order/type, and that you're on the intended network."
        );
      }
    }
  );
}
