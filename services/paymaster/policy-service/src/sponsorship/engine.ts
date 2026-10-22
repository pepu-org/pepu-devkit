/**
 * The v2 decision engine: decides WHETHER to sign and WHICH SPONSOR the signature commits to.
 * Spec: SPONSORSHIP-SPEC.md sections 1, 6 and 7. Draw order is PROJECT FIRST, then the FREE TIER, per operation and
 * atomically (an op is never split across sponsors).
 *
 * Pipeline: credential (client token or server key) -> project; decode Kernel callData; worst-case cost; identity;
 * try project (origin gate for client tokens, on-chain allowlist + per-sender + project limits); try free (verified
 * Privy account ONLY, never anonymous); sign.
 * Everything that reads the chain fails CLOSED (a read error is a denial, never an approval). Every decision, approve
 * or deny, is written to `audit_log_v2`.
 *
 * Why this is not `PolicyEngine`: v1's engine books worst-case cost forever against caps keyed on a Privy user id or
 * sender address. v2 keys the free tier on a verified Privy account (never a bare sender), selects a sponsor,
 * commits the sponsor id in the signature, and reconciles to actual cost on-chain (see reconciler.ts). v1's engine
 * and routes are untouched.
 */
import { numberToHex, type Address, type Hex, type LocalAccount } from "viem";
import { decodeKernelExecuteCallData } from "../kernelDecoder.js";
import { computeWorstCaseCostWei } from "../cost.js";
import { computeValidityWindow } from "../paymasterData.js";
import { computeFinalHash, computeUserOpHash, signFinalHash } from "../userOpHash.js";
import type { SponsorUserOperationInput } from "../types.js";
import type { ChainReader } from "./chain.js";
import type { SponsorshipConfig } from "./config.js";
import type { ApprovalLimits, OutstandingExclude, SponsorshipDb } from "./db.js";
import type { IdentityService } from "./identity.js";
import {
  FREE_POOL_ID,
  buildSponsoredHashPrefix,
  buildSponsoredPaymasterData,
  computeEntryPointUserOpHash,
} from "./paymasterData.js";
import type {
  CredentialKind,
  ProjectRecord,
  ResolvedIdentity,
  SponsorKind,
  SponsorshipDenialReason,
  SponsorshipResponse,
} from "./types.js";

export interface SponsorshipEngineDeps {
  db: SponsorshipDb;
  chain: ChainReader;
  identity: IdentityService;
  signerAccount: LocalAccount;
  config: Pick<
    SponsorshipConfig,
    | "chainId"
    | "paymasterAddress"
    | "entryPointAddress"
    | "paymasterVerificationGasLimit"
    | "paymasterPostOpGasLimit"
    | "validityWindowSeconds"
    | "allowAccountDeployment"
    | "freeTier"
    | "gasBounds"
    | "reservations"
  >;
  /** Per-IP limiter for evaluations made with a CLIENT token (the public credential). Absent = no limit (tests). */
  clientRateLimiter?: { check(key: string): { ok: boolean; retryAfterSeconds: number } };
  now?: () => number;
}

/**
 * The signed window starts this many seconds BEFORE the signing instant, so a chain whose block timestamp lags the
 * service clock (sequencer lag) does not reject a freshly approved op with AA32 (audit I-5). The contract buckets its
 * daily counters by the signed `validAfter` and releases refunds from the bucket a reservation really landed in, so a
 * window straddling UTC midnight is safe.
 */
export const VALID_AFTER_SKEW_SECONDS = 5;

export interface EvaluateInput {
  /** Raw credential: the project's publishable client token or its secret server key. */
  appToken: string | null;
  /** The request's `Origin` header, if any. Used to bind client tokens to the project's allowed origins. */
  origin?: string | null;
  /** Caller IP as seen by the API (trusted-proxy aware). Scopes the client-token rate limit and reservation caps. */
  clientIp?: string | null;
  /** Verified Privy access token, if the caller has one (REST bearer or ERC-7677 context). */
  privyToken: string | null;
  userOp: SponsorUserOperationInput;
}

