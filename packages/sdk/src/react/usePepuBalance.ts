import { useCallback, useEffect, useState } from "react";
import { erc20Abi } from "viem";
import type { Address, PublicClient, Transport } from "viem";

import type { PepuChain } from "../chains.js";

/** Options for {@link usePepuBalance}. */
export interface UsePepuBalanceOptions {
  /** Address to read a balance for. The hook holds `data` at `undefined` while this is `undefined`. */
  readonly address: Address | undefined;
  /** ERC-20 token address to read `balanceOf` for. Omit for the native PEPU balance (`client.getBalance`). */
  readonly token?: Address;
  /** Re-fetch on an interval, in milliseconds. Omit (or `0`) to fetch once. */
  readonly pollingInterval?: number;
}

/** Result of {@link usePepuBalance}. */
export interface UsePepuBalanceResult {
  /** The balance in the smallest unit (wei for native PEPU, the token's own base unit for an ERC-20), or `undefined` before the first successful fetch. */
  readonly data: bigint | undefined;
  readonly isLoading: boolean;
  readonly error: Error | undefined;
  /** Re-run the fetch immediately, outside the polling interval. */
  readonly refetch: () => void;
}

/**
 * Read (and optionally poll) an address's native PEPU balance, or an
 * ERC-20 token balance on a PEPU chain, given a viem `PublicClient`.
 *
 * Deliberately takes the client as a parameter rather than reaching for one
 * itself (e.g. via a context provider this package would have to define
 * and ship) — this keeps the hook usable with whatever client the host app
 * already has (its own `getPublicClient` call, wagmi's `usePublicClient()`,
 * etc.) instead of introducing a second, competing way to obtain one.
 */
export function usePepuBalance(
  client: PublicClient<Transport, PepuChain>,
  options: UsePepuBalanceOptions,
): UsePepuBalanceResult {
  const { address, token, pollingInterval } = options;
  const [data, setData] = useState<bigint | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!address) {
      setData(undefined);
      setError(undefined);
      return;
    }
    setIsLoading(true);
    try {
      const balance = token
        ? await client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          })
        : await client.getBalance({ address });
      setData(balance);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setIsLoading(false);
    }
  }, [client, address, token]);

  useEffect(() => {
    void fetchBalance();
    if (!pollingInterval) {
      return;
    }
    const id = setInterval(() => {
      void fetchBalance();
    }, pollingInterval);
    return () => clearInterval(id);
  }, [fetchBalance, pollingInterval]);

  const refetch = useCallback(() => {
    void fetchBalance();
  }, [fetchBalance]);

  return { data, isLoading, error, refetch };
}
