import { decodeErrorResult, isHex } from "viem";
import type { Abi, Hex } from "viem";

/**
 * The SDK error model. Everything the SDK throws is a {@link PepuError}
 * subclass carrying a stable `code`, a one-sentence `hint` and a `docsUrl`.
 * Messages never contain secrets: they name environment variables, never
 * their values.
 */

export const PEPU_ERRORS_DOCS_URL = "https://docs.pepeunchained.com/reference/errors";

export type PepuErrorCode =
  | "CONFIG_MISSING_ENV"
  | "CONFIG_BAD_URL"
  | "CONFIG_SERVER_ONLY"
  | "CONFIG_PRIVY_DASHBOARD"
  | "CONFIG_PRIVY_CREATE_ON_LOGIN"
  | "CONFIG_ORIGIN_MISMATCH"
  | "AUTH_INVALID_TOKEN"
  | "WALLET_NOT_PROVISIONED"
  | "WALLET_COINBASE_UNSUPPORTED_CHAIN"
  | "WALLET_INJECTED_ACTIVE"
  | "POLICY_UNSCOPED"
  | "POLICY_NAME_TOO_LONG"
  | "SESSION_EXPIRED"
  | "SESSION_NONE"
  | "SESSION_APPROVAL_MISMATCH"
  | "PRIVY_CHAIN_REJECTED_97741"
  | "PRIVY_KEY_QUORUM_MISMATCH"
  | "BUNDLER_UNREACHABLE"
  | "BUNDLER_AA_FAILED"
  | "PAYMASTER_DENIED"
  | "PAYMASTER_NO_BALANCE"
  | "PAYMASTER_CAP"
  | "PAYMASTER_ORIGIN_NOT_ALLOWED"
  | "PAYMASTER_DESTINATION_NOT_ALLOWED"
  | "PAYMASTER_PROJECT_NOT_CLAIMED"
  | "PAYMASTER_PROJECT_OWNER_CHANGED"
  | "PAYMASTER_PROJECT_PAUSED"
  | "PAYMASTER_IDENTITY_REQUIRED"
  | "PAYMASTER_FREE_TIER_UNAVAILABLE"
  | "PAYMASTER_RATE_LIMITED"
  | "PAYMASTER_SESSION_REQUIRED"
  | "PAYMASTER_API_ERROR"
  | "PAYMASTER_UNREACHABLE"
  | "TX_REVERTED"
  | "TX_NONCE_RACE"
  | "TX_GAS_UNDERSHOOT"
  | "MULTICALL3_CANONICAL_ADDRESS"
  | "UNKNOWN";

export interface ErrorCatalogEntry {
  readonly code: PepuErrorCode;
  readonly title: string;
  /** What went wrong, in one or two sentences. */
  readonly cause: string;
  /** How to fix it. */
  readonly fix: string;
  /** Suggested HTTP status for route factories. */
  readonly status: number;
  readonly retryable: boolean;
  /** Tested, in order, against the flattened error text. Empty for code-only entries. */
  readonly matchers: readonly RegExp[];
}

/**
 * Single source for the SDK `explainError`, the MCP `pepu_explain_error` tool
 * and the generated docs error page. ORDER MATTERS: the first entry whose
 * matcher hits wins, so specific entries come before general ones.
 */
