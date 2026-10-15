/**
 * viem clients for talking to PEPU's RPCs directly.
 *
 * The chain definitions come from @pepu-chain/sdk (`pepuMainnet`,
 * `pepuTestnet`), so chain id, RPC URL, native currency and the PEPU-specific
 * Multicall3 address are never re-declared here. The RPC URL honours
 * `PEPU_RPC_URL` through the SDK's `resolvePepuEndpoints` for mainnet.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { pepuMainnet, pepuTestnet, resolvePepuEndpoints } from "@pepu-chain/sdk";
import type { PepuNetwork } from "./constants.js";

export { pepuMainnet, pepuTestnet };

const clients = new Map<string, PublicClient>();

function mainnetRpcUrl(): string {
  try {
    return resolvePepuEndpoints().rpcUrl;
  } catch {
    // A malformed PEPU_RPC_URL must not take every read tool down; fall back to the public default.
    return pepuMainnet.rpcUrls.default.http[0];
  }
}

export function getPublicClient(network: PepuNetwork): PublicClient {
  const url = network === "mainnet" ? mainnetRpcUrl() : pepuTestnet.rpcUrls.default.http[0];
  const key = `${network}:${url}`;
  const cached = clients.get(key);
  if (cached) return cached;

  const chain = network === "mainnet" ? pepuMainnet : pepuTestnet;
  const client = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  clients.set(key, client);
  return client;
}