type TierResult = { ok: true; finalHash: Hex } | { ok: false; reason: SponsorshipDenialReason; message: string };

interface AttemptContext {
  project: ProjectRecord;
  credential: CredentialKind;
  origin: string | null;
  clientIp: string | null;
  identity: ResolvedIdentity;
  userOp: SponsorUserOperationInput;
  /** This op's own (sender, nonce): a re-request replaces its earlier unexecuted approval instead of stacking. */
  exclude: OutstandingExclude;
  targets: Address[];
  maxCost: bigint;
  nowMs: number;
  window: { validUntil: number; validAfter: number };
}

export class SponsorshipEngine {
  /**
   * Denials for a missing or unknown credential are NOT written to `audit_log_v2` (review 3, M-3: anyone can send
   * junk credentials, and a synchronous SQLite insert per request is an unauthenticated write amplifier). They are
   * counted here instead; `GET /v2/admin/overview` reports the counter.
   */
  private unknownCredentialDenials = 0;
  private lastUnknownCredentialAtMs: number | null = null;

  constructor(private readonly deps: SponsorshipEngineDeps) {}

  /** In-memory counters (reset on restart). */
  stats(): { unknownCredentialDenials: number; lastUnknownCredentialAt: string | null } {
    return {
      unknownCredentialDenials: this.unknownCredentialDenials,
      lastUnknownCredentialAt: this.lastUnknownCredentialAtMs === null ? null : new Date(this.lastUnknownCredentialAtMs).toISOString(),
    };
  }

  private get nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private audit(
    decision: "approved" | "denied",
    reason: string,
    p: {
      project?: ProjectRecord | null;
      sponsor?: string | null;
      identity?: ResolvedIdentity | null;
      sender: Address;
      targets?: readonly Address[];
      maxCost?: bigint;
      epHash?: Hex | null;
      detail?: string | null;
    },
    nowMs: number,
  ): void {
    this.deps.db.appendAudit({
      tsMs: nowMs,
      decision,
      reason,
      projectKey: p.project?.key ?? null,
      sponsor: p.sponsor ?? null,
      identityKey: p.identity?.key ?? null,
      sender: p.sender,
      targets: p.targets ?? [],
      maxCostWei: p.maxCost === undefined ? null : p.maxCost.toString(),
      epHash: p.epHash ?? null,
      detail: p.detail ?? null,
    });
  }

