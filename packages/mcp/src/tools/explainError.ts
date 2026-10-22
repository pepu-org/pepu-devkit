/**
 * pepu_explain_error
 *
 * WHAT: Explains any PEPU failure: an error message, a paymaster denial
 * reason code (such as `project_paused`), or raw revert data (`0x...`). It
 * runs the SDK's `explainError` (the single error catalog shared with the SDK
 * and the docs error page) and, for paymaster reason codes, `mapPaymasterReason`.
 *
 * WHEN TO USE: First, whenever something throws. It is a superset of
 * pepu_decode_error: use pepu_decode_error only when you also need to decode a
 * custom error from your own contract's ABI.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorDocsUrl, explainError, getErrorEntry } from "@pepu-chain/sdk";
import { PAYMASTER_DENIAL_REASONS, mapPaymasterReason } from "@pepu-chain/sdk/paymaster";
import { isHex } from "viem";
import { STATIC_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";

const inputSchema = {
  error: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      "The failure to explain: an error message or stack text, a paymaster denial reason code (for example project_not_claimed_onchain), or raw revert data as 0x hex (an Error(string), Panic, FailedOp or FailedOpWithRevert payload). The input is never echoed back."
    ),
};

const REASON_TOKEN = /^[a-z][a-z0-9_]{2,}$/;

function findReasonIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  return PAYMASTER_DENIAL_REASONS.find((r) => lower.includes(r));
}

export function registerExplainErrorTool(server: McpServer): void {
  server.registerTool(
    "pepu_explain_error",
    {
      title: "Explain a PEPU error",
      description:
        "Explain any PEPU failure with explainError from @pepu-chain/sdk (the shared error catalog): pass an error message, a paymaster denial reason code (mapped with mapPaymasterReason from @pepu-chain/sdk/paymaster), or raw revert data (0x...). Returns the catalog code, cause, fix, whether retrying can help, the HTTP status the SDK route factories use, and a docs link. Superset of pepu_decode_error; use that one only to decode a custom error from your own ABI. Pure and offline.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ error }) => {
      const text = error.trim();
      if (text === "") {
        actionableError("The error text is empty.", "There is nothing to explain.", "Paste the error message, reason code or revert data.");
      }

      const base = explainError(text);
      let code = base.code;
      let matched: string = base.matched;
      let paymasterReason: { reason: string; code: string; known: boolean } | undefined;

      if (!isHex(text) && base.code === "UNKNOWN") {
        const reason = REASON_TOKEN.test(text) ? text : findReasonIn(text);
        if (reason) {
          const mapped = mapPaymasterReason(reason);
          const known = (PAYMASTER_DENIAL_REASONS as readonly string[]).includes(reason);
          paymasterReason = { reason, code: mapped, known };
          code = mapped;
          matched = known ? "paymaster-reason" : "unknown";
        }
      } else if (!isHex(text)) {
        const reason = findReasonIn(text);
        if (reason) paymasterReason = { reason, code: mapPaymasterReason(reason), known: true };
      }

      const entry = getErrorEntry(code);
      const kind = isHex(text) ? "revert-data" : REASON_TOKEN.test(text) ? "reason-code" : "message";
      return jsonResult({
        kind,
        code: entry.code,
        title: entry.title,
        cause: entry.cause,
        fix: entry.fix,
        retryable: entry.retryable,
        httpStatus: entry.status,
        docsUrl: errorDocsUrl(entry.code),
        matched,
        ...(paymasterReason ? { paymasterReason } : {}),
        ...(entry.code === "UNKNOWN"
          ? { next: "Run pepu_known_gotchas, or pepu_decode_error with your contract's ABI if this is a custom error selector." }
          : {}),
        sdkFunction: "explainError (@pepu-chain/sdk)",
      });
    }
  );
}
