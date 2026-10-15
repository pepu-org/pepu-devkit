/**
 * pepu_health_check
 *
 * WHAT: Composes multiple reachability checks — RPC (mainnet and/or
 * testnet), and pepuscan's Blockscout API on mainnet — into one call, and
 * explicitly cross-references them against verified baseline facts (expected
 * chain id, whether a Blockscout instance should even exist for this
 * network). This catches a PEPU-specific trap a plain "is the RPC up" ping
 * would miss: the RPC being perfectly healthy while pepuscan lags or is
 * unreachable, or a caller assuming testnet has an indexer at all when it
 * never has one.
 *
 * WHEN TO USE: Before debugging "why did my call fail" as if it were your
 * code's fault — rule out chain-side unavailability first. Also useful when
 * a user reports "the explorer isn't showing my transaction" to quickly
 * distinguish "pepuscan is behind/down" from "wrong network" from "pepuscan
 * was never going to have this" (testnet).
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicClient } from "../rpc.js";
import { getStats } from "../blockscout.js";
import { getNetworkInfo, type PepuNetwork } from "../constants.js";
import { resolvePepuEndpoints } from "@pepu-chain/sdk";
import { probeBundler, probePaymaster } from "@pepu-chain/sdk/aa";
import { jsonResult } from "../format.js";

const inputSchema = {
  network: z
    .enum(["mainnet", "testnet", "both"])
    .default("both")
    .describe("Which network(s) to check. Blockscout reachability is only ever checked for mainnet — testnet has no registered instance to check."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: reachable yes/no + latest block per check. detailed: adds latency, raw stats, and full error text on failure."),
};

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; latencyMs: number; value: T } | { ok: false; latencyMs: number; error: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, latencyMs: Date.now() - start, value };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRpc(network: PepuNetwork, format: "concise" | "detailed"): Promise<CheckResult> {
  const client = getPublicClient(network);
  const info = getNetworkInfo(network);
  const result = await timed(() => Promise.all([client.getChainId(), client.getBlockNumber()]));

  if (!result.ok) {
    return { ok: false, latencyMs: result.latencyMs, error: result.error };
  }

  const [chainId, blockNumber] = result.value;
  const chainIdMatches = chainId === info.chainId;
  const detail: Record<string, unknown> = {
    rpcUrl: info.rpcUrl,
    latestBlock: blockNumber.toString(),
    chainIdMatchesExpected: chainIdMatches,
  };
  if (format === "detailed") detail["chainId"] = chainId;

  if (chainIdMatches) {
    return { ok: true, latencyMs: result.latencyMs, detail };
  }
  return {
    ok: false,
    latencyMs: result.latencyMs,
    detail,
    error: `RPC responded but reported chain id ${chainId}, expected ${info.chainId}. Double check rpcUrl.`,
  };
}

async function checkBlockscout(format: "concise" | "detailed"): Promise<CheckResult> {
  const result = await timed(() => getStats());
  if (!result.ok) {
    return { ok: false, latencyMs: result.latencyMs, error: result.error };
  }
  const detail: Record<string, unknown> = { indexedBlocks: result.value.total_blocks };
  if (format === "detailed") {
    detail["totalTransactions"] = result.value.total_transactions;
    detail["gasPricesGwei"] = result.value.gas_prices;
  }
  return { ok: true, latencyMs: result.latencyMs, detail };
}

function shapeCheck(name: string, check: CheckResult, format: "concise" | "detailed"): Record<string, unknown> {
  const out: Record<string, unknown> = { check: name, reachable: check.ok };
  if (format === "detailed" && check.latencyMs !== undefined) out["latencyMs"] = check.latencyMs;
  if (check.detail) Object.assign(out, check.detail);
  if (check.error) out["error"] = check.error;
  return out;
}

/**
 * Bundler and paymaster rows via the SDK probes, against PEPU_BUNDLER_URL / PEPU_PAYMASTER_URL, which default to the hosted
 * PEPU services (the paymaster is probed at its base unless a token URL is set). Never returns the URLs, only hosts: they can embed credentials.
 */
async function checkSponsorshipServices(): Promise<Array<Record<string, unknown>>> {
  let endpoints;
  try {
    endpoints = resolvePepuEndpoints();
  } catch {
    return [{ check: "bundler and paymaster", reachable: false, error: "PEPU_BUNDLER_URL or PEPU_PAYMASTER_URL is not a valid http(s) URL." }];
  }
  const rows: Array<Record<string, unknown>> = [];
  if (endpoints.bundlerUrl) {
    const r = await probeBundler(endpoints.bundlerUrl);
    rows.push({ check: "mainnet bundler", reachable: r.ok, latencyMs: r.latencyMs, chainId: r.chainId ?? null, ...(r.error ? { error: r.error.message } : {}) });
  }
  const paymasterTarget = endpoints.paymasterUrl ?? endpoints.paymasterBaseUrl;
  if (paymasterTarget) {
    const r = await probePaymaster(paymasterTarget);
    rows.push({ check: "mainnet paymaster", reachable: r.ok, latencyMs: r.latencyMs, ...(r.error ? { error: r.error.message } : {}) });
  }
  if (rows.length === 0) {
    rows.push({ check: "bundler and paymaster", reachable: null, note: "No bundler or paymaster endpoint resolved. The hosted defaults are https://bundler.pepeunchained.com and https://paymaster.pepeunchained.com; see pepu_sponsorship_status." });
  }
  return rows;
}

export function registerHealthCheckTool(server: McpServer): void {
  server.registerTool(
    "pepu_health_check",
    {
      title: "PEPU infra health check",
      description:
        "Check whether PEPU's RPC (mainnet and/or testnet) and pepuscan's Blockscout API (mainnet only) are reachable right now, with the current chain id and latest block/indexed-block-count for each. Use this to rule out chain-side unavailability before assuming a bug in your own code, or to explain to a user why 'the explorer doesn't show my tx yet' (RPC up but pepuscan behind) versus 'wrong network' (chain id mismatch) versus 'testnet has no explorer at all' (expected, not a fault).",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ network, response_format }) => {
      const networks: PepuNetwork[] = network === "both" ? ["mainnet", "testnet"] : [network];
      const checks: Array<Record<string, unknown>> = [];

      for (const net of networks) {
        const rpc = await checkRpc(net, response_format);
        checks.push(shapeCheck(`${net} RPC`, rpc, response_format));
      }

      if (networks.includes("mainnet")) {
        const blockscout = await checkBlockscout(response_format);
        checks.push(shapeCheck("mainnet Blockscout (pepuscan)", blockscout, response_format));
      }
      if (networks.includes("testnet")) {
        checks.push({
          check: "testnet Blockscout",
          reachable: null,
          note: "Not checked: no Blockscout instance is registered for testnet (97740) as of the last verification — this is expected, not a fault. See pepu_known_gotchas.",
        });
      }

      if (networks.includes("mainnet")) {
        checks.push(...(await checkSponsorshipServices()));
      }

      const allOk = checks.every((c) => c["reachable"] !== false);
      return jsonResult({ overall: allOk ? "healthy" : "degraded", checks });
    }
  );
}
