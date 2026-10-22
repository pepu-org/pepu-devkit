import { pepuMainnet } from "./chains.js";
import { PepuConfigError } from "./errors.js";

/**
 * Hosted-URL swap point. The hosted PEPU bundler and paymaster service run at
 * bundler.pepeunchained.com and paymaster.pepeunchained.com. Set here, the SDK,
 * MCP server and docs flip together. Apps can still point at their own
 * services with the env vars below.
 *
 * - `bundlerUrl` is a complete JSON-RPC URL.
 * - `paymasterBaseUrl` is the paymaster SERVICE base (REST API, `/health`,
 *   `/v2/free-tier`). It is NOT an ERC-7677 URL: v2 serves ERC-7677 at
 *   `<base>/v2/paymaster/<client token>`, so build that with
 *   `hostedErc7677Url` (or `buildErc7677Url`).
 * - `paymasterUrl` is the default complete ERC-7677 URL. It stays `null`
 *   because every ERC-7677 URL embeds a per-project token; set
 *   `PEPU_PAYMASTER_URL` (or pass a token) to supply one.
 */
export const PEPU_HOSTED: {
  readonly bundlerUrl: string | null;
  readonly paymasterBaseUrl: string | null;
  readonly paymasterUrl: string | null;
} = {
  bundlerUrl: "https://bundler.pepeunchained.com",
  paymasterBaseUrl: "https://paymaster.pepeunchained.com",
  paymasterUrl: null,
};

/** Server-side (and script) environment variable names. */
export const PEPU_ENV = {
  bundlerUrl: "PEPU_BUNDLER_URL",
  paymasterUrl: "PEPU_PAYMASTER_URL",
  rpcUrl: "PEPU_RPC_URL",
} as const;

/** Browser-exposed variants (Next.js `NEXT_PUBLIC_` convention). */
export const PEPU_PUBLIC_ENV = {
  bundlerUrl: "NEXT_PUBLIC_PEPU_BUNDLER_URL",
  paymasterUrl: "NEXT_PUBLIC_PEPU_PAYMASTER_URL",
  rpcUrl: "NEXT_PUBLIC_PEPU_RPC_URL",
} as const;

export interface ResolvePepuEndpointsOptions {
  bundlerUrl?: string;
  paymasterUrl?: string;
  rpcUrl?: string;
  /**
   * Environment to read. Defaults to `process.env` when it exists. In browser
   * bundles frameworks only inline literal `process.env.NEXT_PUBLIC_X`
   * accesses, so pass them explicitly there.
   */
  env?: Record<string, string | undefined>;
}

export interface PepuEndpoints {
  rpcUrl: string;
  bundlerUrl: string | null;
  /** Complete ERC-7677 URL from the option or env, else `null` (it needs a project token). */
  paymasterUrl: string | null;
  /**
   * Paymaster service base for the REST API, probes and ERC-7677 URL building.
   * From the option or env (a full ERC-7677 URL is reduced to its base), else the hosted base.
   */
  paymasterBaseUrl: string | null;
  /** Highest-precedence origin used for any of the three values. */
  source: "explicit" | "env" | "hosted-default";
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function validate(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PepuConfigError("CONFIG_BAD_URL", `${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PepuConfigError("CONFIG_BAD_URL", `${label} must be an http(s) URL.`);
  }
  return url;
}

/** Strip a trailing `/v2/paymaster/<token>` or `/paymaster/<token>` and slashes, leaving the service base. */
export function paymasterBaseOf(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/(?:v2\/)?paymaster\/[^/]+$/, "");
}

function defaultEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/**
 * Resolve endpoints. Precedence per value: explicit option, then env
 * (server variable, then `NEXT_PUBLIC_` variable), then {@link PEPU_HOSTED}.
 * Throws PepuConfigError (CONFIG_BAD_URL) naming the variable, never its value.
 */
export function resolvePepuEndpoints(options: ResolvePepuEndpointsOptions = {}): PepuEndpoints {
  const env = options.env ?? defaultEnv();
  const rank = { explicit: 2, env: 1, "hosted-default": 0 } as const;
  let source: PepuEndpoints["source"] = "hosted-default";
  const bump = (s: PepuEndpoints["source"]): void => {
    if (rank[s] > rank[source]) source = s;
  };

  const pick = (key: keyof typeof PEPU_ENV, explicit: string | undefined, hosted: string | null): string | null => {
    const e = clean(explicit);
    if (e !== undefined) {
      bump("explicit");
      return validate(e, `Option ${key}`);
    }
    for (const name of [PEPU_ENV[key], PEPU_PUBLIC_ENV[key]]) {
      const v = clean(env[name]);
      if (v !== undefined) {
        bump("env");
        return validate(v, name);
      }
    }
    return hosted;
  };

  const rpcDefault = pepuMainnet.rpcUrls.default.http[0];
  const paymasterUrl = pick("paymasterUrl", options.paymasterUrl, PEPU_HOSTED.paymasterUrl);
  return {
    rpcUrl: pick("rpcUrl", options.rpcUrl, rpcDefault) ?? rpcDefault,
    bundlerUrl: pick("bundlerUrl", options.bundlerUrl, PEPU_HOSTED.bundlerUrl),
    paymasterUrl,
    paymasterBaseUrl: paymasterUrl !== null ? paymasterBaseOf(paymasterUrl) : PEPU_HOSTED.paymasterBaseUrl,
    source,
  };
}

/** True once the hosted bundler and the hosted paymaster service have URLs in {@link PEPU_HOSTED}. */
export function isHostedSponsorshipLive(): boolean {
  return PEPU_HOSTED.bundlerUrl !== null && PEPU_HOSTED.paymasterBaseUrl !== null;
}

/** The public free-tier state route on the hosted paymaster (`GET`, no credentials). */
export function hostedFreeTierUrl(): string {
  if (PEPU_HOSTED.paymasterBaseUrl === null) {
    throw new PepuConfigError("CONFIG_MISSING_ENV", "No hosted paymaster base URL is set.");
  }
  return `${PEPU_HOSTED.paymasterBaseUrl.replace(/\/+$/, "")}/v2/free-tier`;
}
