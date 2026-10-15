import { decodeErrorResult } from "viem";
import type { Hex } from "viem";

import { PepuPaymasterError } from "../errors.js";
import type { PepuErrorCode } from "../errors.js";
import { pepuSponsoredPaymasterV2Abi } from "./abi.js";

/**
 * Denial reasons the v2 policy service returns (services/paymaster/policy-service/src/sponsorship/types.ts,
 * `SponsorshipDenialReason`) plus the v1-only reasons (`src/types.ts`, `DenialReason`).
 */
export const PAYMASTER_DENIAL_REASONS = [
  // v2
  "unknown_or_invalid_app_credential",
  "app_suspended",
  "invalid_or_expired_token",
  "sender_not_owned_by_token_user",
  "calldata_decode_failed",
  "project_not_claimed_onchain",
  "project_owner_changed",
  "project_paused",
  "project_balance_exhausted",
  "project_daily_limit_reached",
  "project_user_cap_exceeded",
  "project_identity_required",
  "project_origin_not_allowed",
  "project_sender_limit_reached",
  "project_sender_limit_not_set",
  "account_deployment_disabled",
  "target_not_allowed_onchain",
  "destination_not_allowed_for_app",
  "free_tier_disabled",
  "free_tier_identity_required",
  "free_tier_user_daily_exceeded",
  "free_tier_user_hourly_exceeded",
  "free_tier_count_exceeded",
  "free_tier_sender_limit_reached",
  "free_pool_empty",
  "free_pool_op_too_large",
  "chain_read_failed",
  "gas_limits_out_of_bounds",
  "fee_out_of_bounds",
  "fee_above_onchain_cap",
  "reservation_cap_exceeded",
  "rate_limited",
  "malformed_request",
  // v1 only
  "destination_not_globally_allowed",
  "user_hourly_count_cap_exceeded",
  "user_daily_count_cap_exceeded",
  "user_lifetime_count_cap_exceeded",
  "user_hourly_spend_cap_exceeded",
  "user_daily_spend_cap_exceeded",
  "user_lifetime_spend_cap_exceeded",
  "app_daily_spend_cap_exceeded",
  "app_lifetime_spend_cap_exceeded",
  "global_circuit_breaker_tripped",
] as const;

export type PaymasterDenialReason = (typeof PAYMASTER_DENIAL_REASONS)[number];

/** Reason to catalog code. Exhaustive over {@link PAYMASTER_DENIAL_REASONS} (checked by the compiler). */
export const PAYMASTER_REASON_CODES: Readonly<Record<PaymasterDenialReason, PepuErrorCode>> = {
  unknown_or_invalid_app_credential: "PAYMASTER_DENIED",
  app_suspended: "PAYMASTER_DENIED",
  invalid_or_expired_token: "AUTH_INVALID_TOKEN",
  sender_not_owned_by_token_user: "PAYMASTER_DENIED",
  calldata_decode_failed: "PAYMASTER_DENIED",
  project_not_claimed_onchain: "PAYMASTER_PROJECT_NOT_CLAIMED",
  project_owner_changed: "PAYMASTER_PROJECT_OWNER_CHANGED",
  project_paused: "PAYMASTER_PROJECT_PAUSED",
  project_balance_exhausted: "PAYMASTER_NO_BALANCE",
  project_daily_limit_reached: "PAYMASTER_CAP",
  project_user_cap_exceeded: "PAYMASTER_CAP",
  project_identity_required: "PAYMASTER_IDENTITY_REQUIRED",
  project_origin_not_allowed: "PAYMASTER_ORIGIN_NOT_ALLOWED",
  project_sender_limit_reached: "PAYMASTER_CAP",
  project_sender_limit_not_set: "PAYMASTER_DENIED",
  account_deployment_disabled: "PAYMASTER_DENIED",
  target_not_allowed_onchain: "PAYMASTER_DESTINATION_NOT_ALLOWED",
  destination_not_allowed_for_app: "PAYMASTER_DESTINATION_NOT_ALLOWED",
  free_tier_disabled: "PAYMASTER_FREE_TIER_UNAVAILABLE",
  free_tier_identity_required: "PAYMASTER_IDENTITY_REQUIRED",
  free_tier_user_daily_exceeded: "PAYMASTER_CAP",
  free_tier_user_hourly_exceeded: "PAYMASTER_CAP",
  free_tier_count_exceeded: "PAYMASTER_CAP",
  free_tier_sender_limit_reached: "PAYMASTER_CAP",
  free_pool_empty: "PAYMASTER_FREE_TIER_UNAVAILABLE",
  free_pool_op_too_large: "PAYMASTER_FREE_TIER_UNAVAILABLE",
  chain_read_failed: "PAYMASTER_API_ERROR",
  gas_limits_out_of_bounds: "PAYMASTER_DENIED",
  fee_out_of_bounds: "PAYMASTER_DENIED",
  fee_above_onchain_cap: "PAYMASTER_CAP",
  reservation_cap_exceeded: "PAYMASTER_CAP",
  rate_limited: "PAYMASTER_RATE_LIMITED",
  malformed_request: "PAYMASTER_DENIED",
  destination_not_globally_allowed: "PAYMASTER_DESTINATION_NOT_ALLOWED",
  user_hourly_count_cap_exceeded: "PAYMASTER_CAP",
  user_daily_count_cap_exceeded: "PAYMASTER_CAP",
  user_lifetime_count_cap_exceeded: "PAYMASTER_CAP",
  user_hourly_spend_cap_exceeded: "PAYMASTER_CAP",
  user_daily_spend_cap_exceeded: "PAYMASTER_CAP",
  user_lifetime_spend_cap_exceeded: "PAYMASTER_CAP",
  app_daily_spend_cap_exceeded: "PAYMASTER_CAP",
  app_lifetime_spend_cap_exceeded: "PAYMASTER_CAP",
  global_circuit_breaker_tripped: "PAYMASTER_CAP",
};

