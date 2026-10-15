/** Small helpers shared by the SDK-backed tools. */

import { PepuError, explainError, getErrorEntry, type PepuErrorCode } from "@pepu-chain/sdk";
import { PepuToolError } from "./errors.js";

/** Host (and port) of a URL, never the path or query: paymaster URLs can embed a credential. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid URL)";
  }
}

/** A PepuError (or anything) as plain data the model can act on. Never includes `cause` or `details`. */
export function describeSdkError(e: unknown): { code: PepuErrorCode; message: string; hint: string; docsUrl: string; retryable: boolean } {
  if (e instanceof PepuError) {
    return { code: e.code, message: e.message, hint: e.hint, docsUrl: e.docsUrl, retryable: e.retryable };
  }
  const ex = explainError(e);
  const entry = getErrorEntry(ex.code);
  return {
    code: ex.code,
    message: e instanceof Error ? e.message : String(e),
    hint: ex.fix,
    docsUrl: ex.docsUrl,
    retryable: entry.retryable,
  };
}

/** Run an SDK call and turn its failure into a tool error that carries the SDK's code, message and hint. */
export async function sdkCall<T>(what: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PepuToolError) throw e;
    const d = describeSdkError(e);
    throw new PepuToolError(`${what} failed (${d.code}): ${d.message} Fix: ${d.hint} Docs: ${d.docsUrl}`);
  }
}

export const HOSTED_ENDPOINTS_NOTE =
  "Hosted PEPU endpoints are live: the bundler at https://bundler.pepeunchained.com (the SDK default for PEPU_BUNDLER_URL) and the paymaster service at https://paymaster.pepeunchained.com (the SDK default base for the REST API and probes). The ERC-7677 paymaster URL always embeds a token: https://paymaster.pepeunchained.com/v2/paymaster/<token>. Use your project's client token (works only from the project's allowed origins), the project server key (ppk_, backend only), or a free-tier app token plus a Privy access token in the ERC-7677 context. Set PEPU_PAYMASTER_URL to that URL.";

export const V2_CANARY_NOTE =
  "The v2 (tiered, deposit-only) paymaster PepuSponsoredPaymasterV7 is deployed on PEPU mainnet as a canary at 0xdb28528C9399C33c9A0297E8A62F39145acbC30D: internally reviewed 3 times, external audit pending, funded in small tranches. The v1 paymaster is retired (deposit withdrawn). Free tier per Privy user is 100 PEPU/day and 50 PEPU/hour via the policy service, TapScore targets only for now; beyond that a dApp deposits into its own project. Deposits are one-way.";

export const V2_NOT_DEPLOYED_NOTE =
  "No v2 paymaster address is available (the registry entry is missing and none was passed). Pass an explicit paymaster address only for a contract you have verified yourself.";
