/**
 * Shared helpers for tools that accept either a transaction hash or an
 * ERC-4337 UserOperation hash: resolving a UserOperation hash to the bundle
 * transaction that included it (through the configured bundler), and
 * recognising the RPC "not found" error.
 */

import { isHash, type Hash } from "viem";

/** Resolves a UserOperation hash to its bundle transaction hash via `eth_getUserOperationReceipt`. Returns null when unknown or unreachable. */
export async function userOpToTxHash(bundlerUrl: string, userOpHash: string): Promise<Hash | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [userOpHash] }),
      signal: ctl.signal,
    });
    const body = (await res.json()) as { result?: { receipt?: { transactionHash?: string } } | null };
    const h = body.result?.receipt?.transactionHash;
    return h && isHash(h) ? h : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True for viem's "transaction/receipt could not be found" errors. */
export function isNotFound(e: unknown): boolean {
  return e instanceof Error && (e.name === "TransactionNotFoundError" || /could not be found/i.test(e.message));
}
