import type { Address, PublicClient } from "viem";

import { entryPointV07Abi } from "../abi/entryPointV07.js";
import { pepuMainnet } from "../chains.js";
import { getContract } from "../contracts.js";
import { resolvePepuEndpoints } from "../endpoints.js";
import { PepuBundlerError, PepuConfigError, PepuPaymasterError } from "../errors.js";
import { redactSecrets } from "./describe.js";

/** Minimal fetch signature, so tests and non-browser hosts can inject one. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProbeOptions {
  fetch?: FetchLike;
  /** Per-request timeout. Default 8000. */
  timeoutMs?: number;
}

export interface BundlerProbeResult {
  ok: boolean;
  chainId?: number;
  entryPoints?: Address[];
  /**
   * `true` when the method exists. Each method is called with deliberately empty
   * (invalid) params, so nothing is ever sent on-chain: an "invalid params" or
   * validation answer means the method exists, a "method not found" answer
   * (including Alto's "Invalid discriminator value") means it does not.
   */
  supportedMethods?: Record<string, boolean>;
  /** Required methods (see `REQUIRED_BUNDLER_METHODS`) the bundler lacks. Empty when all are present. */
  missingRequiredMethods?: string[];
  latencyMs: number;
  error?: PepuBundlerError;
}

export interface PaymasterProbeResult {
  ok: boolean;
  /** `GET <origin>/health` answered `{ status: "ok" }`. */
  health?: boolean;
  /** Body of `GET <origin>/v2/free-tier` when the service exposes it. */
  freeTier?: unknown;
  /**
   * `true` when the URL answered `pm_getPaymasterStubData` with a stub result,
   * `false` when it did not answer JSON-RPC at all. A JSON-RPC denial (no
   * credential, unknown sender) leaves it `undefined`: the endpoint speaks
   * ERC-7677 but the probe has no credential, so a stub cannot be judged. Read
   * `erc7677` for the three-way answer.
   */
  erc7677StubOk?: boolean;
  /**
   * `"stub-ok"`: a stub came back. `"needs-credential"`: the endpoint speaks ERC-7677
   * JSON-RPC and answered with an error (no credential, unknown sender), so the stub
   * check is not applicable without a client token. `"not-responding"`: no JSON-RPC answer.
   */
  erc7677?: "stub-ok" | "needs-credential" | "not-responding";
  /** `GET <origin>/v2/free-tier` answered 200 (the hosted free tier is exposed). */
  freeTierOk?: boolean;
  /** The ERC-7677 route probed when only a service base was given (`<origin>/v2/paymaster/<probe>`). Real tokens are never echoed. */
  erc7677Route?: string;
  latencyMs: number;
  error?: PepuPaymasterError;
}

const BUNDLER_METHODS = [
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
  "zd_getUserOperationGasPrice",
] as const;

/** Methods a bundler must support to be usable for PEPU sponsored UserOperations. */
export const REQUIRED_BUNDLER_METHODS = [
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
] as const;

const METHOD_NOT_FOUND = -32601;

/**
 * A bundler answers a method that does not exist with "method not found". Alto
 * (Pimlico) also reports bad params of a KNOWN method with code -32601 and a
 * "Validation error: ..." message, and an unknown method as "Validation error:
 * Invalid discriminator value". So -32601 means unsupported unless the message is
 * a params validation error that is not the discriminator one.
 */
function isMethodNotFound(error: { code?: number; message?: string } | undefined): boolean {
  if (!error || error.code !== METHOD_NOT_FOUND) return false;
  const message = error.message ?? "";
  if (/invalid discriminator value/i.test(message)) return true;
  return !/validation error|invalid params|must contain|required at/i.test(message);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the configured host";
  }
}

