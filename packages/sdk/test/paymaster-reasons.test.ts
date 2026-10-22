import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";

import { PEPU_ERROR_CATALOG, PepuPaymasterError, explainError } from "../src/errors.js";
import { pepuSponsoredPaymasterV2Abi } from "../src/paymaster/abi.js";
import {
  PAYMASTER_DENIAL_REASONS,
  PAYMASTER_REASON_CODES,
  decodePaymasterRevert,
  mapPaymasterReason,
  paymasterReasonToError,
} from "../src/paymaster/reasons.js";

describe("paymaster denial reasons", () => {
  it("maps every known reason to a catalog code", () => {
    const codes = new Set(PEPU_ERROR_CATALOG.map((e) => e.code));
    for (const r of PAYMASTER_DENIAL_REASONS) expect(codes.has(PAYMASTER_REASON_CODES[r])).toBe(true);
  });

  it("maps the v2 claim reasons to dedicated codes", () => {
    expect(mapPaymasterReason("project_not_claimed_onchain")).toBe("PAYMASTER_PROJECT_NOT_CLAIMED");
    expect(mapPaymasterReason("project_owner_changed")).toBe("PAYMASTER_PROJECT_OWNER_CHANGED");
    expect(mapPaymasterReason("project_paused")).toBe("PAYMASTER_PROJECT_PAUSED");
    expect(mapPaymasterReason("project_balance_exhausted")).toBe("PAYMASTER_NO_BALANCE");
    expect(mapPaymasterReason("project_origin_not_allowed")).toBe("PAYMASTER_ORIGIN_NOT_ALLOWED");
    expect(mapPaymasterReason("target_not_allowed_onchain")).toBe("PAYMASTER_DESTINATION_NOT_ALLOWED");
    expect(mapPaymasterReason("free_tier_identity_required")).toBe("PAYMASTER_IDENTITY_REQUIRED");
    expect(mapPaymasterReason("project_sender_limit_reached")).toBe("PAYMASTER_CAP");
  });

  it("maps the review-3 reasons (project with no per-wallet limit, account deployment off) to PAYMASTER_DENIED", () => {
    expect(mapPaymasterReason("project_sender_limit_not_set")).toBe("PAYMASTER_DENIED");
    expect(mapPaymasterReason("account_deployment_disabled")).toBe("PAYMASTER_DENIED");
    expect(paymasterReasonToError("project_sender_limit_not_set", "set it").message).toContain("project_sender_limit_not_set");
  });

  it("falls back to PAYMASTER_DENIED for unknown reasons, without prototype lookups", () => {
    expect(mapPaymasterReason("something_new")).toBe("PAYMASTER_DENIED");
    expect(mapPaymasterReason("constructor")).toBe("PAYMASTER_DENIED");
    expect(mapPaymasterReason(undefined)).toBe("PAYMASTER_DENIED");
  });

  it("builds PepuPaymasterError with reason details and retryable for transient reasons", () => {
    const e = paymasterReasonToError("project_not_claimed_onchain", "claim it");
    expect(e).toBeInstanceOf(PepuPaymasterError);
    expect(e.code).toBe("PAYMASTER_PROJECT_NOT_CLAIMED");
    expect(e.message).toContain("project_not_claimed_onchain");
    expect(e.retryable).toBe(false);
    expect(paymasterReasonToError("rate_limited").retryable).toBe(true);
    expect(paymasterReasonToError("chain_read_failed").retryable).toBe(true);
  });

  it("explainError recognises the new reasons from raw text", () => {
    expect(explainError("denied: project_owner_changed").code).toBe("PAYMASTER_PROJECT_OWNER_CHANGED");
    expect(explainError("project_not_claimed_onchain").code).toBe("PAYMASTER_PROJECT_NOT_CLAIMED");
    expect(explainError("project_balance_exhausted").code).toBe("PAYMASTER_NO_BALANCE");
    expect(explainError("project_daily_limit_reached").code).toBe("PAYMASTER_CAP");
    expect(explainError("free_tier_count_exceeded").code).toBe("PAYMASTER_CAP");
  });

  it("decodes the contract's custom errors", () => {
    const data = encodeErrorResult({
      abi: pepuSponsoredPaymasterV2Abi,
      errorName: "ProjectNotClaimed",
      args: [`0x${"11".repeat(32)}`],
    });
    expect(decodePaymasterRevert(data)?.errorName).toBe("ProjectNotClaimed");
    expect(decodePaymasterRevert("0xdeadbeef")).toBeNull();
  });
});