  async evaluate(input: EvaluateInput): Promise<SponsorshipResponse> {
    const { userOp } = input;
    const nowMs = this.nowMs;
    const deny = (
      reason: SponsorshipDenialReason,
      message: string,
      extra: { project?: ProjectRecord | null; identity?: ResolvedIdentity | null; targets?: readonly Address[]; maxCost?: bigint; detail?: SponsorshipResponseDetail } = {},
    ): SponsorshipResponse => {
      this.audit("denied", reason, { ...extra, sender: userOp.sender, detail: extra.detail ? JSON.stringify(extra.detail) : message }, nowMs);
      return { status: "denied", reason, message, ...(extra.detail ? { detail: extra.detail } : {}) };
    };

    // 1. credential (publishable client token or secret server key) -> project
    const cred = input.appToken ? this.deps.db.resolveCredential(input.appToken) : null;
    if (!cred) {
      this.unknownCredentialDenials++;
      this.lastUnknownCredentialAtMs = nowMs;
      return { status: "denied", reason: "unknown_or_invalid_app_credential", message: "Missing or unrecognized app credential." };
    }
    const project = cred.project;
    if (project.status !== "active") return deny("app_suspended", "This app is suspended.", { project });

    // 1-bis. new-account deployment can be switched off for the whole service. This is enforced HERE (not only on the
    // ERC-7677 route) so POST /v2/sponsor cannot bypass it (review 3, L-5).
    if (!this.deps.config.allowAccountDeployment && (userOp.factory || userOp.factoryData)) {
      return deny("account_deployment_disabled", "Sponsorship of new-account deployment is disabled on this service.", { project });
    }

    // 1a. the credentials belong to the project's owner AT ISSUANCE. If the on-chain owner changed (re-claim, transfer),
    // revoke them now (delta review L4). The chain read is the engine's normal cached one (short TTL), so a change takes
    // effect within the cache TTL. A read failure fails closed.
    if (project.projectId && project.owner) {
      let current;
      try {
        current = await this.deps.chain.getSponsor(project.projectId);
      } catch {
        return deny("chain_read_failed", "could not read the project's on-chain owner", { project });
      }
      if (current.owner.toLowerCase() !== project.owner.toLowerCase()) {
        if (current.owner !== "0x0000000000000000000000000000000000000000") {
          this.deps.db.revokeCredentialsForOwnerChange(project.key, current.owner, nowMs);
        }
        return deny("project_owner_changed", "This project's on-chain owner changed. Its credentials were revoked; the new owner must fetch new ones (POST /v2/projects/:id/token/rotate and /server-key/rotate).", { project });
      }
    }

    // 1b. the CLIENT token is public: rate-limit it per IP before doing any work (audit M-1)
    if (cred.kind === "client" && this.deps.clientRateLimiter) {
      const rl = this.deps.clientRateLimiter.check(`client:${input.clientIp ?? "unknown"}`);
      if (!rl.ok) return deny("rate_limited", `Too many sponsorship requests from this address; retry in ${rl.retryAfterSeconds}s.`, { project });
    }

    // 2. decode callData -> targets
    const decoded = decodeKernelExecuteCallData(userOp.callData);
    if (!decoded.ok) {
      return deny("calldata_decode_failed", `Refusing to sponsor: ${decoded.reason} (${decoded.detail}).`, { project });
    }
    const targets = decoded.targets;

    // 2b. the signer never approves arbitrary user-supplied gas fields (audit L-4)
    const bounds = await this.checkGasBounds(userOp);
    if (!bounds.ok) return deny(bounds.reason, bounds.message, { project, targets });

    // 3. worst-case cost, exactly as EntryPoint computes the prefund
    const cfg = this.deps.config;
    const maxCost = computeWorstCaseCostWei({
      verificationGasLimit: userOp.verificationGasLimit,
      callGasLimit: userOp.callGasLimit,
      preVerificationGas: userOp.preVerificationGas,
      paymasterVerificationGasLimit: cfg.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: cfg.paymasterPostOpGasLimit,
      maxFeePerGas: userOp.maxFeePerGas,
    });

    // 4. identity
    const resolved = await this.deps.identity.resolve({ appId: project.appId, privyToken: input.privyToken, sender: userOp.sender });
    if (!resolved.ok) {
      return deny(
        resolved.reason,
        resolved.reason === "invalid_or_expired_token"
          ? "The Privy access token is expired or does not verify."
          : "userOp.sender is not an account of the authenticated Privy user: it is neither the Kernel v3.1 account of one of the user's embedded wallets nor a Privy smart wallet they own, or ownership could not be verified right now.",
        { project, targets, maxCost },
      );
    }
    const identity: ResolvedIdentity = resolved.identity;

    const rawWindow = computeValidityWindow(cfg.validityWindowSeconds, Math.floor(nowMs / 1000));
    const window = { validUntil: rawWindow.validUntil, validAfter: Math.max(0, rawWindow.validAfter - VALID_AFTER_SKEW_SECONDS) };
    const ctx: AttemptContext = {
      project,
      credential: cred.kind,
      origin: input.origin ?? null,
      clientIp: input.clientIp ?? null,
      identity,
      userOp,
      exclude: { sender: userOp.sender, nonce: userOp.nonce },
      targets,
      maxCost,
      nowMs,
      window,
    };

    // 5. project first, then free tier
    const detail: SponsorshipResponseDetail = {};
    let sponsorKind: SponsorKind | null = null;
    let sponsorId: Hex = FREE_POOL_ID;
    let approvedHash: Hex | null = null;
    let projectMessage: string | undefined;

    if (project.projectId) {
      const r = await this.tryProject(ctx);
      if (r.ok) {
        sponsorKind = "project";
        sponsorId = project.projectId;
        approvedHash = r.finalHash;
      } else {
        detail.project = r.reason;
        projectMessage = r.message;
      }
    } else {
      detail.project = "project_not_claimed_onchain";
    }

    let freeFailure: TierResult | null = null;
    if (sponsorKind === null) {
      const r = await this.tryFree(ctx);
      if (r.ok) {
        sponsorKind = "free";
        sponsorId = FREE_POOL_ID;
        approvedHash = r.finalHash;
      } else {
        freeFailure = r;
        detail.free = r.reason;
      }
    }

    if (sponsorKind === null || approvedHash === null) {
      const primary = project.projectId && detail.project ? detail.project : (detail.free as SponsorshipDenialReason);
      const projectMsg = projectMessage;
      const message = project.projectId
        ? `Project tier: ${projectMsg ?? detail.project}. Free tier: ${freeFailure && !freeFailure.ok ? freeFailure.message : "n/a"}.`
        : (freeFailure && !freeFailure.ok ? freeFailure.message : "Not sponsorable.");
      return deny(primary, message, { project, identity, targets, maxCost, detail });
    }

    // 6. sign, committing to the chosen sponsor
    return this.approve(ctx, sponsorKind, sponsorId, approvedHash);
  }

