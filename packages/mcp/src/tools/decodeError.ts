/**
 * pepu_decode_error
 *
 * WHAT: Decodes a 4-byte-selector-prefixed revert payload (the `data` field
 * on a JSON-RPC error, or anything returned by eth_call/eth_estimateGas on a
 * revert) into a readable error name and arguments. This matters especially
 * on PEPU because the public RPC does not expose debug_traceCall or
 * eth_simulateV1 (see pepu_known_gotchas), so a revert from a contract call
 * often arrives as nothing but this opaque selector+data blob — there is no
 * trace to fall back on. Always tries, in order: any custom errors you pass
 * in `abi` (your own contract's errors), Solidity's built-in `Error(string)`
 * and `Panic(uint256)` (decoded automatically — no need to list them),
 * ERC-4337 EntryPoint v0.6/v0.7's error set (`FailedOp`,
 * `FailedOpWithRevert`, etc. — every selector here was computed from the
 * exact signatures in eth-infinitism/account-abstraction's IEntryPoint.sol,
 * not memorized), and a small set of ArbOS precompile errors
 * (`InvalidBlockNumber` from ArbSys, `NoTicketWithID`/`NotCallable` from
 * ArbRetryableTx — `InvalidBlockNumber`'s selector was live-confirmed by
 * deliberately triggering it against PEPU's own ArbSys precompile at
 * 0x0000...0064, not just computed from the public Nitro source).
 *
 * WHEN TO USE: You have revert data (from pepu_read_contract's error
 * message, pepu_estimate_gas_cost's failure, your own client's caught
 * error, or an EntryPoint `FailedOp`) and want to know what it actually
 * means instead of staring at an 8-hex-digit selector. If the selector
 * isn't recognized and it's from your own contract, pass its ABI via `abi`
 * (same shape as pepu_read_contract's `abi` param) for an exact decode.
 */

import { z } from "zod";
import { STATIC_READ } from "../annotations.js";
import { decodeErrorResult, type Abi } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { explainError } from "@pepu-chain/sdk";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  data: z
    .string()
    .describe(
      'The revert payload as 0x-prefixed hex — either a bare 4-byte selector ("0x080...") for a zero-argument error, or a full selector+ABI-encoded-args blob, exactly as returned in an RPC error\'s `data` field.'
    ),
  abi: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Optional ABI fragment(s) for your own contract\'s custom errors, e.g. [{"type":"error","name":"Unauthorized","inputs":[{"name":"caller","type":"address"}]}]. Checked first, before the built-in EntryPoint/ArbOS tables.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: decoded name + args + a one-line explanation. detailed: adds which table it matched from and the full ABI item."),
};

const HEX_RE = /^0x([0-9a-fA-F]{2})*$/;

/**
 * EntryPoint v0.6 + v0.7 error set. Selectors are computed at call time by
 * viem from these exact signatures (copied from eth-infinitism/account-
 * abstraction's IEntryPoint.sol at tags v0.6.0/v0.7.0) — never hardcoded as
 * hex, so a transcription typo here cannot silently produce a wrong match.
 */
const ENTRYPOINT_ERRORS_ABI = [
  { type: "error", name: "FailedOp", inputs: [{ name: "opIndex", type: "uint256" }, { name: "reason", type: "string" }] },
  { type: "error", name: "FailedOpWithRevert", inputs: [{ name: "opIndex", type: "uint256" }, { name: "reason", type: "string" }, { name: "inner", type: "bytes" }] },
  { type: "error", name: "PostOpReverted", inputs: [{ name: "returnData", type: "bytes" }] },
  { type: "error", name: "SignatureValidationFailed", inputs: [{ name: "aggregator", type: "address" }] },
  { type: "error", name: "SenderAddressResult", inputs: [{ name: "sender", type: "address" }] },
  { type: "error", name: "DelegateAndRevert", inputs: [{ name: "success", type: "bool" }, { name: "ret", type: "bytes" }] },
] as const satisfies Abi;

