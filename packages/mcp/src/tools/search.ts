/**
 * pepu_search
 *
 * WHAT: Resolves an ambiguous string (address, tx hash, token symbol/name,
 * or block number) to the correct on-chain entity on PEPU mainnet, and
 * tells you which tool to call next for it — rather than making you guess
 * whether "USDT" or a partial address string is a token, a contract, or a
 * transaction before you can do anything useful with it.
 *
 * WHEN TO USE: Any time you have a human-provided string and don't already
 * know what kind of entity it refers to. Mainnet only.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork, search, type BlockscoutSearchItem } from "../blockscout.js";
import { jsonResult, paginate } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  query: z.string().min(1).describe("An address, transaction hash, block number, or token/contract name or symbol — anything you'd type into an explorer search box."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" actually works — pepuscan/Blockscout does not index testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z.enum(["concise", "detailed"]).default("concise").describe("concise: top 5 matches. detailed: top 20 matches."),
};

function describeMatch(item: BlockscoutSearchItem): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: item.type,
    name: item.name ?? null,
    symbol: item.symbol ?? null,
  };

  switch (item.type) {
    case "transaction":
      base["hash"] = item.transaction_hash ?? item.hash;
      base["nextTool"] = "pepu_get_transaction";
      break;
    case "block":
      base["hash"] = item.block_hash ?? item.hash;
      base["nextTool"] = "Blocks aren't covered by this server's tools — use pepuscan.com directly or the generic Blockscout MCP server.";
      break;
    case "token":
      base["address"] = item.address_hash;
      base["isVerifiedContract"] = item.is_smart_contract_verified ?? null;
      base["nextTool"] = "pepu_get_address_overview (holder/balance data) or pepu_verify_contract_status (ABI)";
      break;
    default: // "address" and any contract-shaped result
      base["address"] = item.address_hash ?? item.hash;
      base["isSmartContract"] = item.is_smart_contract_address ?? null;
      base["isVerifiedContract"] = item.is_smart_contract_verified ?? null;
      base["nextTool"] = item.is_smart_contract_address
        ? "pepu_verify_contract_status (ABI) or pepu_get_address_overview (balance/tokens)"
        : "pepu_get_address_overview";
  }
  return base;
}

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    "pepu_search",
    {
      title: "PEPU entity search",
      description:
        "Resolve an ambiguous string — an address, tx hash, block number, or token/contract name or symbol — to the matching on-chain entity on PEPU mainnet, with a pointer to which tool of this server to call next. Use this when you have a human-provided string of unknown type instead of guessing its shape yourself.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ query, network, response_format }) => {
      assertBlockscoutNetwork(network);
      const raw = await search(query.trim());

      if (raw.items.length === 0) {
        actionableError(
          `No matches found for "${query}" on PEPU mainnet.`,
          "pepuscan's search covers addresses, verified contract/token names and symbols, transaction hashes, and block numbers.",
          "Check spelling, try a shorter/partial term, or if you have a full address/hash already, call pepu_get_address_overview or pepu_get_transaction directly instead of searching."
        );
      }

      const limit = response_format === "detailed" ? 20 : 5;
      const { items, note } = paginate(raw.items, limit);
      const result: Record<string, unknown> = {
        query,
        matchCount: raw.items.length,
        matches: items.map(describeMatch),
      };
      if (note) result["note"] = note;
      return jsonResult(result);
    }
  );
}
