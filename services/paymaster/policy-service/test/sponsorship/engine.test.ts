/**
 * Tests for the v2 decision engine: draw order (project first, then free), exact exhaustion behaviour, sponsor
 * commitment in the signature, who may spend a project's budget (server key / allowed origins), the free tier's
 * Privy-only gate, caps, reconciliation effect, fail-closed reads.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { recoverMessageAddress } from "viem";
import { computeFinalHash, computeUserOpHash } from "../../src/userOpHash.js";
import { FREE_POOL_ID, buildSponsoredHashPrefix } from "../../src/sponsorship/paymasterData.js";
import { normalizeOrigin } from "../../src/sponsorship/engine.js";
import { PEPU } from "./helpers/fakeChain.js";
import {
  CHAIN_ID,
  DEFAULT_MAX_COST,
  ORIGIN,
  OTHER_TARGET,
  PAYMASTER,
  SENDER,
  TARGET,
  freshOp,
  makeHarness,
  signerAccount,
  type Harness,
} from "./helpers/harness.js";
import { buildSingleKernelExecuteCallData } from "../helpers/kernelCallData.js";
import type { Hex } from "viem";

let h: Harness;

/** `token` may be a client token (sent with `origin`) or a server key (origin irrelevant). */
function run(token: string | null, privyToken: string | null = null, over = {}, origin: string | null = ORIGIN) {
  return h.engine.evaluate({ appToken: token, origin, privyToken, userOp: freshOp(over) });
}

describe("credentials", () => {
  beforeEach(() => {
    h = makeHarness();
  });

  it("denies a missing or unknown credential, counts it in memory and does NOT write an audit row (review 3, M-3)", async () => {
    for (const t of [null, "nope"]) {
      const r = await run(t);
      expect(r).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
    }
    expect(h.db.listAudit(5)).toHaveLength(0);
    expect(h.engine.stats()).toMatchObject({ unknownCredentialDenials: 2 });
    expect(h.engine.stats().lastUnknownCredentialAt).not.toBeNull();
  });

  it("denies a suspended app", async () => {
    const { token, project } = h.addProject();
    h.db.setStatus(project.key, "suspended", h.clock.now);
    expect(await run(token)).toMatchObject({ status: "denied", reason: "app_suspended" });
  });

  it("a rotated client token invalidates the old one immediately", async () => {
    const { token, project } = h.addProject();
    const next = h.db.rotateToken(project.key, h.clock.now) as string;
    expect(await run(token)).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
    expect(await run(next)).toMatchObject({ status: "approved" });
  });

  it("a rotated server key invalidates the old one immediately", async () => {
    const { serverKey, project } = h.addProject();
    const next = h.db.rotateServerKey(project.key, h.clock.now) as string;
    expect(await run(serverKey, null, {}, null)).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
    expect(await run(next, null, {}, null)).toMatchObject({ status: "approved" });
  });

  it("denies undecodable callData", async () => {
    const { token } = h.addProject();
    const r = await run(token, null, { callData: "0xdeadbeef" });
    expect(r).toMatchObject({ status: "denied", reason: "calldata_decode_failed" });
  });
});

