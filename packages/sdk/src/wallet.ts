import type { AddEthereumChainParameter, EIP1193Provider } from "viem";
import { numberToHex } from "viem";

import type { PepuChain } from "./chains.js";

/**
 * Build the parameter object for an EIP-3085 `wallet_addEthereumChain`
 * request from a {@link PepuChain}, so callers don't have to hand-assemble
 * (and risk mistyping) `chainId` hex encoding, `nativeCurrency`, RPC URLs,
 * and explorer URLs themselves.
 *
 * Omits `blockExplorerUrls` entirely when the chain has no configured
 * explorer (currently {@link pepuTestnet} — see `chains.ts`) rather than
 * sending an empty array or a guessed URL.
 */
export function toAddEthereumChainParameter(
  chain: PepuChain,
): AddEthereumChainParameter {
  const explorerUrl = chain.blockExplorers?.default.url;
  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    ...(explorerUrl ? { blockExplorerUrls: [explorerUrl] } : {}),
  };
}

/**
 * The standard EIP-1193 error code a wallet returns from
 * `wallet_switchEthereumChain` when it doesn't recognize the target chain
 * yet (EIP-3326) — the signal to fall back to `wallet_addEthereumChain`.
 */
const CHAIN_NOT_RECOGNIZED_ERROR_CODE = 4902;

function isChainNotRecognizedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === CHAIN_NOT_RECOGNIZED_ERROR_CODE
  );
}

/**
 * Switch an EIP-1193 provider (e.g. `window.ethereum`) to a
 * {@link PepuChain}, adding it first via `wallet_addEthereumChain` if the
 * wallet doesn't already recognize the chain (error code `4902` per
 * EIP-3326) — the two-step dance almost every dapp ends up hand-rolling.
 *
 * If you already have a viem `WalletClient`, its own `switchChain`/`addChain`
 * actions work the same way at the RPC level; this helper is for the plainer
 * "I just have an injected provider" case and does the fallback viem's
 * `switchChain` alone does not (see `viem/actions`' `switchChain.js` — it
 * only ever sends `wallet_switchEthereumChain`).
 *
 * Rethrows any other error unchanged (e.g. the user rejecting either
 * prompt), and rethrows the original switch error if the wallet doesn't
 * report the standard `4902` code for an unrecognized chain — some wallets
 * are known to deviate from the EIP-3326 error code, and this helper does
 * not attempt to paper over that.
 */
export async function switchOrAddPepuChain(
  provider: EIP1193Provider,
  chain: PepuChain,
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: numberToHex(chain.id) }],
    });
  } catch (error) {
    if (!isChainNotRecognizedError(error)) {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [toAddEthereumChainParameter(chain)],
    });
  }
}
