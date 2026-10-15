import { describe, expect, it } from "vitest";

import { describeUserOpFailure } from "../src/aa/describe.js";
import { PepuPaymasterError } from "../src/errors.js";

/**
 * Live failure 2026-10-15: a paymaster denial reached the user as viem's generic
 * "Missing or invalid parameters." (JSON-RPC -32000 is mapped to InvalidInputRpcError), hiding the real reason.
 * This reproduces the exact error shape viem throws.
 */
function viemRpcDenial(reason: string, message: string, detail?: unknown): Error {
  return Object.assign(new Error(`Missing or invalid parameters.\n\nDouble check you have provided the correct parameters.\n\nDetails: Sponsorship denied: ${message}\nVersion: viem@2.56.8`), {
    name: "InvalidInputRpcError",
    shortMessage: "Missing or invalid parameters.",
    details: `Sponsorship denied: ${message}`,
    code: -32000,
    data: { reason, detail },
  });
}

describe("describeUserOpFailure: precise paymaster denials", () => {
  it("names the real reason instead of viem's generic message (sender_not_owned_by_token_user)", () => {
    const e = describeUserOpFailure(
      Object.assign(new Error("UserOperationExecutionError"), {
        cause: viemRpcDenial("sender_not_owned_by_token_user", "userOp.sender is not an account of the authenticated Privy user."),
      }),
    );
    expect(e).toBeInstanceOf(PepuPaymasterError);
    expect(e.code).toBe("PAYMASTER_DENIED");
    expect(e.message).toContain("sender_not_owned_by_token_user");
    expect(e.message).toContain("not an account of the authenticated Privy user");
    expect(e.message).not.toMatch(/^Missing or invalid parameters/);
    expect(e.hint).toMatch(/embedded wallet|signed-in user/i);
  });

  it("maps each reason to its own catalog code, not a generic denial", () => {
    const cases: [string, string][] = [
      ["project_balance_exhausted", "PAYMASTER_NO_BALANCE"],
      ["free_tier_user_hourly_exceeded", "PAYMASTER_CAP"],
      ["free_pool_empty", "PAYMASTER_FREE_TIER_UNAVAILABLE"],
      ["invalid_or_expired_token", "AUTH_INVALID_TOKEN"],
      ["free_tier_identity_required", "PAYMASTER_IDENTITY_REQUIRED"],
    ];
    for (const [reason, code] of cases) {
      const e = describeUserOpFailure(viemRpcDenial(reason, `Project tier: x. Free tier: y.`));
      expect(e.code).toBe(code);
      expect(e.message).toContain(reason);
    }
  });

  it("uses the per-tier reasons when both tiers refused", () => {
    const e = describeUserOpFailure(
      viemRpcDenial("project_balance_exhausted", "Project tier: balance too low. Free tier: this account is over its hourly allowance.", {
        project: "project_balance_exhausted",
        free: "free_tier_user_hourly_exceeded",
      }),
    );
    expect(e.message).toContain("Free tier: this account is over its hourly allowance");
  });

  it("still redacts credentials", () => {
    const e = describeUserOpFailure(viemRpcDenial("rate_limited", "slow down Bearer abc.def.ghi privyAccessToken=eyJabcdefgh.ijklmnop.qrstuvwx"));
    expect(e.message).not.toContain("eyJabcdefgh");
    expect(e.message).not.toContain("abc.def.ghi");
  });

  it("an unrelated failure is not rewritten", () => {
    expect(describeUserOpFailure(new Error("weird")).code).toBe("UNKNOWN");
  });
});
