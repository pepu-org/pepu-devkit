import type { Address } from "viem";
import { PEPU_ERROR_CATALOG, PepuAuthError, PepuError, toPepuError } from "../errors.js";
import type { PepuErrorCode } from "../errors.js";

/**
 * Framework-free client for the ensure-wallet route. No React, no Privy: the
 * hooks in `./react.ts` wrap it, and tests drive it directly.
 *
 * Ported from templates/consumer-app/components/wallet-gate.tsx (request,
 * timeout and response handling).
 */

/** Default route path, matching `createEnsureWalletRoute()`. */
export const DEFAULT_ENSURE_ENDPOINT = "/api/wallet/ensure";
/** Bound on the request itself (consumer-app: ENSURE_REQUEST_TIMEOUT_MS). */
export const DEFAULT_ENSURE_REQUEST_TIMEOUT_MS = 20_000;
/** Bound on waiting for the wallet to show up client-side (consumer-app: APPEAR_IN_CLIENT_TIMEOUT_MS). */
export const DEFAULT_ENSURE_APPEAR_TIMEOUT_MS = 8_000;

const KNOWN_CODES: ReadonlySet<string> = new Set(PEPU_ERROR_CATALOG.map((e) => e.code));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Turn a non-2xx response body into a typed error. Understands the SDK shape
 * `{ error: { code, message, hint } }` and the legacy `{ error: "text" }`.
 */
export function errorFromEnsureResponse(status: number, body: unknown): PepuError {
  const err = isRecord(body) ? body["error"] : undefined;
  if (isRecord(err)) {
    const code = typeof err["code"] === "string" && KNOWN_CODES.has(err["code"]) ? (err["code"] as PepuErrorCode) : "UNKNOWN";
    const message = typeof err["message"] === "string" ? err["message"] : `Wallet setup failed (HTTP ${status}).`;
    const hint = typeof err["hint"] === "string" ? err["hint"] : undefined;
    const opts = { status, ...(hint !== undefined ? { hint } : {}) };
    return status === 401 ? new PepuAuthError(code, message, opts) : new PepuError(code, message, opts);
  }
  const message = typeof err === "string" ? err : `Wallet setup failed (HTTP ${status}).`;
  if (status === 401) return new PepuAuthError("AUTH_INVALID_TOKEN", message, { status });
  return new PepuError("WALLET_NOT_PROVISIONED", message, { status });
}

/**
 * POST to the ensure-wallet route with the user's Privy access token and return
 * the wallet address. Bounded by a timeout. Never leaks the token in errors.
 *
 * @example
 * ```ts
 * const { address } = await requestEnsureWallet({ getAccessToken, endpoint: "/api/wallet/ensure" });
 * ```
 */
export async function requestEnsureWallet(o: {
  getAccessToken: () => Promise<string | null>;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ address: Address; created: boolean }> {
  const token = await o.getAccessToken();
  if (!token) {
    throw new PepuAuthError(
      "AUTH_INVALID_TOKEN",
      "Could not get a Privy access token for this session. Try signing in again.",
    );
  }
  const controller = new AbortController();
  const timeoutMs = o.timeoutMs ?? DEFAULT_ENSURE_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  o.signal?.addEventListener("abort", onAbort);
  try {
    const doFetch = o.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(o.endpoint ?? DEFAULT_ENSURE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) {
        throw new PepuError("WALLET_NOT_PROVISIONED", "Wallet setup timed out. Please try again.", {
          retryable: true,
          cause: e,
        });
      }
      throw toPepuError(e, { op: "ensure wallet" });
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw errorFromEnsureResponse(response.status, body);
    const address = isRecord(body) ? body["address"] : undefined;
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new PepuError("WALLET_NOT_PROVISIONED", "The ensure-wallet route did not return a wallet address.", {
        status: 502,
      });
    }
    return { address: address as Address, created: isRecord(body) && body["created"] === true };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}
