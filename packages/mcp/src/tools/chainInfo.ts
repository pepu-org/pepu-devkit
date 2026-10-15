/**
 * pepu_chain_info
 *
 * WHAT: Returns hand-verified network facts for PEPU mainnet and/or testnet —
 * chain ids, RPC URLs, explorer URLs, native currency, ArbOS version, and,
 * critically, a live-checkable table of which canonical infra contracts
 * (Multicall3, Permit2, EntryPoint) are and are not deployed.
 *
 * WHEN TO USE: Call this FIRST, before writing any PEPU-related code or
 * config (a defineChain object, a Hardhat/Foundry network entry, a Privy
 * chain config, a multicall setup). It prevents an entire class of mistakes:
 * assuming Multicall3 exists, assuming gas sponsorship works, confusing V1
 * (chain 3409) with V2 (chain 97741), or using the wrong explorer.
 *
 * Set `verify_live: true` to additionally cross-check chain id and current
 * base fee against the live RPC, rather than trusting only the cached facts.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CANONICAL_CONTRACTS, KNOWN_GOTCHAS, MAINNET, TESTNET, getNetworkInfo, type PepuNetwork } from "../constants.js";
import { getPepuAddresses } from "@pepu-chain/sdk";
import { getPublicClient } from "../rpc.js";
import { jsonResult, type ResponseFormat } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  network: z
    .enum(["mainnet", "testnet", "both"])
    .default("both")
    .describe("Which network to return facts for. Defaults to both since agents frequently need to compare them."),
  verify_live: z
    .boolean()
    .default(false)
    .describe("If true, also makes a live eth_chainId + eth_gasPrice RPC call to confirm the cached facts still hold, instead of only returning cached data."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: the facts an agent needs to not break something. detailed: adds full canonical-contract notes and known gotchas list."),
};

async function verifyLive(network: PepuNetwork) {
  const client = getPublicClient(network);
  try {
    const [chainId, gasPrice] = await Promise.all([client.getChainId(), client.getGasPrice()]);
    return { reachable: true as const, chainId, gasPriceWei: gasPrice.toString() };
  } catch (err) {
    return { reachable: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildNetworkPayload(network: PepuNetwork, format: ResponseFormat) {
  const info = getNetworkInfo(network);
  const base = {
    network: info.network,
    chainId: info.chainId,
    chainIdHex: info.chainIdHex,
    name: info.name,
    rpcUrl: info.rpcUrl,
    alternativeRpcUrls: info.alternativeRpcUrls,
    blockscoutExplorerUrl: info.blockscoutExplorerUrl,
    conduitExplorerUrl: info.conduitExplorerUrl,
    explorerGuidance: info.blockscoutExplorerUrl
      ? "Use blockscoutExplorerUrl for anything needing indexed data (address history, token analytics, verification). The Conduit explorer has no indexer."
      : "No Blockscout instance is registered for this network. The Conduit explorer is a raw RPC/block viewer only (no indexer) — this server's Blockscout-backed tools (address overview, transaction decode, verify status, search) will not work for this network.",
    nativeCurrency: info.nativeCurrency,
    arbOsVersion: info.arbOsVersion,
    arbOsName: info.arbOsName,
    settlesTo: info.settlesTo,
    daMode: info.daMode,
    eip7702Live: info.eip7702Live,
    p256PrecompileLive: info.p256PrecompileLive,
    referenceBaseFeePerGasGwei: (Number(info.referenceBaseFeePerGasWei) / 1e9).toLocaleString(),
    baseFeeNote: "Base fee is ~12,500 gwei-equivalent, far above typical L2s. This is expected: PEPU's USD unit price is very low, so wei-per-gas must be large to recover a fixed L1 data-posting cost. Do not treat this as a bug.",
  };

  if (format === "concise") {
    return base;
  }

  return {
    ...base,
    canonicalContracts: CANONICAL_CONTRACTS,
    // Full SDK registry rows (getPepuAddresses): Kernel policy modules, TapScore, paymaster v1 and the pending v2.
    contractRegistry: getPepuAddresses(info.chainId),
    knownGotchas: KNOWN_GOTCHAS,
  };
}

export function registerChainInfoTool(server: McpServer): void {
  server.registerTool(
    "pepu_chain_info",
    {
      title: "PEPU chain info",
      description:
        "Get verified Pepe Unchained (PEPU) V2 network facts: chain ids (mainnet 97741 / testnet 97740), RPC URLs, explorer URLs, native currency, ArbOS version, and which canonical infra contracts (Multicall3, Permit2, EntryPoint) are actually deployed (addresses come from the @pepu-chain/sdk contract registry via getPepuAddresses). Use this before writing any PEPU chain config, defineChain object, or Hardhat/Foundry network entry — it prevents assuming Multicall3 or gas sponsorship exist when they don't, and prevents confusing this chain (V2, 97741) with the unrelated legacy V1 chain (3409, OP Stack).",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ network, verify_live, response_format }) => {
      if (network !== "mainnet" && network !== "testnet" && network !== "both") {
        actionableError("Invalid network value.", `Got "${String(network)}".`, 'Use "mainnet", "testnet", or "both".');
      }

      const networks: PepuNetwork[] = network === "both" ? ["mainnet", "testnet"] : [network];
      const payload: Record<string, unknown> = {};

      for (const net of networks) {
        const data = buildNetworkPayload(net, response_format) as Record<string, unknown>;
        if (verify_live) {
          data["liveCheck"] = await verifyLive(net);
        }
        payload[net] = data;
      }

      if (response_format === "detailed" && network === "both") {
        payload["note"] = "V1 (Pepe Unchained legacy) is chain id 3409 on OP Stack and is unrelated to both networks above — never mix data between them.";
      }

      return jsonResult(payload);
    }
  );
}

// Re-exported for tests.
export { buildNetworkPayload, MAINNET, TESTNET };
