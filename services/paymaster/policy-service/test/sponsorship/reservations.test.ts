/**
 * Regression tests for the internal review's M-1 (reservation griefing with the public client token) and L-4 (the
 * signer must not approve arbitrary user-supplied gas fields). See services/paymaster/audits/2026-10-internal-review.md.
 *
 * The first test is the review's vitest PoC turned into a regression: it used to fail ("legit: denied
 * project_balance_exhausted") and now passes: honest users are still served while an attacker floods approvals that
 * are never executed.
 */
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { SponsorshipEngine, VALID_AFTER_SKEW_SECONDS } from "../../src/sponsorship/engine.js";
import { RateLimiter } from "../../src/sponsorship/rateLimit.js";
import { DEFAULT_MAX_COST, DEFAULT_MAX_FEE, ORIGIN, defaultGasBounds, freshOp, makeHarness, signerAccount } from "./helpers/harness.js";
import { PEPU } from "./helpers/fakeChain.js";

const fakeSender = (i: number): Hex => `0x${(0x1000 + i).toString(16).padStart(40, "0")}`;
const ip = (i: number): string => `198.51.100.${i % 250}`;
const GWEI = 10n ** 9n;

describe("M-1: reservations cannot be weaponised with the public client token", () => {
  it("REGRESSION of the review PoC: an attacker rotating fake senders from one address cannot lock honest users out", async () => {
    const h = makeHarness();
    const { token } = h.addProject({ balance: 100n * PEPU }); // ~16 worst-case ops
    let approved = 0;
    for (let i = 0; i < 40; i++) {
      const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(i) }) });
      if (r.status === "approved") approved++;
    }
    expect(approved).toBeGreaterThan(0);
    expect(approved).toBeLessThanOrEqual(2); // per-address cap: max(5% of budget, 2 worst-case ops)
    // an honest user from a different address is still served (the PoC asserted exactly this and failed before the fix)
    const legit = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "203.0.113.5", privyToken: null, userOp: freshOp() });
    expect(legit.status).toBe("approved");
    // and the attacker's denials say why
    const again = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(99) }) });
    expect(again).toMatchObject({ status: "denied", reason: "reservation_cap_exceeded" });
  });

  it("an attacker rotating addresses is bounded by the client token's total share; the server key and most of the budget stay usable", async () => {
    const h = makeHarness();
    const { token, serverKey, projectId } = h.addProject({ balance: 400n * PEPU, dailyLimit: 400n * PEPU });
    let approved = 0;
    for (let i = 0; i < 200; i++) {
      const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: ip(i), privyToken: null, userOp: freshOp({ sender: fakeSender(i) }) });
      if (r.status === "approved") approved++;
    }
    const held = h.db.outstandingReservedForClientCredentialWei(projectId, h.clock.now);
    expect(held).toBeLessThanOrEqual(25n * (400n * PEPU) / 100n); // 25% of min(balance, daily limit)
    expect(BigInt(approved) * DEFAULT_MAX_COST).toBe(held);
    // the secret server key is not blocked by the client-token pool
    const viaServer = await h.engine.evaluate({ appToken: serverKey, origin: null, clientIp: "192.0.2.1", privyToken: null, userOp: freshOp() });
    expect(viaServer.status).toBe("approved");
    // the on-chain balance was never touched: nothing was executed
    expect((await h.chain.getSponsor(projectId)).balance).toBe(400n * PEPU);
  });

  it("reservations expire with their signature: the attacker's hold disappears as soon as the window closes", async () => {
    const h = makeHarness();
    const { token } = h.addProject({ balance: 100n * PEPU });
    for (let i = 0; i < 10; i++) {
      await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(i) }) });
    }
    const blocked = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(50) }) });
    expect(blocked.status).toBe("denied");
    h.clock.now += (h.config.validityWindowSeconds + 1) * 1000; // validUntil has passed; no reconciler run needed
    const after = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(51) }) });
    expect(after.status).toBe("approved");
  });

  it("the reconciler voids expired, never-executed approvals so they stop counting toward the user caps", async () => {
    const h = makeHarness();
    const { token } = h.addProject({ balance: 100n * PEPU });
    await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp() });
    expect(h.db.usageCounts().approved).toBe(1);
    h.db.voidExpiredApprovals(Math.floor(h.clock.now / 1000) + h.config.validityWindowSeconds + 1);
    expect(h.db.usageCounts()).toMatchObject({ approved: 0, voided: 1 });
  });

  it("a wallet can hold at most N unexecuted approvals", async () => {
    const h = makeHarness();
    const { token } = h.addProject({ balance: 10_000n * PEPU, dailyLimit: 10_000n * PEPU });
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp() });
      results.push(r.status === "approved" ? "ok" : r.reason);
    }
    expect(results).toEqual(["ok", "ok", "reservation_cap_exceeded", "reservation_cap_exceeded"]);
  });

  it("re-requesting the same (sender, nonce) REPLACES the earlier approval instead of stacking reservations", async () => {
    const h = makeHarness();
    const { token, projectId } = h.addProject({ balance: 100n * PEPU });
    const op = freshOp();
    for (let i = 0; i < 6; i++) {
      h.clock.now += 1000; // a new window each time => a new signed hash for the same op
      const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: op });
      expect(r.status).toBe("approved");
    }
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBe(DEFAULT_MAX_COST); // one live reservation, not six
    expect(h.db.usageCounts()).toMatchObject({ approved: 1, voided: 5 });
  });

  it("a denied re-request does not destroy the earlier approval (all-or-nothing)", async () => {
    const h = makeHarness();
    const { token, projectId } = h.addProject({ balance: 100n * PEPU, perUserCap: DEFAULT_MAX_COST });
    const op = freshOp();
    const first = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: op });
    expect(first.status).toBe("approved");
    // tighten the per-user cap to zero headroom for anything NEW: a different op by the same identity must be denied
    const other = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: freshOp() });
    expect(other).toMatchObject({ status: "denied", reason: "project_user_cap_exceeded" });
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBe(DEFAULT_MAX_COST);
    expect(h.db.usageCounts()).toMatchObject({ approved: 1, voided: 0 });
  });

  it("per-IP rate limit on the client-token path (the server key is not limited)", async () => {
    const h = makeHarness();
    const { token, serverKey } = h.addProject({ balance: 10_000n * PEPU, dailyLimit: 10_000n * PEPU });
    const engine = new SponsorshipEngine({
      db: h.db,
      chain: h.chain,
      identity: h.identity,
      signerAccount,
      config: h.config,
      clientRateLimiter: new RateLimiter({ windowMs: 60_000, max: 3 }, () => h.clock.now),
      now: () => h.clock.now,
    });
    const statuses: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(i) }) });
      statuses.push(r.status === "approved" ? "ok" : r.reason);
    }
    expect(statuses).toEqual(["ok", "ok", "ok", "rate_limited", "rate_limited"]);
    const other = await engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "203.0.113.9", privyToken: null, userOp: freshOp({ sender: fakeSender(77) }) });
    expect(other.status).toBe("approved");
    for (let i = 0; i < 5; i++) {
      const r = await engine.evaluate({ appToken: serverKey, origin: null, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(100 + i) }) });
      expect(r.status).toBe("approved");
    }
    h.clock.now += 61_000;
    const later = await engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp({ sender: fakeSender(200) }) });
    expect(later.status).toBe("approved");
  });
});