describe("who may spend a project's budget (a stranger cannot drain it)", () => {
  beforeEach(() => {
    h = makeHarness();
  });

  it("the SERVER key sponsors any wallet with no origin and no Privy identity", async () => {
    const { serverKey, projectId } = h.addProject();
    const r = await run(serverKey, null, {}, null);
    expect(r.status).toBe("approved");
    if (r.status === "approved") expect(r.sponsor).toMatchObject({ kind: "project", sponsorId: projectId });
  });

  it("the CLIENT token spends the project budget only from an allowed origin", async () => {
    const { token } = h.addProject();
    expect((await run(token, null, {}, ORIGIN)).status).toBe("approved");
    expect(await run(token, null, {}, "https://evil.example")).toMatchObject({ status: "denied", reason: "project_origin_not_allowed" });
    expect(await run(token, null, {}, null)).toMatchObject({ status: "denied", reason: "project_origin_not_allowed" });
    expect(await run(token, null, {}, "not an origin")).toMatchObject({ status: "denied", reason: "project_origin_not_allowed" });
  });

  it("origin matching is on the normalised origin (case, default path stripped)", async () => {
    const { token } = h.addProject();
    expect((await run(token, null, {}, "HTTPS://APP.EXAMPLE/some/page")).status).toBe("approved");
    expect(normalizeOrigin("https://App.Example:443/x")).toBe("https://app.example");
    expect(normalizeOrigin("ftp://x")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });

  it("a project with NO allowed origins cannot be spent with its client token at all (server key only)", async () => {
    const { token, serverKey } = h.addProject({ allowedOrigins: [] });
    expect(await run(token)).toMatchObject({ status: "denied", reason: "project_origin_not_allowed" });
    expect((await run(serverKey, null, {}, null)).status).toBe("approved");
  });

  it("a wrong origin on a funded project never falls through to someone else's money", async () => {
    // detail shows the project tier refused; with no Privy identity the free tier refuses too
    const { token } = h.addProject();
    const r = await run(token, null, {}, "https://evil.example");
    expect(r).toMatchObject({ status: "denied", detail: { project: "project_origin_not_allowed", free: "free_tier_identity_required" } });
  });

  it("mirrors the on-chain per-wallet daily limit (counting this wallet's outstanding approvals)", async () => {
    const { serverKey, projectId } = h.addProject({ senderDailyLimit: DEFAULT_MAX_COST * 2n + 1n });
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await run(serverKey, null, {}, null);
      out.push(r.status === "approved" ? r.sponsor.kind : r.reason);
    }
    expect(out).toEqual(["project", "project", "project_sender_limit_reached"]);
    // a different wallet has its own budget
    const other = await run(serverKey, null, { sender: "0x00000000000000000000000000000000000000b2" }, null);
    expect(other.status).toBe("approved");
    // on-chain counter from today is honoured; yesterday's is ignored
    h.chain.setSenderSpend(projectId, SENDER, Math.floor(h.clock.now / 1000 / 86_400), DEFAULT_MAX_COST * 2n);
    expect(await run(serverKey, null, { sender: SENDER }, null)).toMatchObject({ reason: "project_sender_limit_reached" });
    h.chain.setSenderSpend(projectId, SENDER, Math.floor(h.clock.now / 1000 / 86_400) - 1, DEFAULT_MAX_COST * 2n);
    h.clock.now += 120_000; // let the earlier approvals expire
    expect((await run(serverKey, null, { sender: SENDER }, null)).status).toBe("approved");
  });

  it("the free tier NEVER pays for a project's non-Privy wallets, even when the project is empty", async () => {
    const { serverKey } = h.addProject({ balance: 0n });
    const r = await run(serverKey, null, {}, null);
    expect(r).toMatchObject({ status: "denied", reason: "project_balance_exhausted", detail: { project: "project_balance_exhausted", free: "free_tier_identity_required" } });
    expect(h.db.freeSpendTodayWei(h.clock.now)).toBe(0n);
  });

  it("a project may sponsor a wallet with no Privy account at all, repeatedly, within its limits", async () => {
    const { serverKey, projectId } = h.addProject();
    for (let i = 0; i < 3; i++) expect((await run(serverKey, null, { sender: "0x00000000000000000000000000000000000000c3" }, null)).status).toBe("approved");
    expect(h.db.identitySpendWei(projectId, "sender:0x00000000000000000000000000000000000000c3", 0)).toBe(DEFAULT_MAX_COST * 3n);
  });
});