/**
 * A small, deliberately non-exhaustive set of ArbOS precompile errors.
 * Sourced directly from OffchainLabs/nitro-contracts' precompile interfaces
 * (ArbSys.sol, ArbRetryableTx.sol). `InvalidBlockNumber` was additionally
 * live-confirmed: calling ArbSys.arbBlockHash() with an out-of-range block
 * number on PEPU mainnet reverted with exactly this selector (0xd5dc642d).
 * Most ArbOS-level failures a normal dapp hits (gas/fee issues, tx-type
 * problems) surface as plain JSON-RPC error strings from the node itself,
 * not Solidity custom errors — there is no larger official list of these to
 * add here.
 */
const ARBOS_ERRORS_ABI = [
  { type: "error", name: "InvalidBlockNumber", inputs: [{ name: "requested", type: "uint256" }, { name: "current", type: "uint256" }] }, // ArbSys (0x0000...0064)
  { type: "error", name: "NoTicketWithID", inputs: [] }, // ArbRetryableTx (0x0000...006E) — redeem() on an unknown/expired ticket
  { type: "error", name: "NotCallable", inputs: [] }, // ArbRetryableTx (0x0000...006E)
] as const satisfies Abi;

const PANIC_CODES: Record<string, string> = {
  "0x0": "generic compiler-inserted panic",
  "0x1": "assert(false) failed",
  "0x11": "arithmetic overflow or underflow (checked math, outside an `unchecked` block)",
  "0x12": "division or modulo by zero",
  "0x21": "invalid value converted to an enum type",
  "0x22": "invalid encoding accessing a storage byte array",
  "0x31": ".pop() called on an empty array",
  "0x32": "array index (or negative index) out of bounds",
  "0x41": "out-of-memory / allocated too much memory",
  "0x51": "called a zero-initialized (uninitialized) internal function pointer",
};

function aaPhaseFor(reason: string): string | null {
  const match = /\bAA(\d\d)\b/.exec(reason);
  if (!match) return null;
  const code = match[1] ?? "";
  const bucket = code[0];
  const phase =
    bucket === "1"
      ? "factory / account-creation phase"
      : bucket === "2"
        ? "sender/account validation phase (validateUserOp — nonce, signature, prefund, verification gas, time range)"
        : bucket === "3"
          ? "paymaster validation phase (validatePaymasterUserOp — deposit, expiry, verification gas)"
          : bucket === "9"
            ? "general EntryPoint-level check (not tied to one specific phase)"
            : null;
  return phase ? `ERC-4337 error code AA${code} — ${phase}.` : null;
}