describe("L-4: the signer bounds user-supplied gas fields", () => {
  const evalOp = async (over: Parameters<typeof freshOp>[0], setup?: (h: ReturnType<typeof makeHarness>) => void) => {
    const h = makeHarness();
    setup?.(h);
    const { token } = h.addProject({ balance: 10_000n * PEPU, dailyLimit: 10_000n * PEPU });
    const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.7", privyToken: null, userOp: freshOp(over) });
    return { h, r };
  };

  it("approves a normal op", async () => {
    expect((await evalOp({})).r.status).toBe("approved");
  });

  it("rejects an inflated preVerificationGas", async () => {
    const { r } = await evalOp({ preVerificationGas: defaultGasBounds().maxPreVerificationGas + 1n });
    expect(r).toMatchObject({ status: "denied", reason: "gas_limits_out_of_bounds" });
  });

  it("rejects an inflated verificationGasLimit and callGasLimit", async () => {
    expect((await evalOp({ verificationGasLimit: defaultGasBounds().maxVerificationGasLimit + 1n })).r).toMatchObject({ reason: "gas_limits_out_of_bounds" });
    expect((await evalOp({ callGasLimit: defaultGasBounds().maxCallGasLimit + 1n })).r).toMatchObject({ reason: "gas_limits_out_of_bounds" });
  });

  it("rejects a maxFeePerGas above a multiple of the current base fee", async () => {
    const { r } = await evalOp({ maxFeePerGas: 12_500n * GWEI * 3n + 1n }, (h) => (h.chain.baseFee = 12_500n * GWEI));
    expect(r).toMatchObject({ status: "denied", reason: "fee_out_of_bounds" });
  });

  it("follows the CURRENT base fee: the same op is fine when the base fee is higher, rejected when it drops", async () => {
    expect((await evalOp({ maxFeePerGas: DEFAULT_MAX_FEE }, (h) => (h.chain.baseFee = 4_000n * GWEI))).r).toMatchObject({ reason: "fee_out_of_bounds" });
    expect((await evalOp({ maxFeePerGas: DEFAULT_MAX_FEE }, (h) => (h.chain.baseFee = 12_500n * GWEI))).r.status).toBe("approved");
  });

  it("rejects a maxFeePerGas above the absolute cap even when the base fee is huge", async () => {
    const cap = defaultGasBounds().maxFeePerGasCapWei;
    const { r } = await evalOp({ maxFeePerGas: cap + 1n }, (h) => (h.chain.baseFee = cap * 10n));
    expect(r).toMatchObject({ reason: "fee_out_of_bounds" });
  });

  it("rejects an inflated priority fee (and priority above maxFee)", async () => {
    expect((await evalOp({ maxPriorityFeePerGas: 12_500n * GWEI + 1n })).r).toMatchObject({ reason: "fee_out_of_bounds" });
    expect((await evalOp({ maxFeePerGas: 1_000n * GWEI, maxPriorityFeePerGas: 1_001n * GWEI }, (h) => (h.chain.baseFee = 1_000n * GWEI))).r).toMatchObject({ reason: "fee_out_of_bounds" });
  });

  it("fails CLOSED when the base fee cannot be read", async () => {
    const { r } = await evalOp({}, (h) => (h.chain.failReads = true));
    expect(r).toMatchObject({ status: "denied", reason: "chain_read_failed" });
  });

  it("pairs with the on-chain fee cap: an op above the sponsor's own cap is not approved", async () => {
    const h = makeHarness();
    const { token, projectId } = h.addProject({ balance: 10_000n * PEPU });
    h.chain.setProject(projectId, { maxFeePerGasCap: DEFAULT_MAX_FEE - 1n });
    const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: freshOp() });
    expect(r).toMatchObject({ status: "denied", reason: "fee_above_onchain_cap" });
    h.chain.setProject(projectId, { maxFeePerGasCap: DEFAULT_MAX_FEE });
    const ok = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: freshOp() });
    expect(ok.status).toBe("approved");
  });
});

describe("I-5: validAfter has clock-skew tolerance", () => {
  it("the signed window starts a few seconds before now", async () => {
    const h = makeHarness();
    const { token } = h.addProject({ balance: 100n * PEPU });
    const r = await h.engine.evaluate({ appToken: token, origin: ORIGIN, privyToken: null, userOp: freshOp() });
    expect(r.status).toBe("approved");
    if (r.status !== "approved") return;
    expect(r.validAfter).toBe(Math.floor(h.clock.now / 1000) - VALID_AFTER_SKEW_SECONDS);
    expect(r.validUntil).toBe(Math.floor(h.clock.now / 1000) + h.config.validityWindowSeconds);
  });
});
