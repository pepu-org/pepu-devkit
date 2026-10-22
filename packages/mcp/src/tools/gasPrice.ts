/**
 * pepu_gas_price
 *
 * WHAT: The current live gas price on PEPU, plus what that price means in
 * PEPU (not just gwei) for a handful of common operations — a plain native
 * transfer, an ERC-20 transfer, a typical swap, and a small contract deploy.
 * Explicitly flags the chain's unusually high ~12,500 gwei-equivalent base
 * fee so a number in the thousands of gwei doesn't get mistaken for network
 * congestion.
 *
 * WHEN TO USE: You just want "what does gas cost on PEPU right now" with no
 * inputs — no address, no calldata, no gas_limit. If you already have a
 * specific call, a known gas_limit, or deployment bytecode to price
 * precisely, use pepu_estimate_gas_cost instead (it live-simulates via
 * eth_estimateGas, or prices an exact gas_limit you already know) — the
 * "deploy" row below is a rough reference only, not a real estimate for
 * your specific bytecode.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicClient } from "../rpc.js";
import { formatPepu, jsonResult } from "../format.js";

const inputSchema = {
  network: z.enum(["mainnet", "testnet"]).default("mainnet").describe("Both networks have live RPCs; this is not Blockscout-backed so testnet works too."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: gas price + reference cost table. detailed: adds the raw wei value and current block number."),
};

const REFERENCE_OPS: Array<{ label: string; gas: bigint }> = [
  { label: "native PEPU transfer", gas: 21_000n },
  { label: "typical ERC-20 transfer", gas: 65_000n },
  { label: "typical AMM swap (e.g. PepuSwap)", gas: 180_000n },
  { label: "small contract deploy (~5 KB runtime, rough reference — use pepu_estimate_gas_cost with your actual deployment `data` for a real one)", gas: 1_021_000n },
];

export function registerGasPriceTool(server: McpServer): void {
  server.registerTool(
    "pepu_gas_price",
    {
      title: "PEPU current gas price",
      description:
        "Get PEPU's current live gas price and what it costs in PEPU (not just gwei) for common operations: a transfer, an ERC-20 transfer, a swap, and a rough contract deploy. Use this for a fast 'what does gas cost right now' check with no other inputs. For pricing one specific call, a known gas_limit, or a real contract deployment (pass its init bytecode as `data` with no `to`), use pepu_estimate_gas_cost instead.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ network, response_format }) => {
      const client = getPublicClient(network);
      const gasPrice = await client.getGasPrice();
      const gasPriceGwei = Number(gasPrice) / 1e9;

      const result: Record<string, unknown> = {
        network,
        gasPriceGwei: gasPriceGwei.toLocaleString(),
        baseFeeNote:
          `PEPU's gas price is naturally in the thousands of gwei-equivalent (currently ~${gasPriceGwei.toLocaleString()}) ` +
          "because PEPU's own USD unit price is very low — the chain must charge more wei-per-gas to recover a fixed L1 data-posting cost. This is expected, not network congestion or a misconfigured RPC.",
        referenceCosts: REFERENCE_OPS.map((op) => ({
          label: op.label,
          gasUnits: op.gas.toString(),
          costPepu: formatPepu((op.gas * gasPrice).toString()),
        })),
        usdConversionNote:
          "Not provided: pepuscan reports no exchange_rate for PEPU (no on-chain price oracle), and PEPU's USD price is volatile across exchanges. Fetch a live PEPU/USD price yourself if you need a dollar figure.",
      };

      if (response_format === "detailed") {
        result["gasPriceWei"] = gasPrice.toString();
        result["blockNumber"] = (await client.getBlockNumber()).toString();
      }

      return jsonResult(result);
    }
  );
}
