/**
 * Orchestrates Part 2's ordered enforcement pipeline: this is the one place
 * that decides whether to sign. Every early-return here is a denial that
 * must ALSO write an audit-log row (Part 2 step 9 — "every decision, allowed
 * or denied, and why").
 */
import type { Address, Hex, LocalAccount } from "viem";
import { buildPaymasterData, buildPaymasterHashPrefix, computeValidityWindow } from "./paymasterData.js";
import { computeFinalHash, computeUserOpHash, signFinalHash } from "./userOpHash.js";
import { decodeKernelExecuteCallData } from "./kernelDecoder.js";
import { computeWorstCaseCostWei } from "./cost.js";
import type { AuthChecker } from "./privyAuth.js";
import type { AppRegistry } from "./appRegistry.js";
import type { Allowlist } from "./allowlist.js";
import type { CapLimits, PolicyDb } from "./db.js";
import type { DenialReason, SponsorResponse, SponsorUserOperationInput } from "./types.js";
import { numberToHex } from "viem";

export interface PolicyEngineDeps {
  db: PolicyDb;
  auth: AuthChecker;
  apps: AppRegistry;
  allowlist: Allowlist;
  signerAccount: LocalAccount;
  chainId: number;
  paymasterAddress: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validityWindowSeconds: number;
  /** Per-user caps + global circuit breaker ceiling (app caps come from the resolved app). */
  userAndGlobalCaps: Omit<CapLimits, "appDailySpendCapWei" | "appLifetimeSpendCapWei">;
  now?: () => number;
}

function denyResponse(reason: DenialReason, message: string): SponsorResponse {
  return { status: "denied", reason, message };
}

export class PolicyEngine {
  constructor(private readonly deps: PolicyEngineDeps) {}

