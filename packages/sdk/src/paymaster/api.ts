import { createSiweMessage } from "viem/siwe";
import { isAddress, toHex } from "viem";
import type { Address, Hex } from "viem";

import { pepuMainnet } from "../chains.js";
import { PEPU_HOSTED, resolvePepuEndpoints } from "../endpoints.js";
import { PepuConfigError, PepuPaymasterError } from "../errors.js";
import type { PepuErrorCode } from "../errors.js";
import type { ProjectClaimAttestation } from "./onchain.js";
import { mapPaymasterReason, paymasterReasonToError } from "./reasons.js";

/**
 * REST client for the PEPU paymaster policy service: v1 (`/sponsor`, ERC-7677 at `/paymaster/<token>`) and
 * v2 (`/v2/*`, tiered, on-chain projects). Isomorphic (plain `fetch`), so it is safe in a browser EXCEPT for
 * the claim attestation call that carries a Privy app secret, which lives in `@pepu-chain/sdk/paymaster/server`.
 *
 * Contract: services/paymaster/policy-service/openapi.yaml and SPONSORSHIP-SPEC.md. Credentials: a server key
 * (`ppk_...`, secret, any wallet) and a client token (`ppt_...`, publishable, bound to allowed origins).
 */

// ---------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------

/** A quantity as the service accepts it: `0x` hex or bigint (converted for you). */
export type Quantity = Hex | bigint;

/** The UserOperation fields `POST /sponsor` and `POST /v2/sponsor` read (EntryPoint v0.7, unpacked). */
export interface SponsorUserOp {
  sender: Address;
  nonce: Quantity;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: Quantity;
  verificationGasLimit: Quantity;
  preVerificationGas: Quantity;
  maxFeePerGas: Quantity;
  maxPriorityFeePerGas: Quantity;
}

export interface SponsorApproval {
  status: "approved";
  chainId: number;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  validUntil: number;
  validAfter: number;
  /** EntryPoint's canonical userOpHash. */
  userOpHash: Hex;
  /** v2 only. */
  sponsor?: { kind: "project" | "free"; sponsorId: Hex; projectKey: string };
  /** v2 only: worst-case cost, decimal wei. */
  maxCostWei?: string;
}

export interface SponsorDenial {
  status: "denied";
  /** Machine-readable reason, see {@link PAYMASTER_DENIAL_REASONS}. */
  reason: string;
  message: string;
  /** v2: per-tier reasons when both tiers were tried. */
  detail?: { project?: string; free?: string };
}

export type SponsorResult = SponsorApproval | SponsorDenial;

/** Credentials for a sponsor call. */
export interface SponsorAuth {
  /** The project's server key (`ppk_`) or client token (`ppt_`). Sent as `X-Api-Key`. */
  apiKey: string;
  /** The user's Privy access token. REQUIRED by v1 and by the v2 free tier. Sent as `Authorization: Bearer`. */
  privyAccessToken?: string;
  /** Origin header, for server-side calls with a client token (browsers set it themselves). */
  origin?: string;
}

export interface V2LoginResult {
  token: string;
  address: Address;
  /** ISO timestamp. */
  expiresAt: string;
}

export type V2ConfigResponse = Record<string, unknown>;
export type V2FreeTierInfo = Record<string, unknown>;

export interface V2ContractInfo {
  address: Address;
  chainId: number;
  entryPoint: Address;
  abi: readonly unknown[];
}

/** `POST /v2/projects/prepare` response: a transaction for the owner's wallet to send. */
export interface PreparedTx {
  chainId: number;
  to: Address;
  data: Hex;
  /** Decimal wei string. */
  value: string;
  function: string;
  description: string;
}

type Wei = string;
type Bytes32 = Hex;

/** Body of `POST /v2/projects/prepare`. */
export type PrepareRequest =
  | { action: "claimProject" | "reclaimProject"; attestation: SerializedAttestation }
  | { action: "depositFor"; projectId: Bytes32; amountWei: Wei }
  | { action: "executeReclaim" | "cancelReclaim" | "acceptProjectOwnership"; projectId: Bytes32 }
  | { action: "setTargets"; projectId: Bytes32; targets: Address[]; allowed: boolean }
  | { action: "setDailyLimit" | "setSenderDailyLimit"; projectId: Bytes32; limitWei: Wei }
  | { action: "setPaused"; projectId: Bytes32; paused: boolean }
  | { action: "proposeProjectOwner"; projectId: Bytes32; newOwner: Address };