  /**
   * Project tier. A project may sponsor ANY wallet (Privy or not, smart accounts over native/EOA wallets), so the
   * authorization is NOT about who the user is; it is about who may ASK the project to pay:
   *   - SERVER key (secret, used from the project's backend): always accepted.
   *   - CLIENT token (publishable, visible in the browser): accepted only from the project's allowed ORIGINS.
   * Then the on-chain limits the contract re-enforces regardless of this service: the project's destination allowlist,
   * its per-sender daily limit and its daily limit and balance. Finally the off-chain per-user cap.
   */
  private async tryProject(ctx: AttemptContext): Promise<TierResult> {
    const { project, identity, maxCost, nowMs } = ctx;
    const projectId = project.projectId as Hex;
    if (ctx.credential === "client") {
      const origin = normalizeOrigin(ctx.origin);
      if (!origin || !project.allowedOrigins.includes(origin)) {
        return {
          ok: false,
          reason: "project_origin_not_allowed",
          message: project.allowedOrigins.length === 0
            ? "this project has no allowed origins: its budget can only be used with the project's server API key"
            : `origin ${origin ?? "(none)"} is not one of the project's allowed origins`,
        };
      }
    }
    if (project.requireIdentity && identity.kind !== "privy") {
      return { ok: false, reason: "project_identity_required", message: "this project only sponsors users with a verified Privy identity" };
    }
    let sponsor;
    let disallowed: Address | null;
    let senderSpend: { day: number; spent: bigint } | null = null;
    try {
      [sponsor, disallowed] = await Promise.all([this.deps.chain.getSponsor(projectId), this.deps.chain.firstDisallowedTarget(projectId, ctx.targets)]);
      if (sponsor.senderDailyLimit > 0n) senderSpend = await this.deps.chain.getSenderSpend(projectId, ctx.userOp.sender);
    } catch {
      return { ok: false, reason: "chain_read_failed", message: "could not read the project's on-chain state" };
    }
    if (sponsor.owner === "0x0000000000000000000000000000000000000000") {
      return { ok: false, reason: "project_not_claimed_onchain", message: "the project has not been claimed on-chain" };
    }
    if (sponsor.paused) return { ok: false, reason: "project_paused", message: "the project is paused by its owner" };
    if (sponsor.senderDailyLimit === 0n) {
      // The contract fails closed for a project with no per-wallet limit (review 3, L-1): mirror it.
      return { ok: false, reason: "project_sender_limit_not_set", message: "the project has no per-wallet daily limit on-chain; its owner must call setSenderDailyLimit (the contract rejects every op until then)" };
    }
    if (disallowed) {
      return { ok: false, reason: "target_not_allowed_onchain", message: `destination ${disallowed} is not on the project's on-chain allowlist` };
    }
    if (ctx.userOp.maxFeePerGas > sponsor.maxFeePerGasCap) {
      return { ok: false, reason: "fee_above_onchain_cap", message: `maxFeePerGas ${ctx.userOp.maxFeePerGas} exceeds the project's on-chain cap ${sponsor.maxFeePerGasCap}` };
    }
    const outstanding = this.deps.db.outstandingReservedWei(projectId, nowMs, ctx.exclude);
    const spendable = sponsor.balance > outstanding ? sponsor.balance - outstanding : 0n;
    if (spendable < maxCost) {
      return { ok: false, reason: "project_balance_exhausted", message: `project balance ${sponsor.balance} (outstanding approvals ${outstanding}) cannot cover the op's max cost ${maxCost}` };
    }
    const today = Math.floor(ctx.window.validAfter / 86_400);
    const spentToday = sponsor.spentDay < today ? 0n : sponsor.spentToday;
    const room = sponsor.dailyLimit > spentToday + outstanding ? sponsor.dailyLimit - spentToday - outstanding : 0n;
    if (room < maxCost) {
      return { ok: false, reason: "project_daily_limit_reached", message: `project daily limit ${sponsor.dailyLimit} leaves ${room}, op needs ${maxCost}` };
    }
    if (senderSpend && sponsor.senderDailyLimit > 0n) {
      const used = (senderSpend.day < today ? 0n : senderSpend.spent) + this.deps.db.outstandingReservedForSenderWei(projectId, ctx.userOp.sender, nowMs, ctx.exclude);
      if (used + maxCost > sponsor.senderDailyLimit) {
        return { ok: false, reason: "project_sender_limit_reached", message: `wallet ${ctx.userOp.sender} has used ${used} of the project's ${sponsor.senderDailyLimit} per-wallet daily limit; op needs ${maxCost}` };
      }
    }
    if (ctx.credential === "client") {
      const capped = this.checkReservationCaps(ctx, projectId, sponsor.balance < sponsor.dailyLimit ? sponsor.balance : sponsor.dailyLimit);
      if (capped) return capped;
    }
    return this.recordAttempt(ctx, "project", projectId, { kind: "project", perUserDailyCapWei: project.perUserDailyCapWei });
  }