function checkUrl(url: string, label: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PepuConfigError("CONFIG_BAD_URL", `${label} is not a valid URL.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new PepuConfigError("CONFIG_BAD_URL", `${label} must be an http(s) URL.`);
  }
}

async function timedFetch(f: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

interface RpcReply {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

async function rpc(f: FetchLike, url: string, method: string, params: unknown[], timeoutMs: number): Promise<RpcReply> {
  const res = await timedFetch(
    f,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    timeoutMs,
  );
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status} with a non-JSON body`);
  }
  if (!body || typeof body !== "object") throw new Error(`HTTP ${res.status} with an unexpected body`);
  return body as RpcReply;
}

function reasonOf(e: unknown): string {
  return e instanceof Error && e.name === "AbortError" ? "timed out" : redactSecrets(e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "[url]");
}

function unreachable(url: string, e: unknown): PepuBundlerError {
  return new PepuBundlerError("BUNDLER_UNREACHABLE", `Could not reach ${hostOf(url)}: ${reasonOf(e)}`, { cause: e });
}

function paymasterUnreachable(url: string, e: unknown): PepuPaymasterError {
  return new PepuPaymasterError("PAYMASTER_UNREACHABLE", `Could not reach ${hostOf(url)}: ${reasonOf(e)}`, {
    cause: e,
    hint: "Check PEPU_PAYMASTER_URL and your network. The hosted paymaster service is https://paymaster.pepeunchained.com; its ERC-7677 endpoint is https://paymaster.pepeunchained.com/v2/paymaster/<client token>.",
  });
}

/**
 * Probe a bundler URL: `eth_chainId`, `eth_supportedEntryPoints` and a
 * capability check of the methods PEPU apps use (a method answered with
 * anything but "method not found" counts as supported; nothing is sent
 * on-chain). Never throws for network trouble; returns `ok: false` with a
 * `BUNDLER_UNREACHABLE` error. Throws `CONFIG_BAD_URL` for a malformed URL.
 *
 * @example
 * const r = await probeBundler("https://bundler.example.com");
 * if (!r.ok) console.log(r.error?.hint);
 */
export async function probeBundler(url?: string | null, o: ProbeOptions = {}): Promise<BundlerProbeResult> {
  if (url === null || url === undefined || url.trim() === "") {
    const hosted = resolvePepuEndpoints().bundlerUrl;
    if (hosted === null) {
      throw new PepuConfigError("CONFIG_MISSING_ENV", "No bundler URL is configured.", { hint: "Pass a URL or set PEPU_BUNDLER_URL." });
    }
    url = hosted;
  }
  checkUrl(url, "Bundler URL");
  const f: FetchLike = o.fetch ?? ((i, init) => fetch(i, init));
  const timeoutMs = o.timeoutMs ?? 8000;
  const started = Date.now();
  try {
    const chain = await rpc(f, url, "eth_chainId", [], timeoutMs);
    const eps = await rpc(f, url, "eth_supportedEntryPoints", [], timeoutMs);
    const chainId = typeof chain.result === "string" ? Number(BigInt(chain.result)) : undefined;
    const entryPoints = Array.isArray(eps.result) ? (eps.result as Address[]) : undefined;
    const supportedMethods: Record<string, boolean> = {};
    for (const m of BUNDLER_METHODS) {
      try {
        const r = await rpc(f, url, m, [], timeoutMs);
        supportedMethods[m] = !isMethodNotFound(r.error);
      } catch {
        supportedMethods[m] = false;
      }
    }
    const ep07 = getContract(pepuMainnet.id, "entryPoint07");
    const want = ep07?.status === "deployed" ? ep07.address.toLowerCase() : undefined;
    const missing = REQUIRED_BUNDLER_METHODS.filter((m) => supportedMethods[m] !== true);
    const chainAndEntryPointOk =
      chainId === pepuMainnet.id &&
      (want === undefined || (entryPoints?.some((a) => a.toLowerCase() === want) ?? false));
    const ok = chainAndEntryPointOk && missing.length === 0;
    const out: BundlerProbeResult = {
      ok,
      latencyMs: Date.now() - started,
      supportedMethods,
      missingRequiredMethods: [...missing],
    };
    if (chainId !== undefined) out.chainId = chainId;
    if (entryPoints) out.entryPoints = entryPoints;
    if (!ok) {
      out.error = new PepuBundlerError(
        "BUNDLER_UNREACHABLE",
        chainId !== undefined && chainId !== pepuMainnet.id
          ? `The bundler serves chain ${chainId}, not ${pepuMainnet.id}.`
          : !chainAndEntryPointOk
            ? "The bundler does not list EntryPoint v0.7."
            : `The bundler does not support ${missing.join(", ")}.`,
        {
          hint: "Point PEPU_BUNDLER_URL at a bundler for chain 97741 that supports EntryPoint v0.7 and the ERC-4337 UserOperation methods.",
        },
      );
    }
    return out;
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: unreachable(url, e) };
  }
}