describe("draw order: project first, then free tier (verified Privy users only)", () => {
  let u1: string;
  beforeEach(() => {
    h = makeHarness();
    u1 = h.asUser("user-1");
  });

  it("charges the PROJECT when it can pay, leaving the user's free allowance untouched", async () => {
    const { token, projectId } = h.addProject();
    const r = await run(token, u1);
    expect(r.status).toBe("approved");
    if (r.status !== "approved") return;
    expect(r.sponsor).toMatchObject({ kind: "project", sponsorId: projectId });
    expect(h.db.freeIdentitySpendWei("privy:user-1", 0)).toBe(0n);
    expect(h.db.identitySpendWei(projectId, "privy:user-1", 0)).toBe(DEFAULT_MAX_COST);
  });

  it("falls to the FREE tier when the project's balance cannot cover the op", async () => {
    const { token } = h.addProject({ balance: 1n * PEPU });
    const r = await run(token, u1);
    expect(r.status).toBe("approved");
    if (r.status !== "approved") return;
    expect(r.sponsor.kind).toBe("free");
    expect(r.sponsor.sponsorId).toBe(FREE_POOL_ID);
    expect(h.db.freeIdentitySpendWei("privy:user-1", 0)).toBe(DEFAULT_MAX_COST);
  });

  it("mid-day exhaustion: ops drain the project, then each later op uses the free tier (no splitting)", async () => {
    const { token, projectId } = h.addProject({ balance: DEFAULT_MAX_COST * 2n + 1n });
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await run(token, u1);
      expect(r.status).toBe("approved");
      if (r.status === "approved") kinds.push(r.sponsor.kind);
      if (r.status === "approved" && r.sponsor.kind === "project") {
        const cur = await h.chain.getSponsor(projectId);
        h.chain.setProject(projectId, { balance: cur.balance - DEFAULT_MAX_COST });
        h.db.markExecuted(r.userOpHash);
      }
    }
    expect(kinds).toEqual(["project", "project", "free", "free"]);
    h.chain.setProject(projectId, { balance: 50n * PEPU });
    const again = await run(token, u1);
    expect(again.status === "approved" && again.sponsor.kind).toBe("project");
  });

  it("denies with the project reason + both tier details when neither can pay", async () => {
    const { token } = h.addProject({ balance: 0n });
    h.chain.setFree({ balance: 0n });
    const r = await run(token, u1);
    expect(r).toMatchObject({ status: "denied", reason: "project_balance_exhausted", detail: { project: "project_balance_exhausted", free: "free_pool_empty" } });
  });

  it("outstanding (signed, not yet on-chain) approvals are subtracted so concurrent ops cannot overspend one balance", async () => {
    const { token } = h.addProject({ balance: DEFAULT_MAX_COST + 1n });
    const first = await run(token, u1);
    const second = await run(token, u1);
    expect(first.status === "approved" && first.sponsor.kind).toBe("project");
    expect(second.status === "approved" && second.sponsor.kind).toBe("free");
  });

  it("falls through to free when the project is paused or the destination is not on ITS on-chain allowlist", async () => {
    const { token, projectId } = h.addProject();
    h.chain.setProject(projectId, { paused: true });
    let r = await run(token, u1);
    expect(r.status === "approved" && r.sponsor.kind).toBe("free");
    h.chain.setProject(projectId, { paused: false });
    h.chain.setTargets(projectId, [OTHER_TARGET]);
    r = await run(token, u1);
    expect(r.status === "approved" && r.sponsor.kind).toBe("free");
  });

  it("respects the project's on-chain daily limit (counting outstanding) and ignores a stale spent counter from a previous day", async () => {
    const { token, projectId } = h.addProject({ dailyLimit: DEFAULT_MAX_COST + 1n });
    h.chain.setProject(projectId, { spentToday: 5n * PEPU, spentDay: Math.floor(h.clock.now / 1000 / 86_400) });
    let r = await run(token, u1);
    expect(r.status === "approved" && r.sponsor.kind).toBe("free");
    h.chain.setProject(projectId, { spentToday: 5n * PEPU, spentDay: Math.floor(h.clock.now / 1000 / 86_400) - 1 });
    r = await run(token, u1);
    expect(r.status === "approved" && r.sponsor.kind).toBe("project");
  });

  it("enforces the project's per-user daily cap, then falls to free", async () => {
    const { token } = h.addProject({ perUserCap: DEFAULT_MAX_COST * 2n });
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await run(token, u1);
      if (r.status === "approved") kinds.push(r.sponsor.kind);
    }
    expect(kinds).toEqual(["project", "project", "free"]);
  });

  it("a free-tier-only app (no on-chain project) draws only the free pool", async () => {
    const { token } = h.addFreeApp();
    const r = await run(token, u1);
    expect(r.status === "approved" && r.sponsor.kind).toBe("free");
  });

  it("requireIdentity projects refuse wallets without a verified Privy token (and so does the free tier)", async () => {
    const { token } = h.addProject({ requireIdentity: true });
    const r = await run(token);
    expect(r).toMatchObject({ status: "denied", reason: "project_identity_required", detail: { free: "free_tier_identity_required" } });
  });
});