  async evaluate(
    accessToken: string | null,
    apiKey: string | null,
    userOp: SponsorUserOperationInput,
  ): Promise<SponsorResponse> {
    const nowMs = (this.deps.now ?? Date.now)();

    if (!accessToken) {
      this.deps.db.appendDenialAudit({
        nowMs,
        reason: "invalid_or_expired_token",
        userId: null,
        appId: null,
        sender: userOp.sender,
        targets: [],
      });
      return denyResponse("invalid_or_expired_token", "Missing or empty Authorization bearer token.");
    }

    // Step 1 + 2: Privy token verification, then sender-ownership check.
    // These MUST happen in this order and neither may be skipped — the
    // ownership check is what stops a stolen/valid token from sponsoring
    // gas toward an attacker-controlled sender.
    const authResult = await this.deps.auth.authenticate(accessToken, userOp.sender);
    if (!authResult.ok) {
      this.deps.db.appendDenialAudit({
        nowMs,
        reason: authResult.reason,
        userId: null,
        appId: null,
        sender: userOp.sender,
        targets: [],
      });
      return denyResponse(
        authResult.reason,
        authResult.reason === "invalid_or_expired_token"
          ? "The Privy access token is missing, expired, or does not verify."
          : "userOp.sender is not a smart wallet owned by the authenticated Privy user.",
      );
    }
    const userId = authResult.userId;

    // Step 3: resolve the requesting app from a verified API key hash.
    const app = apiKey ? this.deps.apps.resolveByApiKey(apiKey) : null;
    if (!app) {
      this.deps.db.appendDenialAudit({
        nowMs,
        reason: "unknown_or_invalid_app_credential",
        userId,
        appId: null,
        sender: userOp.sender,
        targets: [],
      });
      return denyResponse(
        "unknown_or_invalid_app_credential",
        "Missing or unrecognized X-Api-Key.",
      );
    }

    // Step 4: decode callData, extract destinations, check both allowlists.
    const decoded = decodeKernelExecuteCallData(userOp.callData);
    if (!decoded.ok) {
      this.deps.db.appendDenialAudit({
        nowMs,
        reason: "calldata_decode_failed",
        userId,
        appId: app.id,
        sender: userOp.sender,
        targets: [],
      });
      return denyResponse(
        "calldata_decode_failed",
        `Refusing to sponsor: ${decoded.reason} (${decoded.detail}).`,
      );
    }
    for (const target of decoded.targets) {
      if (!this.deps.allowlist.isGloballyAllowed(target)) {
        this.deps.db.appendDenialAudit({
          nowMs,
          reason: "destination_not_globally_allowed",
          userId,
          appId: app.id,
          sender: userOp.sender,
          targets: decoded.targets,
        });
        return denyResponse(
          "destination_not_globally_allowed",
          `Destination ${target} is not on the global allowlist.`,
        );
      }
      if (!this.deps.allowlist.isAllowedForApp(app, target)) {
        this.deps.db.appendDenialAudit({
          nowMs,
          reason: "destination_not_allowed_for_app",
          userId,
          appId: app.id,
          sender: userOp.sender,
          targets: decoded.targets,
        });
        return denyResponse(
          "destination_not_allowed_for_app",
          `Destination ${target} is globally allowed but not allowed for app "${app.id}".`,
        );
      }
    }

    // Compute the worst-case cost, validity window, and both hashes BEFORE
    // touching caps/counters — all pure/synchronous, so the cap-check-and-
    // record step below (step 5-9) can happen atomically with no `await` in
    // between reading counters and writing the new event.
    const worstCaseCostWei = computeWorstCaseCostWei({
      verificationGasLimit: userOp.verificationGasLimit,
      callGasLimit: userOp.callGasLimit,
      preVerificationGas: userOp.preVerificationGas,
      paymasterVerificationGasLimit: this.deps.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: this.deps.paymasterPostOpGasLimit,
      maxFeePerGas: userOp.maxFeePerGas,
    });
    const window = computeValidityWindow(this.deps.validityWindowSeconds, Math.floor(nowMs / 1000));
    const paymasterHashPrefix = buildPaymasterHashPrefix(
      {
        paymaster: this.deps.paymasterAddress,
        paymasterVerificationGasLimit: this.deps.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: this.deps.paymasterPostOpGasLimit,
      },
      window,
    );
    const userOpHash = computeUserOpHash(userOp, paymasterHashPrefix);
    const finalHash = computeFinalHash(userOpHash, this.deps.chainId);

    // Steps 5-9: caps, in order, atomically recorded on success. This is a
    // single synchronous call into PolicyDb — see db.ts's doc comment for
    // why that's what makes it race-free within this process.
    const capsResult = this.deps.db.recordApprovalIfWithinCaps({
      nowMs,
      userId,
      appId: app.id,
      sender: userOp.sender,
      targets: decoded.targets,
      worstCaseCostWei,
      userOpHash,
      finalHash,
      validUntil: window.validUntil,
      validAfter: window.validAfter,
      limits: {
        ...this.deps.userAndGlobalCaps,
        appDailySpendCapWei: app.dailySpendCapWei,
        appLifetimeSpendCapWei: app.lifetimeSpendCapWei,
      },
    });
    if (!capsResult.ok) {
      return denyResponse(capsResult.reason, capsResult.message);
    }

    // Step 8 (sign): only real I/O-shaped step, but a local-account ECDSA
    // sign has no external dependency (no network) — the audit/counter
    // write above already happened, so this can't create a race with it.
    const signature = await signFinalHash(this.deps.signerAccount, finalHash);
    const paymasterData = buildPaymasterData(window, signature);

    return {
      status: "approved",
      chainId: this.deps.chainId,
      paymaster: this.deps.paymasterAddress,
      paymasterVerificationGasLimit: numberToHex(this.deps.paymasterVerificationGasLimit) as Hex,
      paymasterPostOpGasLimit: numberToHex(this.deps.paymasterPostOpGasLimit) as Hex,
      paymasterData,
      validUntil: window.validUntil,
      validAfter: window.validAfter,
      userOpHash,
    };
  }
}