export const PEPU_ERROR_CATALOG: readonly ErrorCatalogEntry[] = [
  {
    code: "PRIVY_KEY_QUORUM_MISMATCH",
    title: "Privy authorization key does not match the wallet owner",
    cause:
      "Privy returned 401 'No valid authorization keys or user signing keys available': the server's PRIVY_AUTHORIZATION_KEY is not a signer on the wallet, or the key quorum id differs from the one the user granted.",
    fix: "Make sure PRIVY_AUTHORIZATION_KEY is the private half of the key whose quorum id is NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID, and that the user granted that quorum as a signer.",
    status: 500,
    retryable: false,
    matchers: [/No valid authorization keys or user signing keys available/i],
  },
  {
    code: "POLICY_NAME_TOO_LONG",
    title: "Privy policy or rule name is too long",
    cause: "Privy rejects policy and rule names of 50 or more characters (the real limit is 49).",
    fix: "Shorten the policy or rule name to 49 characters or fewer.",
    status: 400,
    retryable: false,
    matchers: [/must be fewer than 50 characters/i, /name[^.\n]{0,40}\b(50|49) characters/i],
  },
  {
    code: "WALLET_COINBASE_UNSUPPORTED_CHAIN",
    title: "Coinbase Smart Wallet does not support PEPU",
    cause:
      "Coinbase Smart Wallet is a smart-contract wallet on chains it knows; PEPU (97741) is not one of them, and it floods the console with unsupported-chain errors.",
    fix: "Pin Coinbase to eoaOnly via createPepuPrivyConfig() from @pepu-chain/sdk/privy.",
    status: 400,
    retryable: false,
    matchers: [
      /coinbase[\s\S]{0,120}(unsupported|not supported)[\s\S]{0,60}chain/i,
      /(unsupported|not supported) chain[\s\S]{0,120}coinbase/i,
    ],
  },
  {
    code: "PRIVY_CHAIN_REJECTED_97741",
    title: "Privy rejects server-side eth_sendTransaction on PEPU",
    cause: "Privy's server-side send path does not know chain 97741 and rejects it. Signing works; sending does not.",
    fix: "Sign with eth_signTransaction on the server and broadcast the raw transaction yourself (signAndBroadcast from @pepu-chain/sdk/session).",
    status: 502,
    retryable: false,
    matchers: [
      /eip155:97741[\s\S]{0,160}(unsupported|not supported|invalid|unknown|not found)/i,
      /(unsupported|not supported|unknown|invalid) (chain|network|caip2)[\s\S]{0,80}97741/i,
    ],
  },
  {
    code: "PAYMASTER_ORIGIN_NOT_ALLOWED",
    title: "Paymaster refused the request origin",
    cause: "The request Origin is not on the project's allowlist.",
    fix: "Add the exact origin (scheme, host and port) to the project's allowed origins.",
    status: 403,
    retryable: false,
    matchers: [/origin_not_allowed/i],
  },
  {
    code: "PAYMASTER_DESTINATION_NOT_ALLOWED",
    title: "Paymaster refused the call destination",
    cause: "The UserOperation targets a contract that is not on the project's target allowlist.",
    fix: "Add the contract to the project's targets, or sponsor only calls to allowed targets.",
    status: 403,
    retryable: false,
    matchers: [/(destination|target)_not_allowed/i],
  },
  {
    code: "PAYMASTER_PROJECT_NOT_CLAIMED",
    title: "Sponsorship project is not claimed on-chain",
    cause:
      "Deposits can sit in an unclaimed project, but nothing is sponsored until its owner has claimed it on-chain (the contract reports ProjectNotClaimed, the service project_not_claimed_onchain).",
    fix: "Prove the Privy app (requestClaimAttestation from @pepu-chain/sdk/paymaster/server), call claimProject, then configureProject (setTargets, setDailyLimit, setSenderDailyLimit).",
    status: 409,
    retryable: false,
    matchers: [/project_not_claimed_onchain/i, /ProjectNotClaimed/i],
  },
  {
    code: "PAYMASTER_PROJECT_OWNER_CHANGED",
    title: "Project owner changed since the credentials were issued",
    cause:
      "The on-chain owner of the project is no longer the address the off-chain credentials were issued to (an ownership transfer or re-claim completed).",
    fix: "As the new owner, sign in with SIWE, register the project again and rotate the client token and server key.",
    status: 403,
    retryable: false,
    matchers: [/project_owner_changed/i],
  },
  {
    code: "PAYMASTER_PROJECT_PAUSED",
    title: "Sponsorship project is paused",
    cause: "The project owner paused sponsorship on-chain.",
    fix: "The owner can resume it with setPaused(projectId, false).",
    status: 403,
    retryable: false,
    matchers: [/project_paused/i, /SponsorPaused/i],
  },
  {
    code: "PAYMASTER_IDENTITY_REQUIRED",
    title: "A verified Privy account is required",
    cause: "The free tier (and any project with requireIdentity on) only sponsors users with a verified Privy access token.",
    fix: "Send the user's Privy access token as Authorization: Bearer (or context.privyAccessToken for ERC-7677).",
    status: 401,
    retryable: false,
    matchers: [/(project|free_tier)_identity_required/i],
  },
  {
    code: "PAYMASTER_FREE_TIER_UNAVAILABLE",
    title: "Free tier cannot sponsor this operation",
    cause: "The free tier is disabled, its pool is empty, or the operation is larger than the per-op cap.",
    fix: "Deposit into your own project and use its credentials, or retry later.",
    status: 429,
    retryable: true,
    matchers: [/free_tier_disabled/i, /free_pool_(empty|op_too_large)/i],
  },
  {
    code: "PAYMASTER_RATE_LIMITED",
    title: "Paymaster API rate limit",
    cause: "Too many requests to the paymaster API from this IP or account.",
    fix: "Back off for the Retry-After interval (error.details.retryAfterSeconds when present).",
    status: 429,
    retryable: true,
    matchers: [/\brate_limited\b/i],
  },
  {
    code: "PAYMASTER_SESSION_REQUIRED",
    title: "Paymaster owner session missing or expired",
    cause: "Owner endpoints need a SIWE session token (1 h lifetime) for the project's current on-chain owner.",
    fix: "Call loginWithWallet() on the paymaster API client, then retry.",
    status: 401,
    retryable: false,
    matchers: [],
  },
  {
    code: "PAYMASTER_API_ERROR",
    title: "Paymaster API request failed",
    cause: "The paymaster API returned an error that has no more specific PEPU code.",
    fix: "Read error.details (HTTP status and the service's error code) and the OpenAPI spec for that route.",
    status: 502,
    retryable: false,
    matchers: [],
  },
  {
    code: "PAYMASTER_UNREACHABLE",
    title: "Paymaster service is unreachable",
    cause: "The request to the paymaster service failed before any response (network error, DNS failure or timeout).",
    fix: "Check PEPU_PAYMASTER_URL and your network. The hosted service is https://paymaster.pepeunchained.com; run checkSponsorship() or probePaymaster() for detail.",
    status: 502,
    retryable: true,
    matchers: [],
  },
  {
    code: "PAYMASTER_DENIED",
    title: "Paymaster denied the sponsorship",
    cause:
      "The paymaster rejected the credential or the sender (for example unknown_or_invalid_app_credential or sender_not_owned_by_token_user).",
    fix: "Check the app credential or token, and that the smart account belongs to the user whose access token you sent.",
    status: 403,
    retryable: false,
    matchers: [
      /unknown_or_invalid_app_credential/i,
      /sender_not_owned_by_token_user/i,
      /paymaster[\s\S]{0,40}(denied|rejected)/i,
    ],
  },
  {
    code: "PAYMASTER_NO_BALANCE",
    title: "Sponsorship project has no balance",
    cause: "The project's paymaster deposit cannot cover this operation.",
    fix: "Deposit more PEPU to the project, then retry.",
    status: 429,
    retryable: true,
    matchers: [/(project_)?(no|insufficient)_balance/i, /project_balance_exhausted/i, /InsufficientSponsorBalance/i, /insufficient (project )?(balance|deposit)[\s\S]{0,40}paymaster/i],
  },
  {
    code: "PAYMASTER_CAP",
    title: "Sponsorship cap reached",
    cause: "A daily, per-sender or per-operation sponsorship cap was hit.",
    fix: "Wait for the cap window to reset, or raise the project's daily and sender limits.",
    status: 429,
    retryable: true,
    matchers: [/(daily|sender|per_sender)[_ -]?(cap|limit)[_ ]?(exceeded|reached)/i, /cap_exceeded|limit_exceeded/i, /free_tier_[a-z_]*_(exceeded|reached)/i, /fee_above_onchain_cap/i],
  },
  {
    code: "BUNDLER_AA_FAILED",
    title: "EntryPoint rejected the UserOperation",
    cause: "The EntryPoint reported FailedOp with an AAxx code during validation or execution.",
    fix: "Read the AAxx code: AA21 prefund missing, AA23 signature or validation reverted, AA25 invalid nonce, AA31/AA33/AA34 paymaster problems.",
    status: 502,
    retryable: false,
    matchers: [/\bAA(1\d|2\d|3\d|4\d|5\d|9\d)\b/, /FailedOp(WithRevert)?/],
  },
  {
    code: "BUNDLER_UNREACHABLE",
    title: "Bundler or paymaster is unreachable",
    cause: "The request to the bundler or paymaster URL failed before any response.",
    fix: "Check PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL. Use checkSponsorship() to see which one failed.",
    status: 502,
    retryable: true,
    matchers: [/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|bundler[\s\S]{0,30}unreachable/i],
  },
  {
    code: "TX_NONCE_RACE",
    title: "Nonce conflict",
    cause: "Two transactions raced for one nonce, or a replacement was underpriced.",
    fix: "Serialize sends per account (a lock), re-read the pending nonce, and retry.",
    status: 409,
    retryable: true,
    matchers: [/nonce too (low|high)/i, /replacement transaction underpriced/i, /already known/i],
  },
  {
    code: "TX_GAS_UNDERSHOOT",
    title: "Gas limit too low",
    cause: "Nitro gas estimation undershoots on PEPU: the L1 data component is not covered by the plain estimate.",
    fix: "Add headroom to the estimate, 20% via withGasLimitBuffer() from @pepu-chain/sdk/session.",
    status: 502,
    retryable: true,
    matchers: [/intrinsic gas too low/i, /gas required exceeds allowance/i, /gas limit too low/i],
  },
  {
    code: "TX_REVERTED",
    title: "Transaction reverted",
    cause: "The contract call reverted.",
    fix: "Decode the revert reason with explainError(<revert data>) and check arguments, allowances and balances.",
    status: 502,
    retryable: false,
    matchers: [/execution reverted/i, /transaction (has )?reverted/i],
  },
  {
    code: "MULTICALL3_CANONICAL_ADDRESS",
    title: "Canonical Multicall3 address used on PEPU",
    cause: "PEPU's Multicall3 is not at the canonical 0xcA11...CA11 address.",
    fix: "Use getMulticall3() or pepuMulticall() from @pepu-chain/sdk, or the pepuMainnet chain object, which carries the right address.",
    status: 500,
    retryable: false,
    matchers: [/0xcA11bde05977b3631167028862bE2a173976CA11/i],
  },
  {
    code: "WALLET_INJECTED_ACTIVE",
    title: "An injected browser wallet is the active account",
    cause: "wagmi's active account is a browser extension rather than the Privy embedded wallet.",
    fix: "Pin the embedded wallet with useActiveWalletPin() from @pepu-chain/sdk/privy/wagmi.",
    status: 400,
    retryable: false,
    matchers: [/ConnectorNotConnectedError/i, /chrome-extension:\/\//i, /injected (wallet|provider|connector)/i],
  },
  {
    code: "CONFIG_PRIVY_CREATE_ON_LOGIN",
    title: "Embedded wallet never appears after login",
    cause: "The dashboard's automatic embedded wallet creation is off, so createOnLogin never resolves.",
    fix: "Create the wallet server-side with the ensure-wallet route (createEnsureWalletRoute), or enable creation in the Privy dashboard.",
    status: 500,
    retryable: false,
    matchers: [/createOnLogin/i, /embedded wallet[\s\S]{0,60}(never|did not|didn't) (appear|created)/i],
  },
  {
    code: "CONFIG_ORIGIN_MISMATCH",
    title: "Origin is not allowed by Privy",
    cause:
      "The page origin (scheme, host and port) is not in the Privy app's allowed origins. A different dev port is the usual cause.",
    fix: "Add the exact origin, including the port, to Privy dashboard Allowed origins.",
    status: 500,
    retryable: false,
    matchers: [/origin[^.\n]{0,60}(not allowed|not configured|not in (the )?allowed)/i, /allowed origins?/i],
  },
  {
    code: "CONFIG_PRIVY_DASHBOARD",
    title: "Privy dashboard misconfiguration",
    cause: "A required Privy dashboard setting is missing.",
    fix: "Run checkPrivyDashboardConfig() and follow its fix list.",
    status: 500,
    retryable: false,
    matchers: [],
  },
  {
    code: "CONFIG_MISSING_ENV",
    title: "Missing environment variable",
    cause: "A required environment variable is not set.",
    fix: "Set the listed variables (see .env.example) and restart the process.",
    status: 500,
    retryable: false,
    matchers: [/missing required env/i],
  },
  {
    code: "CONFIG_BAD_URL",
    title: "Invalid endpoint URL",
    cause: "A configured bundler, paymaster or RPC URL is not a valid http(s) URL.",
    fix: "Use a full URL such as https://bundler.example.com.",
    status: 500,
    retryable: false,
    matchers: [],
  },
  {
    code: "CONFIG_SERVER_ONLY",
    title: "Server-only module imported in the browser",
    cause: "A server entry point was bundled into client code.",
    fix: "Import server entries only from route handlers, server actions and scripts.",
    status: 500,
    retryable: false,
    matchers: [],
  },
  {
    code: "AUTH_INVALID_TOKEN",
    title: "Invalid or missing Privy access token",
    cause: "The request carried no bearer token, or Privy could not verify it.",
    fix: "Send Authorization: Bearer <getAccessToken()> and verify the token server-side.",
    status: 401,
    retryable: false,
    matchers: [/invalid (auth(orization)?|access|jwt|id) token/i, /\bjwt (expired|malformed|invalid)/i],
  },
  {
    code: "WALLET_NOT_PROVISIONED",
    title: "User has no embedded wallet yet",
    cause: "The user is signed in but no embedded Ethereum wallet exists.",
    fix: "Call the ensure-wallet route (useEnsureWallet or WalletGate) before acting.",
    status: 409,
    retryable: true,
    matchers: [],
  },
  {
    code: "POLICY_UNSCOPED",
    title: "Session policy is not scoped",
    cause: "A session policy needs a target contract, at least one function and an expiry.",
    fix: "Pass contractAddress, functions and expiresAtUnixSeconds to buildSessionPolicy().",
    status: 400,
    retryable: false,
    matchers: [],
  },
  {
    code: "SESSION_EXPIRED",
    title: "Session expired",
    cause: "The session's expiry has passed.",
    fix: "Grant a new session.",
    status: 410,
    retryable: false,
    matchers: [],
  },
  {
    code: "SESSION_NONE",
    title: "No active session",
    cause: "The user has not granted a session, or it was revoked.",
    fix: "Ask the user to grant a session first.",
    status: 409,
    retryable: false,
    matchers: [],
  },
  {
    code: "SESSION_APPROVAL_MISMATCH",
    title: "Session approval does not match",
    cause: "The approval was made for another account, permission id or mode.",
    fix: "Re-run prepare, have the owner sign again, then activate.",
    status: 409,
    retryable: false,
    matchers: [],
  },
  {
    code: "UNKNOWN",
    title: "Unknown error",
    cause: "The error did not match any known PEPU failure.",
    fix: "Read the original message. Run pepu_known_gotchas in the MCP server, or search the docs.",
    status: 500,
    retryable: false,
    matchers: [],
  },
];

const catalogByCode: ReadonlyMap<PepuErrorCode, ErrorCatalogEntry> = new Map(
  PEPU_ERROR_CATALOG.map((e) => [e.code, e]),
);

/** Look up a catalog entry by code. */
export function getErrorEntry(code: PepuErrorCode): ErrorCatalogEntry {
  const entry = catalogByCode.get(code) ?? catalogByCode.get("UNKNOWN");
  if (!entry) throw new Error("PEPU_ERROR_CATALOG is missing the UNKNOWN entry");
  return entry;
}

/** `https://docs.pepeunchained.com/reference/errors#<CODE>` */
export function errorDocsUrl(code: PepuErrorCode): string {
  return `${PEPU_ERRORS_DOCS_URL}#${code}`;
}

export interface PepuErrorOptions {
  hint?: string;
  docsUrl?: string;
  retryable?: boolean;
  status?: number;
  details?: unknown;
  cause?: unknown;
}

/**
 * Base class of every error the SDK throws. The constructor is positional:
 * `new PepuError(code, message?, options?)`. The code comes first; there is no
 * options-object form.
 *
 * @example
 * throw new PepuError("CONFIG_MISSING_ENV", "PEPU_BUNDLER_URL is not set.", { hint: "Set it in .env.local." });
 */
export class PepuError extends Error {
  readonly code: PepuErrorCode;
  readonly hint: string;
  readonly docsUrl: string;
  readonly retryable: boolean;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: PepuErrorCode, message?: string, options: PepuErrorOptions = {}) {
    const entry = getErrorEntry(code);
    super(message ?? entry.title, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.hint = options.hint ?? entry.fix;
    this.docsUrl = options.docsUrl ?? errorDocsUrl(code);
    this.retryable = options.retryable ?? entry.retryable;
    this.status = options.status ?? entry.status;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** Missing env, bad URL, dashboard misconfiguration. */
export class PepuConfigError extends PepuError {}
/** Bad or missing Privy token, wrong owner. */
export class PepuAuthError extends PepuError {}
/** Unscoped policy, name too long, expiry, denied by policy. */
export class PepuPolicyError extends PepuError {}
/** No session, expired, mismatched approval. */
export class PepuSessionError extends PepuError {}
/** AAxx, JSON-RPC errors, timeouts. */
export class PepuBundlerError extends PepuError {}
/** Reason codes, caps, balance, origin. */
export class PepuPaymasterError extends PepuError {}
/** Revert, nonce race, gas, rpc rate limit. */
export class PepuChainError extends PepuError {}

type PepuErrorClass = new (code: PepuErrorCode, message?: string, options?: PepuErrorOptions) => PepuError;

function classForCode(code: PepuErrorCode): PepuErrorClass {
  if (code.startsWith("CONFIG_") || code.startsWith("PRIVY_")) return PepuConfigError;
  if (code === "AUTH_INVALID_TOKEN" || code === "WALLET_NOT_PROVISIONED") return PepuAuthError;
  if (code.startsWith("POLICY_")) return PepuPolicyError;
  if (code.startsWith("SESSION_")) return PepuSessionError;
  if (code.startsWith("BUNDLER_")) return PepuBundlerError;
  if (code.startsWith("PAYMASTER_")) return PepuPaymasterError;
  if (code.startsWith("TX_") || code.startsWith("MULTICALL3_") || code.startsWith("WALLET_")) return PepuChainError;
  return PepuError;
}

const REVERT_ABI = [
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
  {
    type: "error",
    name: "FailedOp",
    inputs: [
      { name: "opIndex", type: "uint256" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "error",
    name: "FailedOpWithRevert",
    inputs: [
      { name: "opIndex", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "inner", type: "bytes" },
    ],
  },
] as const satisfies Abi;

function flatten(e: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 6 && cur !== undefined && cur !== null && !seen.has(cur); depth++) {
    seen.add(cur);
    if (typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      for (const k of ["shortMessage", "message", "details", "reason"]) {
        const v = o[k];
        if (typeof v === "string") parts.push(v);
      }
      cur = o["cause"];
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join("\n");
}

export interface ErrorExplanation {
  code: PepuErrorCode;
  title: string;
  cause: string;
  fix: string;
  docsUrl: string;
  matched: "catalog" | "abi-decode" | "unknown";
}

function matchCatalog(text: string): ErrorCatalogEntry | undefined {
  return PEPU_ERROR_CATALOG.find((entry) => entry.matchers.some((m) => m.test(text)));
}

function explanation(entry: ErrorCatalogEntry, matched: ErrorExplanation["matched"]): ErrorExplanation {
  return {
    code: entry.code,
    title: entry.title,
    cause: entry.cause,
    fix: entry.fix,
    docsUrl: errorDocsUrl(entry.code),
    matched,
  };
}

/**
 * Explain an error, an error message, or raw revert data (`0x...`). Pure and
 * synchronous; never throws.
 */
export function explainError(e: unknown | string | Hex): ErrorExplanation {
  if (e instanceof PepuError) return explanation(getErrorEntry(e.code), "catalog");

  if (typeof e === "string" && isHex(e) && e.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi: REVERT_ABI, data: e });
      const argText = (decoded.args ?? []).map((a) => (typeof a === "string" ? a : "")).join("\n");
      const hit = matchCatalog(`${argText}\n${decoded.errorName}`);
      if (hit) return explanation(hit, "abi-decode");
      return explanation(getErrorEntry("TX_REVERTED"), "abi-decode");
    } catch {
      return explanation(getErrorEntry("UNKNOWN"), "unknown");
    }
  }

  const text = typeof e === "string" ? e : flatten(e);
  const hit = matchCatalog(text);
  return hit ? explanation(hit, "catalog") : explanation(getErrorEntry("UNKNOWN"), "unknown");
}

/** Wrap anything thrown into a typed {@link PepuError}. PepuErrors pass through. */
export function toPepuError(e: unknown, ctx?: { op: string }): PepuError {
  if (e instanceof PepuError) return e;
  const explained = explainError(e);
  const original = (typeof e === "string" ? e : flatten(e)) || "Unknown error";
  const message = ctx ? `${ctx.op}: ${original}` : original;
  const Cls = classForCode(explained.code);
  return new Cls(explained.code, message, { cause: e });
}

/** The `{ error: { code, message, hint } }` body route factories return. */
export function toErrorBody(e: unknown): { error: { code: PepuErrorCode; message: string; hint: string } } {
  const err = toPepuError(e);
  return { error: { code: err.code, message: err.message, hint: err.hint } };
}

/** A JSON `Response` with the error body and the status from the error model. */
export function toErrorResponse(e: unknown): Response {
  const err = toPepuError(e);
  return new Response(JSON.stringify(toErrorBody(err)), {
    status: err.status,
    headers: { "content-type": "application/json" },
  });
}