/** Attestation in the service's wire format (decimal strings). */
export interface SerializedAttestation {
  appId: string;
  newOwner: Address;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface RegisterProjectRequest {
  /** Give `projectId` or `appId` (the id is keccak256(appId)). */
  projectId?: Bytes32;
  appId?: string;
  perUserDailyCapWei?: Wei;
  /** Opt in: refuse wallets without a verified Privy token. Default false (any wallet). */
  requireIdentity?: boolean;
  /** Plain origins (scheme://host[:port], http only for localhost). Max 20. None means server-key only. */
  allowedOrigins?: string[];
}

export interface RegisterProjectResponse {
  /** Publishable client token (`ppt_...`), shown once. */
  token: string;
  /** ERC-7677 URL embedding the client token. */
  paymasterUrl: string;
  /** SECRET server key (`ppk_...`), shown once. Backend only. */
  serverKey?: string;
}

export interface ProjectSettings {
  perUserDailyCapWei?: Wei;
  requireIdentity?: boolean;
  allowedOrigins?: string[];
}

export interface ProjectDetail {
  projectId: Bytes32;
  appId: string | null;
  indexed: boolean;
  owner: Address;
  onchain: {
    balance: Wei;
    spendable: Wei;
    outstandingApprovals: Wei;
    paused: boolean;
    dailyLimit: Wei;
    senderDailyLimit: Wei;
    spentToday: Wei;
    dailyRemaining: Wei;
  };
  adminChangeDelaySeconds: number | null;
  allowlist: Address[] | null;
  offchain: Record<string, unknown> | null;
  usage24h: { ops: number; projectFundedWei: Wei; freeTierFundedWei: Wei } | null;
  contract: { address: Address; chainId: number };
}

/** Options for the low-level request escape hatch. */
export interface V2RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send the stored SIWE session as a bearer token. Default false. */
  session?: boolean;
  /**
   * Never put the service's message into thrown errors (only the HTTP status and error code). Set for calls whose
   * request body holds a secret.
   */
  quietErrors?: boolean;
}

export interface CreatePaymasterApiOptions {
  /**
   * Policy-service base URL (no trailing path). Defaults to `PEPU_PAYMASTER_URL` /
   * `NEXT_PUBLIC_PEPU_PAYMASTER_URL`, then the hosted default once it exists.
   */
  baseUrl?: string;
  /** Fetch implementation (tests, custom agents). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Environment for URL resolution. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Start with an existing SIWE session token. */
  sessionToken?: string;
}

export interface PaymasterApiV1 {
  /** `POST /sponsor`. Needs the user's Privy access token and the app API key. */
  sponsor(userOp: SponsorUserOp, auth: SponsorAuth): Promise<SponsorResult>;
  /** `GET /health`. */
  health(): Promise<{ status: string }>;
  /** ERC-7677 URL for this service (`<base>/paymaster/<token>`). */
  erc7677Url(appToken: string): string;
}

