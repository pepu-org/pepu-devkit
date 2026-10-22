/**
 * Shared types for the tiered-sponsorship (v2) code path. See services/paymaster/SPONSORSHIP-SPEC.md.
 */
import type { Address, Hex } from "viem";

/** Denial reasons added by v2 (v1's reasons that still apply are reused as plain strings). */
export type SponsorshipDenialReason =
  | "unknown_or_invalid_app_credential"
  | "app_suspended"
  | "invalid_or_expired_token"
  | "sender_not_owned_by_token_user"
  | "calldata_decode_failed"
  | "project_not_claimed_onchain"
  | "project_owner_changed"
  | "project_paused"
  | "project_balance_exhausted"
  | "project_daily_limit_reached"
  | "project_user_cap_exceeded"
  | "project_identity_required"
  | "project_origin_not_allowed"
  | "project_sender_limit_reached"
  | "project_sender_limit_not_set"
  | "account_deployment_disabled"
  | "target_not_allowed_onchain"
  | "destination_not_allowed_for_app"
  | "free_tier_disabled"
  | "free_tier_identity_required"
  | "free_tier_user_daily_exceeded"
  | "free_tier_user_hourly_exceeded"
  | "free_tier_count_exceeded"
  | "free_tier_sender_limit_reached"
  | "free_pool_empty"
  | "free_pool_op_too_large"
  | "chain_read_failed"
  | "gas_limits_out_of_bounds"
  | "fee_out_of_bounds"
  | "fee_above_onchain_cap"
  | "reservation_cap_exceeded"
  | "rate_limited"
  | "malformed_request";

export type SponsorKind = "project" | "free";

export interface SponsorshipApproval {
  status: "approved";
  chainId: number;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  validUntil: number;
  validAfter: number;
  /** EntryPoint's canonical userOpHash (what on-chain events carry). */
  userOpHash: Hex;
  sponsor: { kind: SponsorKind; sponsorId: Hex; projectKey: string };
  maxCostWei: string;
}

export interface SponsorshipDenial {
  status: "denied";
  reason: SponsorshipDenialReason;
  message: string;
  /** Per-tier reasons when both tiers were tried (project first, then free). */
  detail?: { project?: SponsorshipDenialReason; free?: SponsorshipDenialReason };
}

export type SponsorshipResponse = SponsorshipApproval | SponsorshipDenial;

/**
 * `privy`: a verified Privy account (the ONLY identity the chain free tier accepts).
 * `sender`: a bare wallet address, usable for project budgets only (never the free tier).
 */
export type IdentityKind = "privy" | "sender";

export interface ResolvedIdentity {
  kind: IdentityKind;
  /** `privy:<userId>` or `sender:<0xaddr>`; the budget key. */
  key: string;
}

export interface ProjectRecord {
  /** `0x<projectId>` for on-chain projects, `app:<slug>` for admin-created free-tier-only apps. */
  key: string;
  /** On-chain project id = keccak256(bytes(appId)); null for free-tier-only apps. */
  projectId: Hex | null;
  appId: string;
  /** Lower-cased snapshot of the on-chain owner; null for free-tier-only apps. */
  owner: Address | null;
  /** Publishable client token (ERC-7677 URL). Browser-visible, so for project budgets it is bound to `allowedOrigins`. */
  tokenPrefix: string | null;
  tokenRotatedAtMs: number | null;
  /** Server API key (secret; never ship to a browser). Works for any wallet, no origin restriction. */
  serverKeyPrefix: string | null;
  serverKeyRotatedAtMs: number | null;
  /** Origins allowed to use the client token against the PROJECT budget (empty = the client token cannot spend it). */
  allowedOrigins: string[];
  status: "active" | "suspended";
  perUserDailyCapWei: bigint;
  requireIdentity: boolean;
  /** Off-chain destination narrowing for free-tier-only apps (null = defer to the on-chain free list). */
  allowedDestinations: Address[] | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface UsageRow {
  id: number;
  tsMs: number;
  sponsor: string;
  projectKey: string;
  identityKey: string;
  identityKind: IdentityKind;
  sender: Address;
  reservedWei: bigint;
  finalWei: bigint | null;
  status: "approved" | "settled" | "voided";
  executed: boolean;
  validUntil: number;
  pmHash: Hex;
  epHash: Hex | null;
  settledBlock: number | null;
  settledTx: Hex | null;
}

export interface OnchainSponsor {
  owner: Address;
  paused: boolean;
  /** Per-sender daily limit (projects: > 0; free pool: 0 = off). */
  senderDailyLimit: bigint;
  balance: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  spentDay: number;
  /** Effective on-chain cap on an op's maxFeePerGas for this sponsor (wei): its own, else the contract default. */
  maxFeePerGasCap: bigint;
}

/** Which credential authenticated a sponsorship request. */
export type CredentialKind = "client" | "server";

export interface ResolvedCredential {
  project: ProjectRecord;
  kind: CredentialKind;
}

/** On-chain free-pool configuration. There is deliberately NO chain-wide daily ceiling. */
export interface OnchainFreeConfig {
  enabled: boolean;
  maxOpCost: bigint;
  senderDailyLimit: bigint;
}

export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}
