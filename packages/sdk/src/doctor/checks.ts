import { pepuMainnet } from "../chains.js";
import { PEPU_ENV, PEPU_PUBLIC_ENV, resolvePepuEndpoints } from "../endpoints.js";
import { PepuConfigError } from "../errors.js";
import { PRIVY_APP_ID_PATTERN } from "./env.js";
import type { DoctorCheck } from "./types.js";

const TIMEOUT_MS = 8000;

async function rpc(f: typeof fetch, url: string, method: string): Promise<unknown> {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error !== undefined) throw new Error("JSON-RPC error");
  return json.result;
}

/** Privy app id format check. Never echoes the value. */
export function checkPrivyAppIdFormat(appId: string | undefined): DoctorCheck {
  const v = (appId ?? "").trim();
  if (v === "") {
    return {
      id: "privy.app-id",
      status: "fail",
      message: "NEXT_PUBLIC_PRIVY_APP_ID is not set.",
      fix: "Copy the App ID from the Privy dashboard (Settings).",
    };
  }
  if (!PRIVY_APP_ID_PATTERN.test(v)) {
    return {
      id: "privy.app-id",
      status: "fail",
      message: `NEXT_PUBLIC_PRIVY_APP_ID does not look like a Privy app id (length ${v.length}).`,
      fix: "Use the App ID, not the app secret or client id.",
    };
  }
  return { id: "privy.app-id", status: "pass", message: "Privy app id format looks right." };
}

/**
 * Check the chain RPC answers and reports chainId 97741.
 *
 * @example
 * ```ts
 * const c = await checkChainRpc({ rpcUrl: "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz" });
 * ```
 */
export async function checkChainRpc(o: { rpcUrl?: string; fetch?: typeof fetch } = {}): Promise<DoctorCheck> {
  const url = o.rpcUrl ?? pepuMainnet.rpcUrls.default.http[0];
  try {
    const result = await rpc(o.fetch ?? fetch, url, "eth_chainId");
    const id = typeof result === "string" ? Number.parseInt(result, 16) : Number.NaN;
    if (id !== pepuMainnet.id) {
      return {
        id: "chain.rpc",
        status: "fail",
        message: `RPC reports chainId ${String(id)}, expected ${pepuMainnet.id}.`,
        fix: `Point ${PEPU_ENV.rpcUrl} at a Pepe Unchained V2 mainnet RPC.`,
      };
    }
    return { id: "chain.rpc", status: "pass", message: `RPC reachable, chainId ${pepuMainnet.id}.` };
  } catch {
    return {
      id: "chain.rpc",
      status: "fail",
      message: "Chain RPC is unreachable.",
      fix: `Check ${PEPU_ENV.rpcUrl} and your network.`,
    };
  }
}

/**
 * Check the bundler and paymaster URLs resolved by the endpoints registry.
 * Unset (nothing to reach) is a skip; set but unreachable is a failure.
 * URLs are never included in messages: paymaster URLs embed credentials.
 *
 * @example
 * ```ts
 * const checks = await checkSponsorshipEndpoints({ env: process.env });
 * ```
 */
export async function checkSponsorshipEndpoints(
  o: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<DoctorCheck[]> {
  const f = o.fetch ?? fetch;
  let eps;
  try {
    eps = resolvePepuEndpoints(o.env ? { env: o.env } : {});
  } catch (e) {
    const msg = e instanceof PepuConfigError ? e.message : "Endpoint configuration is invalid.";
    return [
      {
        id: "sponsorship.endpoints",
        status: "fail",
        message: msg,
        fix: `Fix ${PEPU_ENV.bundlerUrl} / ${PEPU_ENV.paymasterUrl}.`,
      },
    ];
  }
  const out: DoctorCheck[] = [];
  if (eps.bundlerUrl === null) {
    out.push({
      id: "sponsorship.bundler",
      status: "skip",
      message: "No bundler URL configured.",
      fix: `Set ${PEPU_ENV.bundlerUrl} to https://bundler.pepeunchained.com or your own bundler (${PEPU_PUBLIC_ENV.bundlerUrl} for browser use).`,
    });
  } else {
    try {
      const r = await rpc(f, eps.bundlerUrl, "eth_supportedEntryPoints");
      out.push(
        Array.isArray(r) && r.length > 0
          ? { id: "sponsorship.bundler", status: "pass", message: "Bundler reachable and reports supported entry points." }
          : { id: "sponsorship.bundler", status: "warn", message: "Bundler answered but reported no entry points." },
      );
    } catch {
      out.push({
        id: "sponsorship.bundler",
        status: "fail",
        message: "Bundler is unreachable.",
        fix: `Check ${PEPU_ENV.bundlerUrl} and that the bundler is running.`,
      });
    }
  }
  // No token URL: reach the service base through its /health route.
  const paymasterTarget = eps.paymasterUrl ?? (eps.paymasterBaseUrl === null ? null : `${eps.paymasterBaseUrl}/health`);
  if (paymasterTarget === null) {
    out.push({
      id: "sponsorship.paymaster",
      status: "skip",
      message: "No paymaster URL configured.",
      fix: `Set ${PEPU_ENV.paymasterUrl} to https://paymaster.pepeunchained.com/v2/paymaster/<client token> or your own paymaster.`,
    });
  } else {
    try {
      // Any HTTP response proves reachability; auth or method errors are expected.
      await f(paymasterTarget, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
      out.push({ id: "sponsorship.paymaster", status: "pass", message: "Paymaster endpoint reachable." });
    } catch {
      out.push({
        id: "sponsorship.paymaster",
        status: "fail",
        message: "Paymaster is unreachable.",
        fix: `Check ${PEPU_ENV.paymasterUrl} and that the paymaster service is running.`,
      });
    }
  }
  return out;
}
