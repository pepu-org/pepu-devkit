/**
 * pepu_get_address_overview
 *
 * WHAT: A composed one-call overview of an address on PEPU mainnet — native
 * balance, tx count, contract-or-EOA, verification status if it's a
 * contract, and token holdings. This is three-to-four separate Blockscout
 * REST calls (address, counters, token-balances) collapsed into one
 * high-signal result, so an agent doesn't have to round-trip multiple times
 * or reason about which endpoint has which field.
 *
 * WHEN TO USE: Any time you need "what is this address / what does it
 * hold / has it done anything" as a starting point for further work (e.g.
 * before deciding whether to call pepu_read_contract or pepu_verify_contract_status
 * on it). Mainnet only — see pepu_chain_info for why testnet has no
 * Blockscout-backed data.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { isAddress, getAddress as toChecksumAddress } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork, getAddress, getAddressCounters, getAddressTokenBalances } from "../blockscout.js";
import { formatPepu, jsonResult, paginate } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  address: z.string().describe("A 0x-prefixed EVM address, 40 hex characters."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" actually works — pepuscan/Blockscout does not index testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: balance, type, tx count, top 5 token holdings. detailed: up to 25 token holdings plus proxy/implementation info."),
};

export function registerAddressOverviewTool(server: McpServer): void {
  server.registerTool(
    "pepu_get_address_overview",
    {
      title: "PEPU address overview",
      description:
        "Get a composed overview of a PEPU (mainnet) address in one call: native PEPU balance, whether it's a contract or EOA, verification status, transaction count, and token holdings. Use this instead of separately fetching balance/tx-count/tokens — it's the single-call starting point for 'what is this address and what does it hold'. Mainnet only.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ address, network, response_format }) => {
      if (!isAddress(address)) {
        actionableError(
          `"${address}" is not a valid EVM address.`,
          "It must be a 0x-prefixed string with exactly 40 hex characters.",
          "Double check the address, or use pepu_search if you only have a name/symbol/partial string."
        );
      }
      assertBlockscoutNetwork(network);

      const checksummed = toChecksumAddress(address);
      const [addr, counters, tokenBalances] = await Promise.all([
        getAddress(checksummed),
        getAddressCounters(checksummed),
        getAddressTokenBalances(checksummed),
      ]);

      if (!addr) {
        actionableError(
          `No address found for ${checksummed} on PEPU mainnet.`,
          "pepuscan has no record of this address ever appearing on-chain (no balance, no transactions).",
          "Confirm the address and network are correct. A never-used address is not an error on your part, just an empty result."
        );
      }

      const tokenLimit = response_format === "detailed" ? 25 : 5;
      const sortedTokens = (tokenBalances ?? []).slice().sort((a, b) => (a.token.symbol ?? "").localeCompare(b.token.symbol ?? ""));
      const { items: tokenItems, note: tokenNote } = paginate(sortedTokens, tokenLimit);

      const result: Record<string, unknown> = {
        address: addr.hash,
        network: "mainnet",
        type: addr.is_contract ? "contract" : "eoa",
        name: addr.name,
        isVerifiedContract: addr.is_contract ? addr.is_verified : null,
        isScam: addr.is_scam,
        balance: {
          wei: addr.coin_balance ?? "0",
          pepu: formatPepu(addr.coin_balance),
        },
        transactionCount: counters ? Number(counters.transactions_count) : null,
        tokenHoldingsCount: tokenBalances?.length ?? 0,
        tokenHoldings: tokenItems.map((t) => ({
          symbol: t.token.symbol,
          name: t.token.name,
          type: t.token.type,
          decimals: t.token.decimals,
          balanceRaw: t.value,
          holdersCount: t.token.holders_count,
        })),
      };

      if (tokenNote) result["tokenHoldingsNote"] = tokenNote;

      if (addr.is_contract) {
        result["guidance"] = addr.is_verified
          ? "This is a verified contract — call pepu_verify_contract_status for its ABI/source, or pepu_read_contract to call a view method directly."
          : "This is an UNVERIFIED contract — pepu_verify_contract_status will confirm no ABI/source is public. You'll need the ABI from elsewhere before calling pepu_read_contract on it.";
        if (response_format === "detailed") {
          result["proxyType"] = addr.proxy_type;
          result["implementations"] = addr.implementations;
          result["creatorAddress"] = addr.creator_address_hash;
          result["creationTransactionHash"] = addr.creation_transaction_hash;
        }
      }

      return jsonResult(result);
    }
  );
}
