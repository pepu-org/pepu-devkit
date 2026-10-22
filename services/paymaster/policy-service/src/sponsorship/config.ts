/**
 * Configuration for the tiered-sponsorship (v2) code path. EVERYTHING here is env-driven and defaults to OFF:
 * `SPONSORSHIP_V2_ENABLED` must be exactly "true"/"1" for any v2 code to run. When it is not set, `loadSponsorshipConfig`
 * returns `null` and the service behaves exactly as it did before v2 existed (the v1 routes never read this file).
 *
 * Every number in the free-tier / project model is configurable here (see SPONSORSHIP-SPEC.md, "Numbers").
 *
 * SECURITY: nothing here may log secret values (admin token, RPC URL with API key). `describeConfig` is the only
 * thing meant to be printed and it redacts both.
 */
import type { Address } from "viem";
import { DEFAULT_KERNEL_ECDSA_VALIDATOR, DEFAULT_KERNEL_V31_FACTORY } from "./kernelOwnership.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PEPU = 10n ** 18n;

export interface FreeTierConfig {
  enabled: boolean;
  perUserDailyWei: bigint;
  perUserHourlyWei: bigint;
  perUserDailyCount: number;
  perUserHourlyCount: number;
}

/** Bounds on the gas/fee fields of a user-supplied op that the signer is willing to approve (audit L-4). */
export interface GasBounds {
  maxPreVerificationGas: bigint;
  maxVerificationGasLimit: bigint;
  maxCallGasLimit: bigint;
  /** maxFeePerGas must be <= baseFee * this multiple (and <= `maxFeePerGasCapWei`). */
  maxFeeBaseFeeMultiple: number;
  /** maxPriorityFeePerGas must be <= baseFee * this multiple (and <= maxFeePerGas). */
  maxPriorityBaseFeeMultiple: number;
  /** Absolute ceiling on maxFeePerGas (wei). Keep it <= the contract's on-chain default cap. */
  maxFeePerGasCapWei: bigint;
}

/**
 * Caps on LIVE, UNEXECUTED approvals ("reservations") a client token can hold (audit M-1). Shares are in basis points of
 * the project's budget = min(on-chain balance, daily limit); every scope may always hold at least `minOps` worst-case ops
 * so small budgets stay usable. Server keys (secret) are exempt from the IP and credential caps.
 */
export interface ReservationCaps {
  perSenderMaxCount: number;
  perIpBps: number;
  perCredentialBps: number;
  minOps: number;
}

export interface SponsorshipConfig {
  paymasterAddress: Address;
  entryPointAddress: Address;
  chainId: number;
  /** Contains an API key in production: never log. */
  rpcUrl: string;
  deployBlock: bigint;
  /** Max block span per eth_getLogs request. */
  logChunkBlocks: bigint;
  dbPath: string;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validityWindowSeconds: number;
  allowAccountDeployment: boolean;
  /** When true, a Privy token must prove it owns `sender` (v1 parity). Set false if Privy does not link smart wallets. */
  requireSenderOwnership: boolean;
  /** Kernel v3.1 factory and ECDSA validator used to derive a user's account from their embedded wallet (kernelOwnership.ts). */
  kernel: { factory: Address; ecdsaValidator: Address; index: bigint };
  freeTier: FreeTierConfig;
  gasBounds: GasBounds;
  reservations: ReservationCaps;
  project: { defaultPerUserDailyWei: bigint; maxPerUserDailyWei: bigint };
  /** Validity (seconds) of an ownership-claim attestation the signer issues. */
  claimAttestationTtlSeconds: number;
  siwe: {
    domains: string[];
    nonceTtlSeconds: number;
    sessionTtlSeconds: number;
    maxMessageLifetimeSeconds: number;
    clockSkewSeconds: number;
  };
  /** Separate from v1's ADMIN_TOKEN. null disables every /v2/admin route. */
  adminToken: string | null;
  publicBaseUrl: string;
  apiAllowedOrigins: string[];
  paymasterRpcAllowedOrigins: string[] | null;
  trustProxy: boolean;
  /** With trustProxy: how many trusted reverse proxies append to X-Forwarded-For; the client is entry (length - hops). */
  trustedProxyHops: number;
  rateLimits: {
    authPerIpPerMinute: number;
    ownerPerAddressPerMinute: number;
    adminPerIpPerMinute: number;
    rpcPerKeyPerMinute: number;
    publicPerIpPerMinute: number;
    /** POST /v2/projects/verify per IP (each call makes one outbound Privy request with a developer's secret). */
    verifyPerIpPerMinute: number;
    /** ... and per Privy app id (bounds secret guessing against any one app). */
    verifyPerAppPerMinute: number;
    /** pm_getPaymasterData / POST /v2/sponsor evaluations per IP when the CLIENT token is used. */
    clientTokenPerIpPerMinute: number;
    /** POST /v2/sponsor requests per IP, checked BEFORE the body is read (review 3, M-3). */
    sponsorPerIpPerMinute: number;
    /** ERC-7677 requests per IP whose URL token resolves to no credential (junk tokens dodge the per-token limiter). */
    rpcUnknownTokenPerIpPerMinute: number;
  };
  /** Days of `audit_log_v2` rows to keep; the reconciler prunes older rows. 0 = keep forever. */
  auditRetentionDays: number;
  reconcileIntervalSeconds: number;
  /** Seconds after validUntil before an unsettled approval is voided (covers indexing lag). */
  voidSafetyMarginSeconds: number;
  chainCacheTtlMs: number;
  identityCacheTtlMs: number;
  identityNegativeCacheTtlMs: number;
}