/** Reasons that are transient (retrying later can succeed). Everything else follows the catalog default. */
const RETRYABLE_REASONS: ReadonlySet<string> = new Set(["chain_read_failed", "rate_limited"]);

/**
 * Map a denial reason string to a catalog code. Unknown reasons (a newer
 * service) map to `PAYMASTER_DENIED` so callers always get a typed error.
 *
 * @example
 * ```ts
 * mapPaymasterReason("project_not_claimed_onchain"); // "PAYMASTER_PROJECT_NOT_CLAIMED"
 * ```
 */
export function mapPaymasterReason(reason: string | undefined): PepuErrorCode {
  if (reason !== undefined && Object.prototype.hasOwnProperty.call(PAYMASTER_REASON_CODES, reason)) {
    return PAYMASTER_REASON_CODES[reason as PaymasterDenialReason];
  }
  return "PAYMASTER_DENIED";
}

/**
 * Build the typed error for a denial reason. The message carries the reason
 * code and the service's message (service messages never contain credentials).
 *
 * @example
 * ```ts
 * throw paymasterReasonToError("project_paused", "project is paused");
 * ```
 */
export function paymasterReasonToError(
  reason: string | undefined,
  message?: string,
  details?: unknown,
): PepuPaymasterError {
  const code = mapPaymasterReason(reason);
  const text = `Paymaster denied the operation${reason ? ` (${reason})` : ""}${message ? `: ${message}` : "."}`;
  const retryable = reason !== undefined && RETRYABLE_REASONS.has(reason) ? true : undefined;
  return new PepuPaymasterError(code, text, {
    details: { reason, ...(details && typeof details === "object" ? (details as object) : {}) },
    ...(retryable === undefined ? {} : { retryable }),
  });
}

/**
 * Decode raw revert data from the v2 paymaster contract (for example
 * `ProjectNotClaimed(bytes32)`, `ClaimExpired(uint256)`, `NotProjectOwner()`).
 * Returns `null` when the data is not one of the contract's errors.
 *
 * @example
 * ```ts
 * const r = decodePaymasterRevert("0x..."); // { errorName: "NotProjectOwner", args: undefined }
 * ```
 */
export function decodePaymasterRevert(data: Hex): { errorName: string; args: readonly unknown[] | undefined } | null {
  try {
    const d = decodeErrorResult({ abi: pepuSponsoredPaymasterV2Abi, data });
    return { errorName: d.errorName, args: d.args };
  } catch {
    return null;
  }
}