  /**
   * Free tier: ONLY users with a verified Privy account (no anonymous tier). Identity gate first, then on-chain pool
   * checks (enabled, per-op cap, allowlist, balance, per-sender limit), then the atomic off-chain per-user caps +
   * record. There is deliberately NO chain-wide daily ceiling.
   */
  private async tryFree(ctx: AttemptContext): Promise<TierResult> {
    const { project, identity, maxCost, nowMs } = ctx;
    const free = this.deps.config.freeTier;
    if (!free.enabled) return { ok: false, reason: "free_tier_disabled", message: "the free tier is disabled" };
    if (identity.kind !== "privy") {
      return {
        ok: false,
        reason: "free_tier_identity_required",
        message: "the free tier is only for users with a Privy account: send a verified Privy access token",
      };
    }
    if (project.allowedDestinations) {
      const allowed = new Set(project.allowedDestinations.map((a) => a.toLowerCase()));
      const bad = ctx.targets.find((t) => !allowed.has(t.toLowerCase()));
      if (bad) return { ok: false, reason: "destination_not_allowed_for_app", message: `destination ${bad} is not allowed for app "${project.appId}"` };
    }
    let sponsor;
    let cfg;
    let disallowed: Address | null;
    let senderSpend: { day: number; spent: bigint } | null = null;
    try {
      [sponsor, cfg, disallowed] = await Promise.all([
        this.deps.chain.getSponsor(FREE_POOL_ID),
        this.deps.chain.getFreeConfig(),
        this.deps.chain.firstDisallowedTarget(FREE_POOL_ID, ctx.targets),
      ]);
      if (cfg.senderDailyLimit > 0n) senderSpend = await this.deps.chain.getSenderSpend(FREE_POOL_ID, ctx.userOp.sender);
    } catch {
      return { ok: false, reason: "chain_read_failed", message: "could not read the free pool's on-chain state" };
    }
    if (!cfg.enabled) return { ok: false, reason: "free_tier_disabled", message: "the free tier is switched off on-chain" };
    if (maxCost > cfg.maxOpCost) return { ok: false, reason: "free_pool_op_too_large", message: `op max cost ${maxCost} exceeds the free pool's per-op limit ${cfg.maxOpCost}` };
    if (disallowed) return { ok: false, reason: "target_not_allowed_onchain", message: `destination ${disallowed} is not on the free tier's on-chain allowlist` };
    if (ctx.userOp.maxFeePerGas > sponsor.maxFeePerGasCap) {
      return { ok: false, reason: "fee_above_onchain_cap", message: `maxFeePerGas ${ctx.userOp.maxFeePerGas} exceeds the free pool's on-chain cap ${sponsor.maxFeePerGasCap}` };
    }
    const outstanding = this.deps.db.outstandingReservedWei(FREE_POOL_ID, nowMs, ctx.exclude);
    const spendable = sponsor.balance > outstanding ? sponsor.balance - outstanding : 0n;
    if (spendable < maxCost) return { ok: false, reason: "free_pool_empty", message: `free pool balance ${sponsor.balance} (outstanding ${outstanding}) cannot cover max cost ${maxCost}` };
    if (senderSpend && cfg.senderDailyLimit > 0n) {
      const today = Math.floor(ctx.window.validAfter / 86_400);
      const used = (senderSpend.day < today ? 0n : senderSpend.spent) + this.deps.db.outstandingReservedForSenderWei(FREE_POOL_ID, ctx.userOp.sender, nowMs, ctx.exclude);
      if (used + maxCost > cfg.senderDailyLimit) {
        return { ok: false, reason: "free_tier_sender_limit_reached", message: `wallet ${ctx.userOp.sender} has used ${used} of the free pool's ${cfg.senderDailyLimit} per-wallet daily limit; op needs ${maxCost}` };
      }
    }

    return this.recordAttempt(ctx, "free", FREE_POOL_ID, {
      kind: "free",
      perUserDailyWei: free.perUserDailyWei,
      perUserHourlyWei: free.perUserHourlyWei,
      perUserDailyCount: free.perUserDailyCount,
      perUserHourlyCount: free.perUserHourlyCount,
    });
  }