type Env = Record<string, string | undefined>;

function opt(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function reqStr(env: Env, name: string): string {
  const v = opt(env, name);
  if (!v) throw new Error(`Missing required environment variable ${name} (SPONSORSHIP_V2_ENABLED=true).`);
  return v;
}

function envBigInt(env: Env, name: string, fallback: bigint): bigint {
  const raw = opt(env, name);
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`Environment variable ${name} must be a non-negative integer (wei), got a non-numeric value.`);
  return BigInt(raw);
}

function envInt(env: Env, name: string, fallback: number, min = 0): number {
  const raw = opt(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`Environment variable ${name} must be an integer >= ${min}.`);
  return n;
}

function envBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = opt(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`Environment variable ${name} must be "true" or "false".`);
}

function envList(env: Env, name: string): string[] | null {
  const raw = opt(env, name);
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return list.length > 0 ? list : null;
}

function envAddress(env: Env, name: string, fallback?: string): Address {
  const v = opt(env, name) ?? fallback;
  if (!v || !ADDRESS_RE.test(v)) throw new Error(`Environment variable ${name} must be a 0x-prefixed 20-byte address.`);
  return v as Address;
}

/** True iff the feature flag is on. Cheap check that does not validate anything else. */
export function isSponsorshipV2Enabled(env: Env = process.env): boolean {
  return envBool(env, "SPONSORSHIP_V2_ENABLED", false);
}

/**
 * Returns `null` when v2 is disabled (the default). When enabled, validates everything and throws a clear message
 * on a missing/invalid value rather than starting half-configured.
 */