describe("the signature commits to the sponsor", () => {
  beforeEach(() => {
    h = makeHarness();
  });

  async function signerOf(r: Awaited<ReturnType<typeof run>>, userOp: ReturnType<typeof freshOp>, sponsorForHash: Hex): Promise<string> {
    if (r.status !== "approved") throw new Error("expected approval");
    const sig = `0x${r.paymasterData.slice(2 + (1 + 6 + 6 + 32) * 2)}` as Hex;
    const prefix = buildSponsoredHashPrefix(
      { paymaster: PAYMASTER, paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 60_000n },
      { validUntil: r.validUntil, validAfter: r.validAfter },
      sponsorForHash,
    );
    const finalHash = computeFinalHash(computeUserOpHash(userOp, prefix), CHAIN_ID);
    return recoverMessageAddress({ message: { raw: finalHash }, signature: sig });
  }

  it("the signed hash includes the sponsorId: it recovers the signer only for the committed sponsor", async () => {
    const { token, projectId } = h.addProject();
    const op = freshOp();
    const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: op });
    if (r.status !== "approved") throw new Error("expected approval");
    expect(r.paymasterData.slice(2 + 13 * 2, 2 + (13 + 32) * 2)).toBe(projectId.slice(2));
    expect(await signerOf(r, op, projectId)).toBe(signerAccount.address);
    expect(await signerOf(r, op, FREE_POOL_ID)).not.toBe(signerAccount.address);
  });

  it("a free-tier approval commits to the all-zero sponsor id", async () => {
    const { token } = h.addFreeApp();
    const op = freshOp();
    const r = await h.engine.evaluate({ appToken: token, privyToken: h.asUser("u"), userOp: op });
    if (r.status !== "approved") throw new Error("expected approval");
    expect(await signerOf(r, op, FREE_POOL_ID)).toBe(signerAccount.address);
    expect(r.paymasterData.slice(2 + 13 * 2, 2 + (13 + 32) * 2)).toBe("00".repeat(32));
  });

  it("is idempotent for an identical request in the same second (one usage row, identical response)", async () => {
    const { token } = h.addProject();
    const op = freshOp();
    const a = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: op });
    const b = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: op });
    expect(a).toEqual(b);
    expect(h.db.listUsage(h.db.listAllProjects()[0]?.key as string, 10)).toHaveLength(1);
  });
});

