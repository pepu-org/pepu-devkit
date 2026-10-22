/**
 * pepu_get_transaction
 *
 * WHAT: Fetches a transaction from pepuscan (Blockscout) with its decoded
 * input when the explorer has a matching ABI, plus PEPU-denominated value
 * and fee (not just raw wei) and Arbitrum-specific batch/DA status.
 *
 * WHEN TO USE: Investigating what a specific transaction did — e.g. before
 * explaining a tx to a user, debugging a failed call, or checking whether a
 * batch has actually settled to L1. Mainnet only.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork, getTransaction } from "../blockscout.js";
import { formatPepu, jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const inputSchema = {
  hash: z.string().describe("A 0x-prefixed transaction hash, 64 hex characters."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" actually works — pepuscan/Blockscout does not index testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: status, parties, value/fee in PEPU, decoded method call. detailed: adds gas breakdown, nonce, and Arbitrum L1 batch/settlement status."),
};

export function registerGetTransactionTool(server: McpServer): void {
  server.registerTool(
    "pepu_get_transaction",
    {
      title: "PEPU transaction lookup",
      description:
        "Get a PEPU (mainnet) transaction with its decoded function call (when pepuscan has a matching ABI) and PEPU-denominated value/fee instead of raw wei. Use this to explain, debug, or audit a specific transaction. For 'all transactions by this address', use pepu_get_address_overview first to confirm the address is worth digging into, then fetch specific hashes with this tool — this server does not expose a bulk transaction-history proxy since that's already well-served by pepuscan's own explorer UI and the generic Blockscout MCP server.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ hash, network, response_format }) => {
      if (!HASH_RE.test(hash)) {
        actionableError(
          `"${hash}" is not a valid transaction hash.`,
          "It must be a 0x-prefixed string with exactly 64 hex characters.",
          "Double check the hash — it's easy to accidentally pass an address (40 hex chars) instead."
        );
      }
      assertBlockscoutNetwork(network);

      const tx = await getTransaction(hash);
      if (!tx) {
        actionableError(
          `No transaction found for ${hash} on PEPU mainnet.`,
          "Either it doesn't exist, or it's too new/old for pepuscan's current index.",
          "Double-check the hash and that you mean mainnet, not testnet (testnet has no Blockscout index at all)."
        );
      }

      const result: Record<string, unknown> = {
        hash: tx.hash,
        status: tx.status,
        blockNumber: tx.block_number,
        timestamp: tx.timestamp,
        from: tx.from.hash,
        to: tx.to?.hash ?? tx.created_contract?.hash ?? null,
        contractCreated: tx.created_contract?.hash ?? null,
        value: { wei: tx.value, pepu: formatPepu(tx.value) },
        fee: { wei: tx.fee.value, pepu: formatPepu(tx.fee.value) },
        method: tx.method,
        decodedInput: tx.decoded_input
          ? {
              signature: tx.decoded_input.method_call,
              parameters: tx.decoded_input.parameters,
            }
          : null,
        revertReason: tx.revert_reason,
      };

      if (!tx.decoded_input && tx.method) {
        result["decodeNote"] = "pepuscan recognizes the method selector but has no verified ABI to fully decode parameters — call pepu_verify_contract_status on the `to` address to check if source is available elsewhere.";
      }

      if (response_format === "detailed") {
        result["gas"] = { limit: tx.gas_limit, used: tx.gas_used, priceWei: tx.gas_price };
        result["nonce"] = tx.nonce;
        result["transactionTypes"] = tx.transaction_types;
        if (tx.arbitrum) {
          result["arbitrumBatch"] = {
            batchNumber: tx.arbitrum.batch_number,
            dataContainer: tx.arbitrum.batch_data_container,
            l1SettlementStatus: tx.arbitrum.status,
          };
        }
      }

      return jsonResult(result);
    }
  );
}