const STUB_PROBE_OP = {
  sender: "0x0000000000000000000000000000000000000001",
  nonce: "0x0",
  callData: "0x",
  callGasLimit: "0x0",
  verificationGasLimit: "0x0",
  preVerificationGas: "0x0",
  maxFeePerGas: "0x0",
  maxPriorityFeePerGas: "0x0",
  signature: "0x",
} as const;

/** Placeholder client token used when only the service base is known. It is not a credential. */
const PROBE_TOKEN = "pepu-probe";

/**
 * Probe the hosted (or a self-hosted) paymaster service. Accepts the service base
 * (`https://paymaster.pepeunchained.com`, the default) or a full ERC-7677 endpoint
 * (`https://host/v2/paymaster/<client token>`). `null` or `undefined` falls back to
 * the hosted base from `resolvePepuEndpoints()`.
 *
 * Checks, all read-only (no UserOperation is ever sent):
 * - `GET <origin>/health`
 * - `GET <origin>/v2/free-tier`
 * - the v2 ERC-7677 route `POST <origin>/v2/paymaster/<token>` with `pm_getPaymasterStubData`.
 *   With only a base URL, a placeholder token and empty params are used, and a
 *   structured JSON-RPC error (invalid params, unknown credential, denial) counts as
 *   responding (`erc7677: "needs-credential"`). Only network errors, non-JSON
 *   answers and 5xx are `"not-responding"`.
 *
 * `ok` means the ERC-7677 route responded and `/health` did not fail. Network trouble
 * never throws: it returns `ok: false` with a `PAYMASTER_UNREACHABLE` error. The
 * URL (which can embed a token) never appears in the returned error.
 *
 * @example
 * const r = await probePaymaster(); // hosted base
 * console.log(r.ok, r.erc7677, r.freeTier);
 */
