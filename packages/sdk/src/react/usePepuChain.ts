import { useMemo } from "react";

import { pepuChains } from "../chains.js";
import type { PepuChain } from "../chains.js";

/** Result of {@link usePepuChain}. */
export interface UsePepuChainResult {
  /** The matching {@link PepuChain}, or `undefined` if `chainId` isn't one of PEPU's. */
  readonly chain: PepuChain | undefined;
  /** `true` iff `chainId` is one of PEPU's chain ids. Equivalent to `chain !== undefined`. */
  readonly isPepuChain: boolean;
}

/**
 * Resolve a raw chain id (e.g. from wagmi's `useChainId()`, or an injected
 * wallet's `eth_chainId`) to its {@link PepuChain} definition, if it's one
 * of PEPU's. Pure lookup over {@link pepuChains} — makes no network call
 * and holds no state beyond memoizing the result.
 */
export function usePepuChain(chainId: number | undefined): UsePepuChainResult {
  return useMemo(() => {
    const chain = pepuChains.find((candidate) => candidate.id === chainId);
    return { chain, isPepuChain: chain !== undefined };
  }, [chainId]);
}