export function registerDecodeErrorTool(server: McpServer): void {
  server.registerTool(
    "pepu_decode_error",
    {
      title: "PEPU decode revert / error selector",
      description:
        "Decode a 4-byte-selector revert payload into a readable error name and arguments: your own contract's custom errors (pass `abi`), Solidity's built-in Error(string)/Panic(uint256), ERC-4337 EntryPoint v0.6/v0.7 errors (FailedOp, FailedOpWithRevert, etc. — also explains 'AA##' error codes by phase), and a small verified set of ArbOS precompile errors. Use this any time you have opaque revert data and no trace to fall back on — the public PEPU RPC does not expose debug_traceCall/eth_simulateV1, so this is often the only way to read a failure. For the PEPU-specific cause and fix of any error (catalog from explainError in @pepu-chain/sdk), prefer pepu_explain_error; this tool stays for decoding custom errors from your own ABI.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ data, abi, response_format }) => {
      if (!HEX_RE.test(data)) {
        actionableError(`"${data}" is not valid hex.`, "It must be 0x-prefixed with an even number of hex digits.", "Pass the raw revert data exactly as returned by the RPC error's `data` field, or a bare 4-byte selector like \"0x08c379a0\".");
      }
      if (data === "0x" || data.length < 10) {
        actionableError(
          `"${data}" is too short to contain a 4-byte error selector.`,
          "A selector alone needs at least 10 characters (\"0x\" + 8 hex digits).",
          "Empty revert data usually means the call ran out of gas or hit an invalid opcode rather than a Solidity `revert`/`require` — there is nothing for this tool to decode in that case."
        );
      }

      const selector = data.slice(0, 10);
      const userAbi = (abi ?? []) as unknown as Abi;
      const combinedAbi = [...userAbi, ...ENTRYPOINT_ERRORS_ABI, ...ARBOS_ERRORS_ABI] as Abi;

      let decoded: { errorName: string; args?: readonly unknown[] | undefined; abiItem: unknown };
      try {
        decoded = decodeErrorResult({ abi: combinedAbi, data: data as `0x${string}` });
      } catch {
        return jsonResult({
          matched: false,
          selector,
          guidance:
            `Selector ${selector} did not match any error in: your supplied \`abi\` (if any), Solidity's built-in Error(string)/Panic(uint256), the ERC-4337 EntryPoint v0.6/v0.7 error set, or this server's small ArbOS precompile error table. ` +
            "If this is a custom error from your own (or a third-party) contract, pass its ABI via the `abi` parameter for an exact decode. Otherwise look the selector up at https://openchain.xyz/signatures or https://www.4byte.directory/.",
        });
      }

      const args = (decoded.args ?? []) as unknown[];
      const argsJson = args.map((a) => (typeof a === "bigint" ? a.toString() : a));

      const result: Record<string, unknown> = {
        matched: true,
        selector,
        errorName: decoded.errorName,
        args: argsJson,
      };

      if (decoded.errorName === "Panic") {
        const code = (args[0] as bigint | undefined) ?? 0n;
        const codeHex = "0x" + code.toString(16);
        result["kind"] = "Solidity built-in Panic";
        result["panicCode"] = codeHex;
        result["meaning"] = PANIC_CODES[codeHex] ?? "Unrecognized panic code (outside the standard 0x00-0x51 range defined by the Solidity compiler).";
      } else if (decoded.errorName === "Error") {
        result["kind"] = "Solidity built-in revert string";
        const reason = String(args[0] ?? "");
        result["reason"] = reason;
        const aaPhase = aaPhaseFor(reason);
        if (aaPhase) result["erc4337Phase"] = aaPhase;
      } else if ((ENTRYPOINT_ERRORS_ABI as readonly { name: string }[]).some((e) => e.name === decoded.errorName)) {
        result["kind"] = "ERC-4337 EntryPoint error (v0.6/v0.7)";
        if (decoded.errorName === "FailedOp" || decoded.errorName === "FailedOpWithRevert") {
          const reason = String(args[1] ?? "");
          const aaPhase = aaPhaseFor(reason);
          if (aaPhase) result["erc4337Phase"] = aaPhase;
          result["guidance"] = "opIndex identifies which UserOperation in a batch failed (0 if only one was submitted). `reason` is the inner revert string from the account/paymaster/factory.";
        }
      } else if ((ARBOS_ERRORS_ABI as readonly { name: string }[]).some((e) => e.name === decoded.errorName)) {
        result["kind"] = "ArbOS precompile error";
        if (decoded.errorName === "InvalidBlockNumber") {
          result["guidance"] = "From ArbSys.arbBlockHash() (or similar) — the requested block number is out of the range ArbOS will return a hash for.";
        } else {
          result["guidance"] = "From the ArbRetryableTx precompile (0x000...6E) — thrown by redeem()/related calls on a ticket id ArbOS doesn't recognize, or a call it doesn't consider externally callable.";
        }
      } else {
        result["kind"] = "custom error from your supplied `abi`";
      }

      const sdkExplanation = explainError(data);
      if (sdkExplanation.code !== "UNKNOWN") {
        result["pepuExplanation"] = { code: sdkExplanation.code, title: sdkExplanation.title, cause: sdkExplanation.cause, fix: sdkExplanation.fix, docsUrl: sdkExplanation.docsUrl, source: "explainError (@pepu-chain/sdk)" };
      }

      if (response_format === "detailed") {
        result["matchedFrom"] = userAbi.some((i) => "name" in i && i.name === decoded.errorName)
          ? "your supplied abi"
          : decoded.errorName === "Error" || decoded.errorName === "Panic"
            ? "Solidity built-in (always checked, no abi needed)"
            : (ENTRYPOINT_ERRORS_ABI as readonly { name: string }[]).some((e) => e.name === decoded.errorName)
              ? "ERC-4337 EntryPoint v0.6/v0.7 table"
              : "ArbOS precompile error table";
        result["abiItem"] = decoded.abiItem;
      }

      return jsonResult(result);
    }
  );
}
