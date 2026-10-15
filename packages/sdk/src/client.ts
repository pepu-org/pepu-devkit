import { type PublicClient, type Transport, createPublicClient, http } from "viem";

import type { PepuChain } from "./chains.js";

/**
 * Create a viem `PublicClient` for a Pepe Unchained V2 chain, defaulting
 * its transport to the chain's first `rpcUrls.default.http` entry.
 *
 * Pass `transport` to use a different RPC endpoint (e.g. an authenticated
 * provider URL) while keeping the rest of the chain definition.
 */
export function getPublicClient(
  chain: PepuChain,
  options?: { transport?: Transport },
): PublicClient<Transport, PepuChain> {
  // `http()` with no URL falls back to `chain.rpcUrls.default.http[0]`
  // internally (see viem's `http` transport), so the chain definition
  // stays the single source of truth for the default RPC endpoint.
  const transport = options?.transport ?? http();
  return createPublicClient({ chain, transport });
}