export interface PaymasterApiV2 {
  /** `POST /v2/sponsor`. Denials are returned (not thrown); use {@link assertApproved}. */
  sponsor(userOp: SponsorUserOp, auth: SponsorAuth): Promise<SponsorResult>;
  /** ERC-7677 URL for this service (`<base>/v2/paymaster/<token>`). */
  erc7677Url(appToken: string): string;
  config(): Promise<V2ConfigResponse>;
  contract(): Promise<V2ContractInfo>;
  freeTier(): Promise<V2FreeTierInfo>;
  auth: {
    nonce(): Promise<{ nonce: string; expiresAt: string }>;
    /** Stores the returned session token on this client. */
    login(message: string, signature: Hex): Promise<V2LoginResult>;
    logout(): Promise<void>;
  };
  /** `GET /v2/me`: the session address. */
  me(): Promise<{ address: Address }>;
  /**
   * Full SIWE sign-in: nonce, EIP-4361 message, your signature, login. The session lasts 1 hour and is stored
   * on this client.
   */
  loginWithWallet(sign: (message: string) => Promise<Hex>, o: LoginWithWalletOptions): Promise<V2LoginResult>;
  /** Current session token, if signed in. */
  getSessionToken(): string | null;
  setSessionToken(token: string | null): void;
  projects: {
    /** `POST /v2/projects/prepare`: calldata for the owner's wallet. Sends nothing. */
    prepare(request: PrepareRequest): Promise<PreparedTx>;
    /** `POST /v2/projects`: index a claimed project and get its credentials. */
    register(request: RegisterProjectRequest): Promise<RegisterProjectResponse>;
    list(): Promise<{ projects: unknown[]; onchainUnindexed?: unknown[] }>;
    get(projectId: Hex): Promise<ProjectDetail>;
    rotateClientToken(projectId: Hex): Promise<{ token: string; paymasterUrl: string; note?: string }>;
    rotateServerKey(projectId: Hex): Promise<{ serverKey: string; note?: string }>;
    updateSettings(projectId: Hex, settings: ProjectSettings): Promise<Record<string, unknown>>;
    usage(projectId: Hex, q?: { limit?: number; before?: number }): Promise<Record<string, unknown>>;
    events(projectId: Hex, q?: { fromBlock?: number; limit?: number }): Promise<{ projectId: Hex; events: unknown[] }>;
    allowlist(projectId: Hex): Promise<{ projectId: Hex; source: string; targets: Address[] }>;
  };
  /**
   * Low-level call to any `/v2` path, with the same error mapping. Used by `@pepu-chain/sdk/paymaster/server`
   * for `POST /v2/projects/verify`. Prefer the typed methods.
   */
  request<T>(method: "GET" | "POST" | "PATCH", path: string, options?: V2RequestOptions): Promise<T>;
}

export interface PaymasterApi {
  /** Resolved base URL, no trailing slash. */
  readonly baseUrl: string;
  v1: PaymasterApiV1;
  v2: PaymasterApiV2;
}