describe("free tier: Privy-only gating and per-user caps", () => {
  beforeEach(() => {
    h = makeHarness();
  });

  it("denies every request without a verified Privy token (there is no anonymous tier)", async () => {
    const { token } = h.addFreeApp();
    expect(await run(token)).toMatchObject({ status: "denied", reason: "free_tier_identity_required" });
    expect(await run(token, null, { sender: "0x00000000000000000000000000000000000dead1" })).toMatchObject({ reason: "free_tier_identity_required" });
  });

  it("a Privy-linked smart wallet address alone proves nothing: no token, no free tier", async () => {
    const { token } = h.addFreeApp();
    h.resolver.owners.set(SENDER.toLowerCase(), "user-1"); // Privy knows this wallet, but the request carries no token
    expect(await run(token)).toMatchObject({ status: "denied", reason: "free_tier_identity_required" });
    expect(h.resolver.lookups).toBe(0); // and we do not even look the address up
  });

  it("a bogus or expired token is denied outright", async () => {
    const { token } = h.addFreeApp();
    expect(await run(token, "forged")).toMatchObject({ status: "denied", reason: "invalid_or_expired_token" });
  });

  it("a verified token is accepted for any smart-account address (keyed on the Privy user)", async () => {
    const { token } = h.addFreeApp();
    const t = h.asUser("user-1");
    expect((await run(token, t)).status).toBe("approved");
    expect((await run(token, t, { sender: "0x00000000000000000000000000000000000dead1" })).status).toBe("approved");
    expect(h.db.freeIdentitySpendWei("privy:user-1", 0)).toBe(DEFAULT_MAX_COST * 2n);
  });

  it("many sender addresses under ONE Privy user share one budget (the sybil-by-address attack fails)", async () => {
    const { token } = h.addFreeApp();
    const t = h.asUser("whale-user");
    const senders = Array.from({ length: 12 }, (_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as const);
    let approved = 0;
    for (const s of senders) {
      const r = await run(token, t, { sender: s });
      if (r.status === "approved") approved++;
    }
    expect(approved).toBe(5); // hourly cap of 30 PEPU binds first
    expect(h.db.freeIdentitySpendWei("privy:whale-user", 0)).toBe(DEFAULT_MAX_COST * 5n);
  });

  it("enforces ~50 PEPU/user/day (hourly 30 first, then daily after the hour rolls)", async () => {
    const { token } = h.addFreeApp();
    const t = h.asUser("u");
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await run(token, t);
      results.push(r.status === "approved" ? "ok" : r.reason);
    }
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok", "free_tier_user_hourly_exceeded"]);
    h.clock.now += 61 * 60 * 1000;
    for (let i = 0; i < 3; i++) expect((await run(token, t)).status).toBe("approved");
    const last = await run(token, t);
    expect(last).toMatchObject({ status: "denied", reason: "free_tier_user_daily_exceeded" });
    h.clock.now += 24 * 60 * 60 * 1000;
    expect((await run(token, t)).status).toBe("approved");
  });

  it("enforces per-user op counts", async () => {
    h = makeHarness({ freeTier: { perUserHourlyCount: 2, perUserHourlyWei: 1000n * PEPU, perUserDailyWei: 1000n * PEPU } });
    const { token } = h.addFreeApp();
    const t = h.asUser("u");
    expect((await run(token, t)).status).toBe("approved");
    expect((await run(token, t)).status).toBe("approved");
    expect(await run(token, t)).toMatchObject({ status: "denied", reason: "free_tier_count_exceeded" });
  });

  it("the budget follows the user across projects/apps (free usage is keyed on identity, not app)", async () => {
    const a = h.addFreeApp({ label: "app-a" });
    const b = h.addFreeApp({ label: "app-b" });
    const t = h.asUser("u");
    for (let i = 0; i < 3; i++) expect((await run(a.token, t)).status).toBe("approved");
    for (let i = 0; i < 2; i++) expect((await run(b.token, t)).status).toBe("approved");
    expect(await run(b.token, t)).toMatchObject({ status: "denied", reason: "free_tier_user_hourly_exceeded" });
  });

  it("there is NO chain-wide ceiling: many distinct users keep being sponsored (bounded only by the pool and per-user caps)", async () => {
    const { token } = h.addFreeApp();
    let approved = 0;
    for (let i = 0; i < 250; i++) {
      const r = await run(token, h.asUser(`user-${i}`));
      if (r.status === "approved") approved++;
    }
    expect(approved).toBe(250);
    // 250 users x 5.98 PEPU = 1,495 PEPU in one day: more than the removed 1,000 PEPU/day chain ceiling would allow
    expect(h.db.freeSpendTodayWei(h.clock.now)).toBeGreaterThan(1_000n * PEPU);
  });

  it("reconciliation to ACTUAL cost frees user budget (settled ops count at the real charge)", async () => {
    const { token } = h.addFreeApp();
    const t = h.asUser("u");
    const seen: Hex[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await run(token, t);
      if (r.status === "approved") seen.push(r.userOpHash);
    }
    expect(await run(token, t)).toMatchObject({ status: "denied", reason: "free_tier_user_hourly_exceeded" });
    for (const ep of seen) h.db.markSettled(ep, 1n * PEPU, 1, ("0x" + "11".repeat(32)) as Hex);
    expect(h.db.freeIdentitySpendWei("privy:u", 0)).toBe(5n * PEPU);
    expect((await run(token, t)).status).toBe("approved");
  });

  it("voided (expired, never executed) approvals stop counting; executed ones never void", async () => {
    const { token } = h.addFreeApp();
    const t = h.asUser("u");
    const eps: Hex[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await run(token, t);
      if (r.status === "approved") eps.push(r.userOpHash);
    }
    h.db.markExecuted(eps[0] as Hex);
    const voided = h.db.voidExpiredApprovals(Math.floor(h.clock.now / 1000) + 1_000);
    expect(voided).toBe(4);
    expect(h.db.freeIdentitySpendWei("privy:u", 0)).toBe(DEFAULT_MAX_COST);
  });
});

