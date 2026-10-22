/**
 * pepu_get_token_info
 *
 * WHAT: Token metadata (name, symbol, decimals, total supply, holder count)
 * from pepuscan, cross-checked against a live RPC read of the same fields —
 * catching the case where pepuscan's index has stale/wrong metadata for a
 * token, which its raw API alone won't tell you. Also flags whether the
 * queried address is WPEPU, PEPU's canonical wrapped-native token — the one
 * token address on this chain that's genuinely load-bearing for DEX/router
 * integration, since native PEPU itself has no ERC-20 form.
 *
 * WHEN TO USE: You have a token address and need its supply/decimals/symbol
 * with confidence it's accurate, or need to know whether it's the wrapped
 * native token specifically. If you only have a symbol/name and need to find
 * the address first, use pepu_search. This never returns a USD figure —
 * pepuscan has no price oracle for PEPU-chain tokens (exchange_rate is
 * always null); bring your own price feed if you need one.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { formatUnits, isAddress, getAddress as toChecksumAddress } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork, getAddress, getToken } from "../blockscout.js";
import { getPublicClient } from "../rpc.js";
import { ERC20_ABI_FRAGMENT, WPEPU_ADDRESS } from "../constants.js";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  address: z.string().describe("A 0x-prefixed ERC-20 token contract address, 40 hex characters."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" actually works — pepuscan/Blockscout does not index testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: name/symbol/decimals/supply/holders + wrapped-native flag. detailed: adds the raw RPC cross-check and reputation/icon metadata."),
};

interface RpcCrossCheck {
  symbol: string;
  decimals: number;
  totalSupply: string;
}

async function tryRpcCrossCheck(address: `0x${string}`, network: "mainnet" | "testnet"): Promise<RpcCrossCheck | { error: string }> {
  try {
    const client = getPublicClient(network);
    const [symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address, abi: ERC20_ABI_FRAGMENT, functionName: "symbol" }),
      client.readContract({ address, abi: ERC20_ABI_FRAGMENT, functionName: "decimals" }),
      client.readContract({ address, abi: ERC20_ABI_FRAGMENT, functionName: "totalSupply" }),
    ]);
    return { symbol, decimals, totalSupply: totalSupply.toString() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerGetTokenInfoTool(server: McpServer): void {
  server.registerTool(
    "pepu_get_token_info",
    {
      title: "PEPU token info",
      description:
        "Get an ERC-20 token's metadata on PEPU mainnet (name, symbol, decimals, total supply, holder count) from pepuscan, cross-checked live against the token contract itself via RPC, and flagged if it's WPEPU (the canonical wrapped-native token — the one token address genuinely load-bearing for DEX/router logic here, since native PEPU has no other ERC-20 form). Use pepu_search first if you only have a symbol/name, not an address. Never returns a USD value — no price oracle exists for PEPU-chain tokens.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ address, network, response_format }) => {
      if (!isAddress(address)) {
        actionableError(`"${address}" is not a valid EVM address.`, "It must be 0x-prefixed with 40 hex characters.", "Double check the address, or use pepu_search if you only have a symbol/name.");
      }
      assertBlockscoutNetwork(network);

      const checksummed = toChecksumAddress(address);
      const [token, rpcCheck] = await Promise.all([getToken(checksummed), tryRpcCrossCheck(checksummed, network)]);

      if (!token) {
        const addr = await getAddress(checksummed);
        if (!addr) {
          actionableError(
            `${checksummed} has no on-chain history on PEPU mainnet.`,
            "It's neither a known token nor an address pepuscan has ever seen a balance or transaction for.",
            "Confirm the address is correct."
          );
        }
        actionableError(
          `${checksummed} is not a token pepuscan recognizes.`,
          addr.is_contract ? "It IS a contract, but not one pepuscan's token indexer classified as ERC-20/721/1155." : "It's an externally-owned account (EOA), not a contract at all.",
          addr.is_contract
            ? "Use pepu_verify_contract_status to inspect it as a generic contract instead, or pepu_read_contract if you already know its ABI."
            : "Double check you have the right address — EOAs are never tokens."
        );
      }

      const isWrappedNative = checksummed.toLowerCase() === WPEPU_ADDRESS.toLowerCase();
      const decimals = token.decimals ? Number(token.decimals) : null;

      const result: Record<string, unknown> = {
        address: checksummed,
        network: "mainnet",
        name: token.name,
        symbol: token.symbol,
        decimals,
        type: token.type,
        totalSupply: decimals !== null && token.total_supply ? formatUnits(BigInt(token.total_supply), decimals) : token.total_supply,
        holdersCount: token.holders_count ? Number(token.holders_count) : null,
        reputation: token.reputation,
        isWrappedNative,
      };

      if (isWrappedNative) {
        result["wrappedNativeNote"] = "This IS PEPU's canonical wrapped-native token. Native PEPU itself is not an ERC-20 and has no other wrapper — use this address anywhere a router/AMM needs an ERC-20 handle for the native currency.";
      } else if (response_format === "detailed") {
        result["wrappedNativeAddressForReference"] = WPEPU_ADDRESS;
      }

      if ("error" in rpcCheck) {
        result["rpcCrossCheckNote"] = `Live RPC read failed (${rpcCheck.error}) — showing pepuscan's indexed data only, unverified against the contract itself.`;
      } else {
        const symbolMatches = rpcCheck.symbol === token.symbol;
        const decimalsMatches = decimals === null || rpcCheck.decimals === decimals;
        const totalSupplyMatches = token.total_supply === null || rpcCheck.totalSupply === token.total_supply;
        if (!symbolMatches || !decimalsMatches || !totalSupplyMatches) {
          result["rpcCrossCheckWarning"] = "pepuscan's indexed data disagrees with a live RPC read of this contract — trust the RPC values below; pepuscan's index may be stale.";
        }
        if (response_format === "detailed" || !symbolMatches || !decimalsMatches || !totalSupplyMatches) {
          result["rpcCrossCheck"] = { symbol: rpcCheck.symbol, decimals: rpcCheck.decimals, totalSupply: rpcCheck.totalSupply };
        }
      }

      if (response_format === "detailed") {
        result["iconUrl"] = token.icon_url;
        result["exchangeRateNote"] = "Not provided: pepuscan reports no exchange_rate for PEPU-chain tokens (no on-chain price oracle wired up). Fetch a live price yourself if you need a dollar figure.";
      }

      return jsonResult(result);
    }
  );
}
