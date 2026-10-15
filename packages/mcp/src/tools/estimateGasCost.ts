/**
 * pepu_estimate_gas_cost
 *
 * WHAT: Estimates a transaction's gas cost on PEPU and converts it to PEPU
 * (not just wei), while explicitly flagging the chain's unusually high
 * ~12,500 gwei-equivalent base fee so it doesn't get mistaken for a bug or a
 * misconfigured RPC. Handles three shapes: a live call (`to` + optional
 * `data`/`value`/`from`), a live contract deployment (`data` = init
 * bytecode, `to` omitted), or a known `gas_limit` you just want priced.
 *
 * WHEN TO USE: Before submitting a transaction, to sanity-check its cost, or
 * when explaining to a user why a gas quote in "gwei" looks enormous
 * compared to what they've seen on other chains. Works on mainnet and
 * testnet. Does NOT convert to USD — pepuscan has no price oracle for PEPU
 * (its exchange_rate field is always null), and PEPU's USD price is
 * reported as volatile across exchanges, so a hardcoded conversion here
 * would go stale immediately. Pull a live PEPU/USD price from your own
 * price feed if you need a dollar figure.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { isAddress } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicClient } from "../rpc.js";
import { formatPepu, jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const HEX_DATA_RE = /^0x([0-9a-fA-F]{2})*$/;

const inputSchema = {
  network: z.enum(["mainnet", "testnet"]).default("mainnet"),
  to: z
    .string()
    .optional()
    .describe("Recipient/contract address for a live call estimate. Omit for a contract-deployment estimate (pass init bytecode as `data` instead) or if you're supplying gas_limit directly."),
  from: z.string().optional().describe("Sender address to simulate from (affects estimation for calls that branch on msg.sender). Optional."),
  data: z.string().default("0x").describe("Calldata, 0x-prefixed hex. For a plain value transfer, leave as default. For a contract deployment estimate, pass the full init bytecode here and omit `to`."),
  value: z.string().default("0").describe("Value to send, in wei, as a string."),
  gas_limit: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Skip live estimation and price this exact gas amount instead — use this if you already know the gas cost of an operation (e.g. from a prior simulation) and just want current PEPU pricing."),
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

export function registerEstimateGasCostTool(server: McpServer): void {
  server.registerTool(
    "pepu_estimate_gas_cost",
    {
      title: "PEPU gas cost estimate",
      description:
        "Estimate the PEPU cost of a transaction — live-simulating a call to an address, live-simulating a contract deployment (pass init bytecode as `data` with no `to`), or pricing a `gas_limit` you already know — using the current live gas price. Explicitly explains PEPU's unusually high ~12,500 gwei-equivalent base fee so it isn't mistaken for an error. Does not produce a USD figure — no price oracle exists for PEPU on-chain and its price is volatile; bring your own price feed for that conversion.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ network, to, from, data, value, gas_limit, response_format }) => {
      const isDeploymentEstimate = to === undefined && data !== "0x";
      if (to === undefined && gas_limit === undefined && !isDeploymentEstimate) {
        actionableError(
          "Need `to` (to simulate a live call), `data` with no `to` (to simulate a contract deployment), or `gas_limit` (to price a known amount).",
          "None of those were provided.",
          'Pass `to` (and optionally `data`/`value`/`from`) for a live call estimate, `data` alone (init bytecode, no `to`) for a deployment estimate, or `gas_limit` if you already know the gas cost.'
        );
      }
      if (to !== undefined && !isAddress(to)) {
        actionableError(`"${to}" is not a valid address.`, "`to` must be 0x-prefixed with 40 hex characters.", "Fix the address or omit `to` and pass `gas_limit` instead.");
      }
      if (from !== undefined && !isAddress(from)) {
        actionableError(`"${from}" is not a valid address.`, "`from` must be 0x-prefixed with 40 hex characters.", "Fix the address or omit it.");
      }
      if (!HEX_DATA_RE.test(data)) {
        actionableError(`"${data}" is not valid calldata.`, "It must be 0x-prefixed hex with an even number of digits.", 'Use "0x" for no calldata.');
      }

      let valueWei: bigint;
      try {
        valueWei = BigInt(value);
      } catch {
        actionableError(`"${value}" is not a valid wei amount.`, "It must be a base-10 integer string.", 'Use "0" if there is no value transfer.');
      }

      const client = getPublicClient(network);
      const gasPrice = await client.getGasPrice();

      let gasUnits: bigint;
      let source: string;
      if (gas_limit !== undefined) {
        try {
          gasUnits = BigInt(gas_limit);
        } catch {
          actionableError(`"${String(gas_limit)}" is not a valid gas amount.`, "It must be a whole number.", "Pass an integer, e.g. 150000.");
        }
        source = "provided gas_limit (not live-simulated)";
      } else if (isDeploymentEstimate) {
        try {
          gasUnits = await client.estimateGas({
            account: from as `0x${string}` | undefined,
            data: data as `0x${string}`,
            value: valueWei,
          });
          source = "live eth_estimateGas simulation (contract deployment — no `to`)";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          actionableError(
            `eth_estimateGas failed for a contract deployment on ${network}.`,
            `RPC error: ${message}`,
            "This usually means the constructor would revert (wrong constructor args ABI-encoded onto the end of the bytecode, or a failing constructor require()). Pass `gas_limit` directly instead if you just want pricing for a known-good deployment."
          );
        }
      } else {
        try {
          gasUnits = await client.estimateGas({
            account: from as `0x${string}` | undefined,
            to: to as `0x${string}`,
            data: data as `0x${string}`,
            value: valueWei,
          });
          source = "live eth_estimateGas simulation";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          actionableError(
            `eth_estimateGas failed for a call to ${to} on ${network}.`,
            `RPC error: ${message}`,
            "This usually means the call would revert (wrong calldata/args, insufficient `value`, or a contract-side require() failing). Pass `gas_limit` directly instead if you just want pricing for a known-good operation."
          );
        }
      }

      const costWei = gasUnits * gasPrice;
      const result: Record<string, unknown> = {
        network,
        gasUnits: gasUnits.toString(),
        gasSource: source,
        gasPriceWei: gasPrice.toString(),
        gasPriceGwei: (Number(gasPrice) / 1e9).toLocaleString(),
        costWei: costWei.toString(),
        costPepu: formatPepu(costWei.toString()),
        baseFeeNote:
          "PEPU's gas price is naturally in the thousands of gwei-equivalent (currently ~" +
          (Number(gasPrice) / 1e9).toLocaleString() +
          ") because PEPU's own USD unit price is very low — the chain must charge more wei-per-gas to recover a fixed L1 data-posting cost. This is expected, not a sign of network congestion or a bad RPC.",
      };

      if (response_format === "detailed") {
        const referenceOps = [
          { label: "simple native transfer", gas: 21000n },
          { label: "typical ERC-20 transfer", gas: 65000n },
          { label: "typical Uniswap-V3-style swap", gas: 180000n },
        ];
        result["referenceCosts"] = referenceOps.map((op) => ({
          label: op.label,
          gasUnits: op.gas.toString(),
          costPepu: formatPepu((op.gas * gasPrice).toString()),
        }));
        result["usdConversionNote"] =
          "Not provided: pepuscan reports no exchange_rate for PEPU (no on-chain price oracle wired up), and PEPU's USD price is volatile across exchanges. Fetch a live PEPU/USD price yourself if you need a dollar figure.";
      }

      return jsonResult(result);
    }
  );
}