describe("free tier: on-chain gates", () => {
  let t: string;
  beforeEach(() => {
    h = makeHarness();
    t = h.asUser("u");
  });

  it("per-op size limit, pool balance, switched-off tier and allowlist all deny with specific reasons", async () => {
    const { token } = h.addFreeApp();
    h.chain.freeConfig.maxOpCost = 1n * PEPU;
    expect(await run(token, t)).toMatchObject({ reason: "free_pool_op_too_large" });
    h.chain.freeConfig.maxOpCost = 40n * PEPU;
    h.chain.setFree({ balance: 1n * PEPU });
    expect(await run(token, t)).toMatchObject({ reason: "free_pool_empty" });
    h.chain.setFree({ balance: 100n * PEPU });
    h.chain.freeConfig.enabled = false;
    expect(await run(token, t)).toMatchObject({ reason: "free_tier_disabled" });
    h.chain.freeConfig.enabled = true;
    h.chain.setTargets(FREE_POOL_ID, []);
    expect(await run(token, t)).toMatchObject({ reason: "target_not_allowed_onchain" });
  });

  it("mirrors the free pool's on-chain per-wallet limit (0 = off)", async () => {
    const { token } = h.addFreeApp();
    h.chain.freeConfig.senderDailyLimit = DEFAULT_MAX_COST * 2n + 1n;
    h.chain.setSenderSpend(FREE_POOL_ID, SENDER, Math.floor(h.clock.now / 1000 / 86_400), DEFAULT_MAX_COST * 2n);
    expect(await run(token, t)).toMatchObject({ status: "denied", reason: "free_tier_sender_limit_reached" });
    h.chain.freeConfig.senderDailyLimit = 0n;
    expect((await run(token, t)).status).toBe("approved");
  });

  it("an app-level allowlist can narrow the free tier further", async () => {
    const { token } = h.addFreeApp({ allowedDestinations: [OTHER_TARGET] });
    expect(await run(token, t)).toMatchObject({ status: "denied", reason: "destination_not_allowed_for_app" });
  });

  it("batch calls require EVERY target to be allowed", async () => {
    const { token } = h.addFreeApp();
    const bad = buildSingleKernelExecuteCallData(OTHER_TARGET);
    expect(await run(token, t, { callData: bad })).toMatchObject({ reason: "target_not_allowed_onchain" });
  });

  it("the free tier switched off in config denies", async () => {
    h = makeHarness({ freeTier: { enabled: false } });
    const { token } = h.addFreeApp();
    expect(await run(token, h.asUser("u"))).toMatchObject({ reason: "free_tier_disabled" });
  });
});