export async function probePaymaster(url?: string | null, o: ProbeOptions = {}): Promise<PaymasterProbeResult> {
  if (url === null || url === undefined || url.trim() === "") {
    const hosted = resolvePepuEndpoints().paymasterBaseUrl;
    if (hosted === null) {
      throw new PepuConfigError("CONFIG_MISSING_ENV", "No paymaster URL is configured.", { hint: "Pass a URL or set PEPU_PAYMASTER_URL." });
    }
    url = hosted;
  }
  checkUrl(url, "Paymaster URL");
  const f: FetchLike = o.fetch ?? ((i, init) => fetch(i, init));
  const timeoutMs = o.timeoutMs ?? 8000;
  const started = Date.now();
  const parsed = new URL(url);
  const origin = parsed.origin;
  const out: PaymasterProbeResult = { ok: false, latencyMs: 0 };
  let reached = false;
  let lastError: unknown;

  try {
    const res = await timedFetch(f, `${origin}/health`, { method: "GET" }, timeoutMs);
    reached = true;
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    out.health = res.ok && body?.status === "ok";
  } catch (e) {
    lastError = e;
    out.health = false;
  }

  try {
    const res = await timedFetch(f, `${origin}/v2/free-tier`, { method: "GET" }, timeoutMs);
    reached = true;
    out.freeTierOk = res.ok;
    if (res.ok) out.freeTier = await res.json().catch(() => undefined);
  } catch (e) {
    lastError = e;
    out.freeTierOk = false;
  }

  // A full ERC-7677 URL (".../paymaster/<token>") is probed as given; a bare base uses the v2 route with a placeholder token.
  const hasToken = /\/(?:v2\/)?paymaster\/[^/]+\/?$/.test(parsed.pathname);
  const target = hasToken ? url : `${origin}/v2/paymaster/${PROBE_TOKEN}`;
  if (!hasToken) out.erc7677Route = `${origin}/v2/paymaster/<probe>`;
  let speaksRpc = false;
  try {
    const ep07 = getContract(pepuMainnet.id, "entryPoint07");
    const ep = ep07?.status === "deployed" ? ep07.address : "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const params: unknown[] = hasToken ? [STUB_PROBE_OP, ep, `0x${pepuMainnet.id.toString(16)}`, {}] : [];
    const res = await timedFetch(
      f,
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pm_getPaymasterStubData", params }),
      },
      timeoutMs,
    );
    reached = true;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const reply = body && typeof body === "object" ? (body as RpcReply) : undefined;
    // A JSON-RPC answer has a result, or an error OBJECT (a REST 404 body like {"error":"not_found"} is not one).
    const rpcError = reply?.error !== null && typeof reply?.error === "object";
    if (res.status >= 500) {
      out.erc7677StubOk = false;
      out.erc7677 = "not-responding";
    } else if (reply?.result !== undefined) {
      speaksRpc = true;
      out.erc7677StubOk = true;
      out.erc7677 = "stub-ok";
    } else if (rpcError) {
      // Alive and speaking ERC-7677 JSON-RPC; without a real client token a structured error is the expected answer.
      speaksRpc = true;
      out.erc7677 = "needs-credential";
    } else {
      out.erc7677StubOk = false;
      out.erc7677 = "not-responding";
    }
  } catch (e) {
    lastError = e;
    out.erc7677StubOk = false;
    out.erc7677 = "not-responding";
  }

  out.latencyMs = Date.now() - started;
  out.ok = speaksRpc && out.health !== false;
  if (!reached) out.error = paymasterUnreachable(url, lastError);
  else if (!out.ok) {
    const why = !speaksRpc
      ? `${hostOf(url)} is reachable but its ERC-7677 route (/v2/paymaster/<client token>) did not answer JSON-RPC.`
      : `${hostOf(url)} answered ERC-7677 but GET /health did not report ok.`;
    out.error = new PepuPaymasterError("PAYMASTER_API_ERROR", why, {
      hint: "Point PEPU_PAYMASTER_URL at a PEPU paymaster service: the base https://paymaster.pepeunchained.com, or its ERC-7677 endpoint https://paymaster.pepeunchained.com/v2/paymaster/<client token>. The service must expose /health and /v2/paymaster/<token>.",
    });
  }
  return out;
}

/**
 * The paymaster's EntryPoint v0.7 deposit in wei. A drop across a UserOperation
 * is the proof that it was sponsored. Defaults to PEPU's deployed paymaster.
 *
 * @example
 * const before = await getPaymasterDeposit(publicClient);
 */
export async function getPaymasterDeposit(client: PublicClient, paymaster?: Address): Promise<bigint> {
  const pm = getContract(pepuMainnet.id, "paymaster");
  const ep = getContract(pepuMainnet.id, "entryPoint07");
  const account = paymaster ?? (pm?.status === "deployed" ? pm.address : undefined);
  if (!account || ep?.status !== "deployed") {
    throw new PepuConfigError("CONFIG_MISSING_ENV", "No paymaster address is known; pass one explicitly.", {
      hint: "Pass the paymaster address as the second argument.",
    });
  }
  return client.readContract({
    address: ep.address,
    abi: entryPointV07Abi,
    functionName: "balanceOf",
    args: [account],
  });
}