  /** Builds the signed prefix + hash for a sponsor and runs the atomic cap check + insert. */
  private recordAttempt(ctx: AttemptContext, kind: SponsorKind, sponsorId: Hex, limits: ApprovalLimits): TierResult {
    const cfg = this.deps.config;
    const prefix = buildSponsoredHashPrefix(
      { paymaster: cfg.paymasterAddress, paymasterVerificationGasLimit: cfg.paymasterVerificationGasLimit, paymasterPostOpGasLimit: cfg.paymasterPostOpGasLimit },
      ctx.window,
      sponsorId,
    );
    const finalHash = computeFinalHash(computeUserOpHash(ctx.userOp, prefix), cfg.chainId);
    const r = this.deps.db.recordApproval({
      nowMs: ctx.nowMs,
      sponsorKind: kind,
      sponsorId,
      projectKey: ctx.project.key,
      identity: ctx.identity,
      sender: ctx.userOp.sender,
      reservedWei: ctx.maxCost,
      validUntil: ctx.window.validUntil,
      pmHash: finalHash,
      limits,
      credential: ctx.credential,
      clientIp: ctx.clientIp,
      nonce: ctx.userOp.nonce,
    });
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message };
    return { ok: true, finalHash };
  }

  /**
   * Audit M-1. Approvals that are never executed still reserve budget off-chain until they expire, so a holder of the
   * PUBLIC client token could otherwise reserve a project's whole balance and daily limit with fake senders and lock
   * honest users out. Client-token reservations are therefore bounded per sender (count), per IP and in total, each as a
   * small share of the project's budget (but never below `minOps` worst-case ops, so small budgets still work). The
   * secret server key is exempt. Reservations expire with their signature, a re-request replaces the earlier approval
   * for the same (sender, nonce), and the on-chain limits remain the real backstop.
   */
  private checkReservationCaps(ctx: AttemptContext, projectId: Hex, budget: bigint): TierResult | null {
    const { db } = this.deps;
    const caps = this.deps.config.reservations;
    const { maxCost, nowMs, exclude } = ctx;

    const senderCount = db.outstandingCountForSender(projectId, ctx.userOp.sender, nowMs, exclude);
    if (senderCount >= caps.perSenderMaxCount) {
      return { ok: false, reason: "reservation_cap_exceeded", message: `wallet ${ctx.userOp.sender} already holds ${senderCount} unexecuted approvals; submit or wait for them to expire` };
    }
    const floor = BigInt(caps.minOps) * maxCost;
    const share = (bps: number): bigint => {
      const v = (budget * BigInt(bps)) / 10_000n;
      return v > floor ? v : floor;
    };
    const ip = ctx.clientIp ?? "unknown";
    const ipHeld = db.outstandingReservedForIpWei(projectId, ip, nowMs, exclude);
    if (ipHeld + maxCost > share(caps.perIpBps)) {
      return { ok: false, reason: "reservation_cap_exceeded", message: "too many unexecuted approvals from this address; submit them or wait for them to expire" };
    }
    const credHeld = db.outstandingReservedForClientCredentialWei(projectId, nowMs, exclude);
    if (credHeld + maxCost > share(caps.perCredentialBps)) {
      return { ok: false, reason: "reservation_cap_exceeded", message: "the app's public client token holds too many unexecuted approvals right now; retry shortly or use the server key" };
    }
    return null;
  }

  /** Audit L-4: bound the user-supplied gas fields and fees against sane limits and the current base fee. */
  private async checkGasBounds(userOp: SponsorUserOperationInput): Promise<{ ok: true } | { ok: false; reason: SponsorshipDenialReason; message: string }> {
    const b = this.deps.config.gasBounds;
    if (userOp.preVerificationGas > b.maxPreVerificationGas) {
      return { ok: false, reason: "gas_limits_out_of_bounds", message: `preVerificationGas ${userOp.preVerificationGas} exceeds the limit ${b.maxPreVerificationGas}` };
    }
    if (userOp.verificationGasLimit > b.maxVerificationGasLimit) {
      return { ok: false, reason: "gas_limits_out_of_bounds", message: `verificationGasLimit ${userOp.verificationGasLimit} exceeds the limit ${b.maxVerificationGasLimit}` };
    }
    if (userOp.callGasLimit > b.maxCallGasLimit) {
      return { ok: false, reason: "gas_limits_out_of_bounds", message: `callGasLimit ${userOp.callGasLimit} exceeds the limit ${b.maxCallGasLimit}` };
    }
    let baseFee: bigint;
    try {
      baseFee = await this.deps.chain.getBaseFee();
    } catch {
      return { ok: false, reason: "chain_read_failed", message: "could not read the current base fee" };
    }
    const maxFeeAllowed = baseFee * BigInt(b.maxFeeBaseFeeMultiple) < b.maxFeePerGasCapWei ? baseFee * BigInt(b.maxFeeBaseFeeMultiple) : b.maxFeePerGasCapWei;
    if (userOp.maxFeePerGas > maxFeeAllowed) {
      return { ok: false, reason: "fee_out_of_bounds", message: `maxFeePerGas ${userOp.maxFeePerGas} exceeds ${maxFeeAllowed} (${b.maxFeeBaseFeeMultiple}x the current base fee ${baseFee}, capped at ${b.maxFeePerGasCapWei})` };
    }
    const priorityAllowed = baseFee * BigInt(b.maxPriorityBaseFeeMultiple);
    if (userOp.maxPriorityFeePerGas > userOp.maxFeePerGas || userOp.maxPriorityFeePerGas > priorityAllowed) {
      return { ok: false, reason: "fee_out_of_bounds", message: `maxPriorityFeePerGas ${userOp.maxPriorityFeePerGas} exceeds ${priorityAllowed < userOp.maxFeePerGas ? priorityAllowed : userOp.maxFeePerGas}` };
    }
    return { ok: true };
  }

  private async approve(ctx: AttemptContext, kind: SponsorKind, sponsorId: Hex, finalHash: Hex): Promise<SponsorshipResponse> {
    const cfg = this.deps.config;
    const signature = await signFinalHash(this.deps.signerAccount, finalHash);
    const paymasterData = buildSponsoredPaymasterData(ctx.window, sponsorId, signature);
    const epHash = computeEntryPointUserOpHash({
      userOp: ctx.userOp,
      paymaster: cfg.paymasterAddress,
      paymasterVerificationGasLimit: cfg.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: cfg.paymasterPostOpGasLimit,
      paymasterData,
      entryPointAddress: cfg.entryPointAddress,
      chainId: cfg.chainId,
    });
    this.deps.db.setEpHash(finalHash, epHash);
    this.audit(
      "approved",
      "ok",
      { project: ctx.project, sponsor: kind === "free" ? "free" : sponsorId, identity: ctx.identity, sender: ctx.userOp.sender, targets: ctx.targets, maxCost: ctx.maxCost, epHash, detail: `sponsor=${kind}` },
      ctx.nowMs,
    );
    return {
      status: "approved",
      chainId: cfg.chainId,
      paymaster: cfg.paymasterAddress,
      paymasterVerificationGasLimit: numberToHex(cfg.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: numberToHex(cfg.paymasterPostOpGasLimit),
      paymasterData,
      validUntil: ctx.window.validUntil,
      validAfter: ctx.window.validAfter,
      userOpHash: epHash,
      sponsor: { kind, sponsorId, projectKey: ctx.project.key },
      maxCostWei: ctx.maxCost.toString(),
    };
  }
}

