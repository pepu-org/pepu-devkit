/**
 * pepu_known_gotchas
 *
 * WHAT: Returns the curated list of PEPU-specific footguns every other tool
 * in this server already individually explains inline (Multicall3's address,
 * gas sponsorship not being usable by an app yet despite a funded paymaster
 * contract, testnet's missing Blockscout instance, WPEPU's two different
 * testnet/mainnet deployments, etc.) as one flat,
 * directly-nameable list — no `response_format` guessing, no need to already
 * know that `pepu_chain_info`'s detailed mode happens to include this too.
 *
 * WHEN TO USE: Right at the start of a PEPU-related task, as a single fast
 * "what will bite me" checklist, or any time you're about to explain PEPU's
 * behavior to a user and want to double check you're not about to repeat one
 * of these mistakes yourself. This is cached static data — zero network
 * calls, so it's cheap to call liberally.
 */

import { z } from "zod";
import { STATIC_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CANONICAL_CONTRACTS, KNOWN_GOTCHAS } from "../constants.js";
import { PEPU_ERROR_CATALOG } from "@pepu-chain/sdk";
import { jsonResult } from "../format.js";

const inputSchema = {
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: just the gotcha list. detailed: adds the full canonical-contract deployment table and the SDK error catalog (PEPU_ERROR_CATALOG) for cross-reference."),
};

export function registerKnownGotchasTool(server: McpServer): void {
  server.registerTool(
    "pepu_known_gotchas",
    {
      title: "PEPU known gotchas",
      description:
        "Get the curated list of PEPU (Pepe Unchained V2) footguns an agent should know before writing chain code or explaining chain behavior to a user: Multicall3's non-canonical address, gas sponsorship not being usable by an application yet (even though a paymaster contract is deployed and funded), testnet having no Blockscout instance, the unusually high base fee, and more. Zero network calls — pure cached reference data. Call pepu_check_contract_deployed instead if you need a live, right-now check on one specific address, and pepu_explain_error for a specific failure.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ response_format }) => {
      const result: Record<string, unknown> = {
        gotchas: KNOWN_GOTCHAS,
      };
      if (response_format === "detailed") {
        result["canonicalContracts"] = CANONICAL_CONTRACTS;
        // The SDK error catalog (PEPU_ERROR_CATALOG): the same entries explainError and the docs error page use.
        result["errorCatalog"] = PEPU_ERROR_CATALOG.map((e) => ({ code: e.code, title: e.title, cause: e.cause, fix: e.fix, retryable: e.retryable }));
      }
      return jsonResult(result);
    }
  );
}