export interface LoginWithWalletOptions {
  /** The signing wallet's address. */
  address: Address;
  /** SIWE domain; must be one of the service's `SIWE_DOMAINS` (for example `app.example.com`). */
  domain: string;
  /** SIWE `uri`. Default `https://<domain>`. */
  uri?: string;
  /** Chain id in the message. Default 97741. */
  chainId?: number;
  statement?: string;
  /** Message lifetime in seconds (service maximum is 600 by default). Default 300. */
  lifetimeSeconds?: number;
  now?: () => number;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

const CLIENT_TOKEN_PREFIX = "ppt_";
const SERVER_KEY_PREFIX = "ppk_";

/** `"client"` for `ppt_` tokens, `"server"` for `ppk_` keys, otherwise `null`. Never inspects beyond the prefix. */
export function credentialKind(credential: string): "client" | "server" | null {
  if (credential.startsWith(CLIENT_TOKEN_PREFIX)) return "client";
  if (credential.startsWith(SERVER_KEY_PREFIX)) return "server";
  return null;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface BuildErc7677UrlOptions {
  /** Policy-service base URL. */
  baseUrl: string;
  /** Client token (`ppt_`, browser-safe) or server key (`ppk_`, secret). */
  token: string;
  /** Default 2. v1 serves `/paymaster/<token>`, v2 serves `/v2/paymaster/<token>`. */
  version?: 1 | 2;
}

/**
 * Build the ERC-7677 paymaster URL for a project credential (paste it into a Privy "Paymaster URL" or pass it
 * to a viem paymaster client). Refuses a server key (`ppk_`) in a browser, because the URL embeds it.
 *
 * @example
 * ```ts
 * const url = buildErc7677Url({ baseUrl: "https://paymaster.example.com", token: "ppt_abc" });
 * // https://paymaster.example.com/v2/paymaster/ppt_abc
 * ```
 */
export function buildErc7677Url(options: BuildErc7677UrlOptions): string {
  const token = options.token.trim();
  if (token === "") {
    throw new PepuConfigError("CONFIG_MISSING_ENV", "buildErc7677Url needs a project client token or server key.");
  }
  if (credentialKind(token) === "server" && (globalThis as { window?: unknown }).window !== undefined) {
    throw new PepuConfigError(
      "CONFIG_SERVER_ONLY",
      "Refusing to build an ERC-7677 URL from a server key (ppk_) in a browser: the URL embeds the secret. Use the client token (ppt_).",
    );
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new PepuConfigError("CONFIG_BAD_URL", "buildErc7677Url: baseUrl is not a valid URL.");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new PepuConfigError("CONFIG_BAD_URL", "buildErc7677Url: baseUrl must be an http(s) URL.");
  }
  const prefix = (options.version ?? 2) === 2 ? "/v2/paymaster/" : "/paymaster/";
  return `${trimBase(options.baseUrl)}${prefix}${encodeURIComponent(token)}`;
}

/**
 * The hosted ERC-7677 URL for a project credential: `<hosted base>/v2/paymaster/<token>`.
 * Pass the project's client token (`ppt_`, browser-safe); a server key is refused in a browser.
 *
 * @example
 * const url = hostedErc7677Url("ppt_abc");
 * // https://paymaster.pepeunchained.com/v2/paymaster/ppt_abc
 */
export function hostedErc7677Url(token: string): string {
  if (PEPU_HOSTED.paymasterBaseUrl === null) {
    throw new PepuConfigError("CONFIG_MISSING_ENV", "No hosted paymaster base URL is set.");
  }
  return buildErc7677Url({ baseUrl: PEPU_HOSTED.paymasterBaseUrl, token });
}

function toQuantity(v: Quantity): Hex {
  return typeof v === "bigint" ? toHex(v) : v;
}

function serializeUserOp(op: SponsorUserOp): Record<string, string> {
  const out: Record<string, string> = {
    sender: op.sender,
    nonce: toQuantity(op.nonce),
    callData: op.callData,
    callGasLimit: toQuantity(op.callGasLimit),
    verificationGasLimit: toQuantity(op.verificationGasLimit),
    preVerificationGas: toQuantity(op.preVerificationGas),
    maxFeePerGas: toQuantity(op.maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(op.maxPriorityFeePerGas),
  };
  if (op.factory !== undefined) out["factory"] = op.factory;
  if (op.factoryData !== undefined) out["factoryData"] = op.factoryData;
  return out;
}

/**
 * Turn a sponsor result into the approval, or throw the mapped {@link PepuPaymasterError}
 * (`project_not_claimed_onchain` becomes `PAYMASTER_PROJECT_NOT_CLAIMED`, and so on).
 *
 * @example
 * ```ts
 * const approval = assertApproved(await api.v2.sponsor(userOp, { apiKey }));
 * ```
 */
export function assertApproved(result: SponsorResult): SponsorApproval {
  if (result.status === "approved") return result;
  throw paymasterReasonToError(result.reason, result.message, result.detail ? { detail: result.detail } : undefined);
}

/** Pull `retryAfterSeconds` out of a Retry-After header. */
function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function missingBaseUrl(): PepuConfigError {
  return new PepuConfigError(
    "CONFIG_MISSING_ENV",
    "No paymaster URL configured. Set PEPU_PAYMASTER_URL (or NEXT_PUBLIC_PEPU_PAYMASTER_URL), or pass baseUrl to createPaymasterApi.",
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------

/**
 * Create the paymaster REST client.
 *
 * @example
 * ```ts
 * const api = createPaymasterApi({ baseUrl: "https://paymaster.example.com" });
 * const free = await api.v2.freeTier();
 * const result = await api.v2.sponsor(userOp, { apiKey: process.env.PEPU_SERVER_KEY!, privyAccessToken });
 * if (result.status === "denied") console.log(result.reason);
 * ```
 */
export function createPaymasterApi(options: CreatePaymasterApiOptions = {}): PaymasterApi {
  const resolved = options.baseUrl ?? resolvePepuEndpoints(options.env ? { env: options.env } : {}).paymasterBaseUrl;
  if (resolved === null || resolved === undefined || resolved.trim() === "") throw missingBaseUrl();
  try {
    const u = new URL(resolved);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw new PepuConfigError("CONFIG_BAD_URL", "The paymaster baseUrl is not a valid http(s) URL.");
  }
  const baseUrl = trimBase(resolved.trim());
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 15_000;
  let sessionToken: string | null = options.sessionToken ?? null;

  /** Fetch with timeout; network failures become PAYMASTER_UNREACHABLE without echoing request details. */
  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new PepuPaymasterError(
        "PAYMASTER_UNREACHABLE",
        timedOut ? "The paymaster did not answer in time." : "Could not reach the paymaster service.",
        { details: { path: new URL(url).pathname.replace(/\/(ppt_|ppk_)[^/]*/, "/<credential>") } },
      );
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => "");
    if (text === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  function apiError(res: Response, body: unknown, quiet: boolean): PepuPaymasterError {
    const rec = isRecord(body) ? body : {};
    const errorCode = typeof rec["error"] === "string" ? rec["error"] : undefined;
    const reason = typeof rec["reason"] === "string" ? rec["reason"] : undefined;
    const serverMessage = typeof rec["message"] === "string" && !quiet ? rec["message"] : undefined;
    const details = { status: res.status, error: errorCode, reason, retryAfterSeconds: retryAfter(res) };
    const tagged = reason ?? errorCode;
    let code: PepuErrorCode;
    if (res.status === 401 && errorCode === "unauthenticated") code = "PAYMASTER_SESSION_REQUIRED";
    else if (tagged !== undefined && mapPaymasterReason(tagged) !== "PAYMASTER_DENIED") code = mapPaymasterReason(tagged);
    else if (res.status === 401 && errorCode !== "login_failed") code = "PAYMASTER_SESSION_REQUIRED";
    else if (res.status === 401) code = "PAYMASTER_DENIED";
    else if (res.status === 429) code = "PAYMASTER_RATE_LIMITED";
    else if (res.status === 403) code = "PAYMASTER_DENIED";
    else code = "PAYMASTER_API_ERROR";
    const label = `Paymaster API ${res.status}${errorCode ? ` ${errorCode}` : ""}${reason && reason !== errorCode ? ` (${reason})` : ""}`;
    return new PepuPaymasterError(code, serverMessage ? `${label}: ${serverMessage}` : `${label}.`, {
      details,
      ...(res.status === 429 || res.status === 503 ? { retryable: true } : {}),
    });
  }

  async function request<T>(method: "GET" | "POST" | "PATCH", path: string, o: V2RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (o.body !== undefined) headers["content-type"] = "application/json";
    if (o.session) {
      if (!sessionToken) {
        throw new PepuPaymasterError("PAYMASTER_SESSION_REQUIRED", "This call needs a SIWE session. Call loginWithWallet() first.");
      }
      headers["authorization"] = `Bearer ${sessionToken}`;
    }
    let url = `${baseUrl}${path}`;
    if (o.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(o.query)) if (v !== undefined) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const res = await send(url, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const body = await readJson(res);
    if (!res.ok) throw apiError(res, body, o.quietErrors === true);
    return body as T;
  }

  async function sponsor(path: string, userOp: SponsorUserOp, auth: SponsorAuth): Promise<SponsorResult> {
    if (!auth.apiKey) {
      throw new PepuConfigError("CONFIG_MISSING_ENV", "sponsor needs auth.apiKey (the project server key or client token).");
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": auth.apiKey,
    };
    if (auth.privyAccessToken) headers["authorization"] = `Bearer ${auth.privyAccessToken}`;
    if (auth.origin) headers["origin"] = auth.origin;
    const res = await send(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ userOp: serializeUserOp(userOp) }),
    });
    const body = await readJson(res);
    if (isRecord(body) && (body["status"] === "approved" || body["status"] === "denied")) {
      return body as unknown as SponsorResult;
    }
    throw apiError(res, body, false);
  }

  const projectPath = (id: Hex, sub = ""): string => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
      throw new PepuPaymasterError("PAYMASTER_DENIED", "projectId must be a 0x-prefixed 32-byte hex string.");
    }
    return `/v2/projects/${id}${sub}`;
  };

  const v1: PaymasterApiV1 = {
    sponsor: async (userOp, auth) => {
      if (!auth.privyAccessToken) {
        throw new PepuPaymasterError(
          "PAYMASTER_IDENTITY_REQUIRED",
          "The v1 /sponsor endpoint requires the user's Privy access token (auth.privyAccessToken).",
        );
      }
      return sponsor("/sponsor", userOp, auth);
    },
    health: async () => {
      const res = await send(`${baseUrl}/health`, { method: "GET" });
      const body = await readJson(res);
      if (!res.ok) throw apiError(res, body, false);
      return (isRecord(body) ? body : { status: "ok" }) as { status: string };
    },
    erc7677Url: (token) => buildErc7677Url({ baseUrl, token, version: 1 }),
  };

  const v2: PaymasterApiV2 = {
    sponsor: (userOp, auth) => sponsor("/v2/sponsor", userOp, auth),
    erc7677Url: (token) => buildErc7677Url({ baseUrl, token, version: 2 }),
    config: () => request("GET", "/v2/config"),
    contract: () => request("GET", "/v2/contract"),
    freeTier: () => request("GET", "/v2/free-tier"),
    auth: {
      nonce: () => request("GET", "/v2/auth/nonce"),
      login: async (message, signature) => {
        const r = await request<V2LoginResult>("POST", "/v2/auth/login", { body: { message, signature } });
        sessionToken = r.token;
        return r;
      },
      logout: async () => {
        await request("POST", "/v2/auth/logout", { session: true });
        sessionToken = null;
      },
    },
    me: () => request("GET", "/v2/me", { session: true }),
    loginWithWallet: async (sign, o) => {
      if (!isAddress(o.address, { strict: false })) {
        throw new PepuPaymasterError("PAYMASTER_DENIED", "loginWithWallet: address is not a valid address.");
      }
      const { nonce } = await v2.auth.nonce();
      const now = (o.now ?? Date.now)();
      const message = createSiweMessage({
        address: o.address,
        chainId: o.chainId ?? pepuMainnet.id,
        domain: o.domain,
        nonce,
        uri: o.uri ?? `https://${o.domain}`,
        version: "1",
        statement: o.statement ?? "Sign in to manage your PEPU gas sponsorship project. This does not move any funds.",
        issuedAt: new Date(now),
        expirationTime: new Date(now + (o.lifetimeSeconds ?? 300) * 1000),
      });
      const signature = await sign(message);
      return v2.auth.login(message, signature);
    },
    getSessionToken: () => sessionToken,
    setSessionToken: (t) => {
      sessionToken = t;
    },
    projects: {
      prepare: (body) => request("POST", "/v2/projects/prepare", { session: true, body }),
      register: (body) => request("POST", "/v2/projects", { session: true, body }),
      list: () => request("GET", "/v2/projects", { session: true }),
      get: async (id) => request("GET", projectPath(id), { session: true }),
      rotateClientToken: async (id) => request("POST", projectPath(id, "/token/rotate"), { session: true }),
      rotateServerKey: async (id) => request("POST", projectPath(id, "/server-key/rotate"), { session: true }),
      updateSettings: async (id, body) => request("PATCH", projectPath(id, "/settings"), { session: true, body }),
      usage: async (id, q = {}) => request("GET", projectPath(id, "/usage"), { session: true, query: { ...q } }),
      events: async (id, q = {}) => request("GET", projectPath(id, "/events"), { session: true, query: { ...q } }),
      allowlist: async (id) => request("GET", projectPath(id, "/allowlist"), { session: true }),
    },
    request,
  };

  return { baseUrl, v1, v2 };
}

/** Serialize a typed attestation into the wire format for `projects.prepare`. */
export function serializeAttestation(a: ProjectClaimAttestation): SerializedAttestation {
  return {
    appId: a.appId,
    newOwner: a.newOwner,
    nonce: a.nonce.toString(),
    deadline: a.deadline.toString(),
    signature: a.signature,
  };
}
