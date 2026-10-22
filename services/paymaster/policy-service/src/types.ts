import type { Address, Hex } from "viem";

/** A registered app allowed to request sponsorship, keyed by a hashed API key. */
export interface RegisteredApp {
  id: string;
  /** sha256(rawApiKey) hex digest, lowercase, no 0x prefix. Never store the raw key. */
  apiKeyHashHex: string;
  /**
   * This app's own destination allowlist, scoped down from the global
   * allowlist. A destination must be allowed by BOTH the global allowlist
   * AND this list (see README "Global vs per-app allowlist relationship").
   * `"*"` means "defer entirely to the global allowlist" (no further
   * per-app narrowing) — used for apps that don't need to scope down.
   */
  allowedDestinations: readonly Address[] | "*";
  /** Per-app daily spend ceiling, wei, calendar-day UTC. */
  dailySpendCapWei: bigint;
  /** Per-app lifetime spend ceiling, wei. `null` = no lifetime cap. */
  lifetimeSpendCapWei: bigint | null;
}

export interface AppRegistryConfig {
  apps: readonly RegisteredApp[];
}

export interface GlobalAllowlistConfig {
  destinations: readonly Address[];
}

/** The subset of a v0.7 "unpacked" JSON-RPC UserOperation this service accepts. */
export interface SponsorUserOperationInput {
  sender: Address;
  nonce: bigint;
  factory?: Address | undefined;
  factoryData?: Hex | undefined;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface SponsorRequestBody {
  userOp: SponsorUserOperationInput;
}

export type DenialReason =
  | "invalid_or_expired_token"
  | "sender_not_owned_by_token_user"
  | "unknown_or_invalid_app_credential"
  | "calldata_decode_failed"
  | "destination_not_globally_allowed"
  | "destination_not_allowed_for_app"
  | "user_hourly_count_cap_exceeded"
  | "user_daily_count_cap_exceeded"
  | "user_lifetime_count_cap_exceeded"
  | "user_hourly_spend_cap_exceeded"
  | "user_daily_spend_cap_exceeded"
  | "user_lifetime_spend_cap_exceeded"
  | "app_daily_spend_cap_exceeded"
  | "app_lifetime_spend_cap_exceeded"
  | "global_circuit_breaker_tripped"
  | "malformed_request";

export interface SponsorApprovalResponse {
  status: "approved";
  chainId: number;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  validUntil: number;
  validAfter: number;
  userOpHash: Hex;
}

export interface SponsorDenialResponse {
  status: "denied";
  reason: DenialReason;
  message: string;
}

export type SponsorResponse = SponsorApprovalResponse | SponsorDenialResponse;

/** One row of the audit trail — see db.ts. Every decision, allowed or denied. */
export interface AuditLogEntry {
  tsMs: number;
  decision: "approved" | "denied";
  reason: string;
  userId: string | null;
  appId: string | null;
  sender: Address | null;
  targets: readonly Address[];
  worstCaseCostWei: string | null;
  userOpHash: Hex | null;
  finalHash: Hex | null;
  validUntil: number | null;
  validAfter: number | null;
}