/** Lower-cased `scheme://host[:port]` of an Origin header value, or null if it is not a plain origin. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/[*\s]/.test(u.host)) return null; // no wildcards
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

type SponsorshipResponseDetail = { project?: SponsorshipDenialReason; free?: SponsorshipDenialReason };

/** HTTP status for a v2 denial reason (mirrors v1's mapping; new reasons added). */
export function statusForSponsorshipReason(reason: SponsorshipDenialReason): number {
  switch (reason) {
    case "invalid_or_expired_token":
    case "unknown_or_invalid_app_credential":
      return 401;
    case "app_suspended":
    case "sender_not_owned_by_token_user":
    case "target_not_allowed_onchain":
    case "destination_not_allowed_for_app":
    case "project_identity_required":
    case "project_origin_not_allowed":
    case "free_tier_identity_required":
    case "project_paused":
    case "project_not_claimed_onchain":
    case "project_owner_changed":
    case "project_sender_limit_not_set":
    case "account_deployment_disabled":
      return 403;
    case "calldata_decode_failed":
    case "malformed_request":
    case "free_pool_op_too_large":
    case "gas_limits_out_of_bounds":
    case "fee_out_of_bounds":
    case "fee_above_onchain_cap":
      return 400;
    case "chain_read_failed":
      return 503;
    default:
      // balance / daily / per-wallet / user-cap reasons
      return 429;
  }
}