export function loadSponsorshipConfig(env: Env = process.env, defaults: { dbDir?: string } = {}): SponsorshipConfig | null {
  if (!isSponsorshipV2Enabled(env)) return null;

  const rpcUrl =
    opt(env, "SPONSORSHIP_V2_RPC_URL") ??
    (opt(env, "CONDUIT_API_KEY")
      ? `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${opt(env, "CONDUIT_API_KEY")}`
      : undefined);
  if (!rpcUrl) throw new Error("Missing SPONSORSHIP_V2_RPC_URL (or CONDUIT_API_KEY) for chain reads (SPONSORSHIP_V2_ENABLED=true).");

  const adminToken = opt(env, "SPONSORSHIP_ADMIN_TOKEN") ?? null;
  if (adminToken !== null && adminToken.length < 32) {
    throw new Error("SPONSORSHIP_ADMIN_TOKEN must be at least 32 characters (use e.g. `openssl rand -hex 32`).");
  }

  const siweDomains = envList(env, "SPONSORSHIP_SIWE_DOMAINS");
  if (!siweDomains) {
    throw new Error("Missing SPONSORSHIP_SIWE_DOMAINS (comma-separated expected SIWE `domain` values, e.g. dashboard.example.com).");
  }

  const freeDaily = envBigInt(env, "FREE_TIER_PER_USER_DAILY_WEI", 50n * PEPU);
  const freeHourly = envBigInt(env, "FREE_TIER_PER_USER_HOURLY_WEI", 30n * PEPU);
  if (freeHourly > freeDaily) throw new Error("FREE_TIER_PER_USER_HOURLY_WEI must be <= FREE_TIER_PER_USER_DAILY_WEI.");

  const projDefault = envBigInt(env, "PROJECT_DEFAULT_PER_USER_DAILY_WEI", 200n * PEPU);
  const projMax = envBigInt(env, "PROJECT_MAX_PER_USER_DAILY_WEI", 5_000n * PEPU);
  if (projDefault > projMax) throw new Error("PROJECT_DEFAULT_PER_USER_DAILY_WEI must be <= PROJECT_MAX_PER_USER_DAILY_WEI.");

  const publicBaseUrl = reqStr(env, "SPONSORSHIP_PUBLIC_BASE_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(publicBaseUrl)) throw new Error("SPONSORSHIP_PUBLIC_BASE_URL must start with http:// or https://");

  const postOpGasLimit = envBigInt(env, "SPONSORSHIP_V2_PM_POST_OP_GAS_LIMIT", 40_000n);
  if (postOpGasLimit < 40_000n) {
    throw new Error("SPONSORSHIP_V2_PM_POST_OP_GAS_LIMIT must be >= 40000 (the contract's MIN_POSTOP_GAS_LIMIT rejects lower values).");
  }

  return {
    paymasterAddress: envAddress(env, "SPONSORSHIP_V2_PAYMASTER_ADDRESS"),
    entryPointAddress: envAddress(env, "ENTRY_POINT_ADDRESS", "0x0000000071727De22E5E9d8BAf0edAc6f37da032"),
    chainId: envInt(env, "CHAIN_ID", 97741, 1),
    rpcUrl,
    deployBlock: envBigInt(env, "SPONSORSHIP_V2_DEPLOY_BLOCK", 0n),
    logChunkBlocks: envBigInt(env, "SPONSORSHIP_V2_LOG_CHUNK_BLOCKS", 5_000n),
    dbPath: opt(env, "SPONSORSHIP_V2_DB_PATH") ?? `${defaults.dbDir ?? "./data"}/sponsorship.db`,
    // Measured in Foundry (isolated, cold storage): validation ~85-99k gas (the first op of a new sender pays the
    // per-sender counter write), postOp ~8.3k honest / ~13.9k worst case as the EntryPoint attributes it (dispatch
    // included; review 3, L-6 snapshot). MIN_POSTOP_GAS_LIMIT on-chain is 40k, and the service default
    // IS the minimum: EntryPoint v0.7 charges 10% of unused execution gas (callGasLimit + postOpGasLimit), so a
    // larger postOp limit only adds charge.
    paymasterVerificationGasLimit: envBigInt(env, "SPONSORSHIP_V2_PM_VERIFICATION_GAS_LIMIT", 200_000n),
    paymasterPostOpGasLimit: envBigInt(env, "SPONSORSHIP_V2_PM_POST_OP_GAS_LIMIT", 40_000n),
    validityWindowSeconds: envInt(env, "SPONSORSHIP_V2_VALIDITY_WINDOW_SECONDS", 60, 1),
    allowAccountDeployment: envBool(env, "SPONSORSHIP_V2_ALLOW_ACCOUNT_DEPLOYMENT", true),
    requireSenderOwnership: envBool(env, "SPONSORSHIP_V2_REQUIRE_SENDER_OWNERSHIP", true),
    kernel: {
      factory: envAddress(env, "SPONSORSHIP_V2_KERNEL_FACTORY", DEFAULT_KERNEL_V31_FACTORY),
      ecdsaValidator: envAddress(env, "SPONSORSHIP_V2_KERNEL_ECDSA_VALIDATOR", DEFAULT_KERNEL_ECDSA_VALIDATOR),
      index: 0n,
    },
    freeTier: {
      enabled: envBool(env, "FREE_TIER_ENABLED", true),
      perUserDailyWei: freeDaily,
      perUserHourlyWei: freeHourly,
      perUserDailyCount: envInt(env, "FREE_TIER_PER_USER_DAILY_COUNT", 40, 1),
      perUserHourlyCount: envInt(env, "FREE_TIER_PER_USER_HOURLY_COUNT", 20, 1),
    },
    gasBounds: {
      maxPreVerificationGas: envBigInt(env, "SPONSORSHIP_V2_MAX_PRE_VERIFICATION_GAS", 1_000_000n),
      maxVerificationGasLimit: envBigInt(env, "SPONSORSHIP_V2_MAX_VERIFICATION_GAS_LIMIT", 1_500_000n),
      maxCallGasLimit: envBigInt(env, "SPONSORSHIP_V2_MAX_CALL_GAS_LIMIT", 3_000_000n),
      maxFeeBaseFeeMultiple: envInt(env, "SPONSORSHIP_V2_MAX_FEE_BASEFEE_MULTIPLE", 3, 1),
      maxPriorityBaseFeeMultiple: envInt(env, "SPONSORSHIP_V2_MAX_PRIORITY_BASEFEE_MULTIPLE", 1, 0),
      // Matches the deploy script's default on-chain cap (40,000 gwei, about 3x the measured ~12,500 gwei base fee).
      maxFeePerGasCapWei: envBigInt(env, "SPONSORSHIP_V2_MAX_FEE_PER_GAS_CAP_WEI", 40_000n * 10n ** 9n),
    },
    reservations: {
      perSenderMaxCount: envInt(env, "SPONSORSHIP_RESERVATION_PER_SENDER_MAX_COUNT", 2, 1),
      perIpBps: envInt(env, "SPONSORSHIP_RESERVATION_PER_IP_BPS", 500, 1),
      perCredentialBps: envInt(env, "SPONSORSHIP_RESERVATION_PER_CREDENTIAL_BPS", 2500, 1),
      minOps: envInt(env, "SPONSORSHIP_RESERVATION_MIN_OPS", 2, 1),
    },
    project: { defaultPerUserDailyWei: projDefault, maxPerUserDailyWei: projMax },
    // The contract rejects attestations whose deadline is more than 1 hour ahead (MAX_CLAIM_DEADLINE_AHEAD): clamp.
    claimAttestationTtlSeconds: Math.min(envInt(env, "SPONSORSHIP_CLAIM_ATTESTATION_TTL_SECONDS", 600, 60), 3_600),
    siwe: {
      domains: siweDomains,
      nonceTtlSeconds: envInt(env, "SPONSORSHIP_SIWE_NONCE_TTL_SECONDS", 300, 30),
      sessionTtlSeconds: envInt(env, "SPONSORSHIP_SESSION_TTL_SECONDS", 3600, 60),
      maxMessageLifetimeSeconds: envInt(env, "SPONSORSHIP_SIWE_MAX_MESSAGE_LIFETIME_SECONDS", 600, 60),
      clockSkewSeconds: envInt(env, "SPONSORSHIP_SIWE_CLOCK_SKEW_SECONDS", 60, 0),
    },
    adminToken,
    publicBaseUrl,
    apiAllowedOrigins: envList(env, "SPONSORSHIP_API_ALLOWED_ORIGINS") ?? [],
    paymasterRpcAllowedOrigins: envList(env, "PAYMASTER_RPC_ALLOWED_ORIGINS"),
    trustProxy: envBool(env, "TRUST_PROXY", false),
    trustedProxyHops: envInt(env, "TRUSTED_PROXY_HOPS", 1, 1),
    rateLimits: {
      authPerIpPerMinute: envInt(env, "RATE_LIMIT_AUTH_PER_IP_PER_MIN", 20, 1),
      ownerPerAddressPerMinute: envInt(env, "RATE_LIMIT_OWNER_PER_ADDRESS_PER_MIN", 120, 1),
      adminPerIpPerMinute: envInt(env, "RATE_LIMIT_ADMIN_PER_IP_PER_MIN", 30, 1),
      rpcPerKeyPerMinute: envInt(env, "RATE_LIMIT_RPC_PER_KEY_PER_MIN", 600, 1),
      publicPerIpPerMinute: envInt(env, "RATE_LIMIT_PUBLIC_PER_IP_PER_MIN", 120, 1),
      verifyPerIpPerMinute: envInt(env, "RATE_LIMIT_VERIFY_PER_IP_PER_MIN", 10, 1),
      verifyPerAppPerMinute: envInt(env, "RATE_LIMIT_VERIFY_PER_APP_PER_MIN", 5, 1),
      clientTokenPerIpPerMinute: envInt(env, "RATE_LIMIT_CLIENT_TOKEN_PER_IP_PER_MIN", 30, 1),
      sponsorPerIpPerMinute: envInt(env, "RATE_LIMIT_SPONSOR_PER_IP_PER_MIN", 600, 1),
      rpcUnknownTokenPerIpPerMinute: envInt(env, "RATE_LIMIT_RPC_UNKNOWN_TOKEN_PER_IP_PER_MIN", 60, 1),
    },
    auditRetentionDays: envInt(env, "SPONSORSHIP_AUDIT_RETENTION_DAYS", 30, 0),
    reconcileIntervalSeconds: envInt(env, "SPONSORSHIP_RECONCILE_INTERVAL_SECONDS", 15, 1),
    voidSafetyMarginSeconds: envInt(env, "SPONSORSHIP_VOID_SAFETY_MARGIN_SECONDS", 60, 0),
    chainCacheTtlMs: envInt(env, "SPONSORSHIP_CHAIN_CACHE_TTL_MS", 2_000, 0),
    identityCacheTtlMs: envInt(env, "SPONSORSHIP_IDENTITY_CACHE_TTL_MS", 600_000, 0),
    identityNegativeCacheTtlMs: envInt(env, "SPONSORSHIP_IDENTITY_NEGATIVE_CACHE_TTL_MS", 60_000, 0),
  };
}

/** Safe-to-log summary: never includes the RPC URL or the admin token. */
export function describeConfig(c: SponsorshipConfig): Record<string, unknown> {
  return {
    paymaster: c.paymasterAddress,
    chainId: c.chainId,
    freeTierEnabled: c.freeTier.enabled,
    freeTierPerUserDailyWei: c.freeTier.perUserDailyWei.toString(),
    freeTierRequiresPrivyToken: true,
    adminApi: c.adminToken !== null ? "enabled" : "disabled",
    siweDomains: c.siwe.domains,
    dbPath: c.dbPath,
  };
}