describe("Privy token path, ownership and failure modes", () => {
  it("a token for an app we cannot verify is ignored (never trusted): no identity, so no free tier", async () => {
    h = makeHarness({ withResolver: false });
    const { token } = h.addFreeApp();
    expect(await run(token, "good")).toMatchObject({ status: "denied", reason: "free_tier_identity_required" });
    // ... while a project can still sponsor that third-party app's wallets
    const { serverKey } = h.addProject();
    expect((await run(serverKey, "third-party-token", {}, null)).status).toBe("approved");
  });

  it("a valid token keys the free tier on the token's user; an invalid one is denied", async () => {
    h = makeHarness();
    const good = h.asUser("user-9");
    const { token: pt } = h.addProject({ balance: 0n });
    expect(await run(pt, "bad")).toMatchObject({ status: "denied", reason: "invalid_or_expired_token" });
    const ok = await run(pt, good);
    expect(ok.status).toBe("approved");
    expect(h.db.freeIdentitySpendWei("privy:user-9", 0)).toBe(DEFAULT_MAX_COST);
  });

  it("with requireSenderOwnership a token user must own the sender", async () => {
    h = makeHarness({ requireSenderOwnership: true });
    const { token } = h.addProject();
    const tok = h.asUser("user-1");
    h.resolver.owners.set(SENDER.toLowerCase(), "someone-else");
    expect(await run(token, tok)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
    h.resolver.owners.set(SENDER.toLowerCase(), "user-1");
    h.clock.now += 120_000;
    expect((await run(token, tok)).status).toBe("approved");
  });

  it("an identity-lookup outage fails closed for token holders (ownership check) but not for token-less project traffic", async () => {
    h = makeHarness({ requireSenderOwnership: true });
    h.resolver.throwOnLookup = true;
    const funded = h.addProject();
    expect((await run(funded.serverKey, null, {}, null)).status).toBe("approved");
    expect(await run(funded.serverKey, h.asUser("u"), {}, null)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
  });

  it("ownership lookups are cached (one Privy call per sender within the TTL)", async () => {
    h = makeHarness({ requireSenderOwnership: true });
    const { token } = h.addProject();
    const tok = h.asUser("u");
    h.resolver.owners.set(SENDER.toLowerCase(), "u");
    for (let i = 0; i < 3; i++) await run(token, tok);
    expect(h.resolver.lookups).toBe(1);
  });
});

describe("fail closed on chain read errors", () => {
  it("denies (503-class) and records nothing when the chain cannot be read", async () => {
    h = makeHarness();
    const { token, project } = h.addProject();
    h.chain.failReads = true;
    const r = await run(token);
    expect(r).toMatchObject({ status: "denied", reason: "chain_read_failed" });
    expect(h.db.listUsage(project.key, 10)).toHaveLength(0);
  });
});

describe("every decision is audited", () => {
  it("writes approve and deny rows with sponsor and reasons", async () => {
    h = makeHarness();
    const { token, project } = h.addProject();
    await run(token);
    await run(token, null, { callData: "0xdeadbeef" });
    const rows = h.db.listAudit(10, project.key);
    expect(rows.map((r) => r.decision).sort()).toEqual(["approved", "denied"]);
    expect(rows.find((r) => r.decision === "approved")?.epHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("credentials follow the on-chain owner (delta review L4)", () => {
  beforeEach(() => {
    h = makeHarness();
  });

  it("denies and revokes the server key and client token once the on-chain owner differs from the issuance snapshot", async () => {
    const { token, serverKey, project, projectId } = h.addProject();
    expect((await run(serverKey, null, {}, null)).status).toBe("approved");
    h.chain.setProject(projectId, { owner: "0x00000000000000000000000000000000000000d4" });
    expect(await run(serverKey, null, {}, null)).toMatchObject({ status: "denied", reason: "project_owner_changed" });
    // both credentials are dead from now on, and the origin allowlist of the previous owner is gone
    expect(await run(serverKey, null, {}, null)).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
    expect(await run(token)).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
    const row = h.db.getByKey(project.key);
    expect(row?.owner).toBe("0x00000000000000000000000000000000000000d4");
    expect(row?.allowedOrigins).toEqual([]);
  });

  it("a revoked project cannot fall through to the free tier with the old credential", async () => {
    const { serverKey, projectId } = h.addProject();
    h.chain.setProject(projectId, { owner: "0x00000000000000000000000000000000000000d4" });
    const r = await h.engine.evaluate({ appToken: serverKey, origin: null, privyToken: "any-valid-privy-token", userOp: freshOp({}) });
    expect(r.status).toBe("denied");
    expect(r).toMatchObject({ reason: "project_owner_changed" });
  });

  it("an unchanged owner (any address casing) is unaffected", async () => {
    const { serverKey, projectId } = h.addProject();
    const cur = await h.chain.getSponsor(projectId);
    h.chain.setProject(projectId, { owner: cur.owner.toUpperCase().replace("0X", "0x") as typeof cur.owner });
    expect((await run(serverKey, null, {}, null)).status).toBe("approved");
  });

  it("fails closed when the owner cannot be read", async () => {
    const { serverKey } = h.addProject();
    h.chain.failReads = true;
    expect(await run(serverKey, null, {}, null)).toMatchObject({ status: "denied", reason: "chain_read_failed" });
  });
});
