/**
 * Referenced directly by src/privyAuth.ts's own module doc comment ("so
 * tests can supply fakes without any network access or real Privy
 * credentials -- see test/privyAuth.test.ts"). Exercises `createAuthChecker`
 * with injected fakes for both Privy calls -- no real PRIVY_APP_ID/SECRET,
 * no network access, matching exactly what that doc comment promises.
 */
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { createAuthChecker } from "../src/privyAuth.js";

const SENDER = "0x0000000000000000000000000000000000000001" as Address;

describe("createAuthChecker", () => {
  it("authenticate() succeeds when the token verifies and the sender is owned by that user", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "user-1" });
    const getUserBySmartWalletAddress = vi.fn().mockResolvedValue({ id: "user-1" });
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("good-token", SENDER);

    expect(result).toEqual({ ok: true, userId: "user-1" });
    expect(verifyAccessToken).toHaveBeenCalledWith("good-token");
    expect(getUserBySmartWalletAddress).toHaveBeenCalledWith(SENDER);
  });

  it("authenticate() fails with invalid_or_expired_token when token verification rejects", async () => {
    const verifyAccessToken = vi.fn().mockRejectedValue(new Error("bad jwt"));
    const getUserBySmartWalletAddress = vi.fn();
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("bad-token", SENDER);

    expect(result).toEqual({ ok: false, reason: "invalid_or_expired_token" });
    // Step ordering matters: ownership must never even be attempted if the
    // token itself didn't verify.
    expect(getUserBySmartWalletAddress).not.toHaveBeenCalled();
  });

  it("authenticate() fails with invalid_or_expired_token when the token has no user_id", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "" });
    const getUserBySmartWalletAddress = vi.fn();
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("weird-token", SENDER);

    expect(result).toEqual({ ok: false, reason: "invalid_or_expired_token" });
    expect(getUserBySmartWalletAddress).not.toHaveBeenCalled();
  });

  it("authenticate() fails with sender_not_owned_by_token_user when no smart wallet matches", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "user-1" });
    const getUserBySmartWalletAddress = vi.fn().mockResolvedValue(null);
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("good-token", SENDER);

    expect(result).toEqual({ ok: false, reason: "sender_not_owned_by_token_user" });
  });

  it("authenticate() fails with sender_not_owned_by_token_user when the wallet belongs to a DIFFERENT user", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "user-1" });
    const getUserBySmartWalletAddress = vi.fn().mockResolvedValue({ id: "some-other-user" });
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("good-token", SENDER);

    expect(result).toEqual({ ok: false, reason: "sender_not_owned_by_token_user" });
  });

  it("fails closed (never throws, never treats a rejection as ownership) when getUserBySmartWalletAddress rejects for ANY reason", async () => {
    // Per privyAuth.ts's doc comment: the real @privy-io/node SDK REJECTS
    // (does not resolve null) on a 404 no-match, and this module must treat
    // every rejection the same way -- deny, not crash, not "assume owned".
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "user-1" });
    const getUserBySmartWalletAddress = vi.fn().mockRejectedValue(new Error("NotFoundError: no such user"));
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const result = await auth.authenticate("good-token", SENDER);

    expect(result).toEqual({ ok: false, reason: "sender_not_owned_by_token_user" });
  });

  it("verifyToken() and verifySenderOwnership() are independently usable (not just via authenticate())", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ user_id: "user-1" });
    const getUserBySmartWalletAddress = vi.fn().mockResolvedValue({ id: "user-1" });
    const auth = createAuthChecker({ verifyAccessToken, getUserBySmartWalletAddress });

    const tokenResult = await auth.verifyToken("good-token");
    expect(tokenResult).toEqual({ ok: true, userId: "user-1" });

    const owned = await auth.verifySenderOwnership("user-1", SENDER);
    expect(owned).toBe(true);
  });
});
