/**
 * Regression tests for internal review #3 (services/paymaster/audits/2026-10-review-3.md), service side. The auditors'
 * PoCs (audit C: ERC-4337 conformance and the signer service) are adapted here so the ATTACK NOW FAILS:
 *   L-4  replacing an approval for the same (sender, nonce) must not undercount signed exposure (C PoC 1 and 1b)
 *   L-1  the service mirrors the contract: a project with no per-wallet limit is not sponsorable (C-L4)
 *   L-5  allowAccountDeployment=false is enforced by the engine, so POST /v2/sponsor cannot bypass it (C PoC 3)
 *   M-3  unknown-credential denials are not persisted; audit retention (C PoC 2, engine and reconciler halves)
 * The HTTP halves of M-3 / L-5 / C-L1 live in api.test.ts ("review 3 regressions").
 */
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { statusForSponsorshipReason } from "../../src/sponsorship/engine.js";
import { Reconciler } from "../../src/sponsorship/reconciler.js";
import { PEPU } from "./helpers/fakeChain.js";
import { ORIGIN, buildUserOp, makeHarness } from "./helpers/harness.js";

const FREE = `0x${"00".repeat(32)}` as Hex;
const fakeSender = (i: number): Hex => `0x${(0x2000 + i).toString(16).padStart(40, "0")}`;
const CHEAP = { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };

describe("L-4: replacing an approval for the same (sender, nonce) keeps the larger reservation", () => {
  it("free tier (C PoC 1): alternating expensive / cheap requests no longer hold more live exposure than the per-user cap allows", async () => {
    const h = makeHarness();
    const { token } = h.addFreeApp();
    const priv = h.asUser("alice");
    const evalOp = (userOp: ReturnType<typeof buildUserOp>) => h.engine.evaluate({ appToken: token, origin: null, clientIp: "198.51.100.1", privyToken: priv, userOp });

    // baseline: an honest sequence of expensive ops is stopped by the hourly cap (30 PEPU = 5 ops of 5.98)
    const honest = makeHarness();
    const ht = honest.addFreeApp().token;
    const hp = honest.asUser("alice");
    let honestApproved = 0;
    for (let n = 1; n <= 40; n++) {
      const r = await honest.engine.evaluate({ appToken: ht, origin: null, clientIp: "198.51.100.1", privyToken: hp, userOp: buildUserOp({ nonce: BigInt(n) }) });
      if (r.status === "approved") honestApproved++;
    }
    expect(honestApproved).toBe(5);

    // attack: ask for the expensive op (A) and immediately re-ask the SAME (sender, nonce) with a ~free op (B)
    const live: { cost: bigint; validUntil: number }[] = [];
    for (let n = 1; n <= 40; n++) {
      const a = await evalOp(buildUserOp({ nonce: BigInt(n) }));
      if (a.status !== "approved") break;
      live.push({ cost: BigInt(a.maxCostWei), validUntil: a.validUntil });
      await evalOp(buildUserOp({ nonce: BigInt(n), ...CHEAP }));
    }
    const exposure = live.reduce((s, x) => s + x.cost, 0n);
    const seen = h.db.freeIdentitySpendWei("privy:alice", 0);
    expect(live.length).toBe(honestApproved); // the attack gains nothing over an honest client
    expect(exposure).toBeLessThanOrEqual(h.config.freeTier.perUserHourlyWei);
    expect(seen).toBeGreaterThanOrEqual(exposure); // the caps SEE every live expensive signature
    expect(h.db.outstandingReservedWei(FREE, h.clock.now)).toBeGreaterThanOrEqual(exposure);
  });

  it("project + client token (C PoC 1b): approved exposure cannot exceed the project's balance, and the mirror counts it all", async () => {
    const h = makeHarness();
    const { token, projectId } = h.addProject({ balance: 100n * PEPU, dailyLimit: 1000n * PEPU });
    let totalA = 0n;
    for (let s = 0; s < 12; s++) {
      for (let n = 1; n <= 2; n++) {
        const a = await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.9", privyToken: null, userOp: buildUserOp({ sender: fakeSender(s), nonce: BigInt(n) }) });
        if (a.status !== "approved") continue;
        totalA += BigInt(a.maxCostWei);
        await h.engine.evaluate({ appToken: token, origin: ORIGIN, clientIp: "198.51.100.9", privyToken: null, userOp: buildUserOp({ sender: fakeSender(s), nonce: BigInt(n), ...CHEAP }) });
      }
    }
    expect(totalA).toBeLessThanOrEqual(100n * PEPU);
    expect(totalA).toBeGreaterThan(0n);
    const held = h.db.outstandingReservedForClientCredentialWei(projectId, h.clock.now);
    expect(held).toBeGreaterThanOrEqual(totalA);
  });

  it("a request that is at least as large replaces (voids) the earlier one; a smaller one leaves the earlier one live", async () => {
    const h = makeHarness();
    const { serverKey, projectId } = h.addProject();
    const op = (over = {}) => buildUserOp({ sender: fakeSender(1), nonce: 7n, ...over });
    const a = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: op() });
    const bigger = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: op({ maxFeePerGas: 20_000n * 10n ** 9n }) });
    if (a.status !== "approved" || bigger.status !== "approved") throw new Error("expected approvals");
    // bigger >= earlier: the earlier one is voided, only the bigger counts
    expect(h.db.getUsageByEpHash(a.userOpHash)?.status).toBe("voided");
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBe(BigInt(bigger.maxCostWei));
    const smaller = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: op(CHEAP) });
    if (smaller.status !== "approved") throw new Error("expected approval");
    // smaller < earlier: the larger approval stays live until its own valid_until
    expect(h.db.getUsageByEpHash(bigger.userOpHash)?.status).toBe("approved");
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBeGreaterThanOrEqual(BigInt(bigger.maxCostWei));
    // after the larger signature expires it stops counting (the reconciler then voids it)
    h.clock.now += 120_000;
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBe(0n);
  });

  it("an equal-size re-request replaces the earlier one (idempotent clients do not stack reservations)", async () => {
    const h = makeHarness();
    const { serverKey, projectId } = h.addProject();
    const first = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: buildUserOp({ nonce: 3n }) });
    h.clock.now += 1_000; // a later request signs a different window, so it is a different approval
    const second = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: buildUserOp({ nonce: 3n }) });
    if (first.status !== "approved" || second.status !== "approved") throw new Error("expected approvals");
    expect(h.db.outstandingReservedWei(projectId, h.clock.now)).toBe(BigInt(second.maxCostWei));
  });
});

describe("L-1: the service mirrors the contract's fail-closed per-wallet limit", () => {
  it("a project whose on-chain senderDailyLimit is 0 is denied with project_sender_limit_not_set (403)", async () => {
    const h = makeHarness();
    const { serverKey, project } = h.addProject({ senderDailyLimit: 0n });
    const r = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: buildUserOp({ nonce: 1n }) });
    expect(r).toMatchObject({ status: "denied", reason: "project_sender_limit_not_set" });
    expect(statusForSponsorshipReason("project_sender_limit_not_set")).toBe(403);
    expect(h.db.listUsage(project.key, 10)).toHaveLength(0);
    // once the owner sets a limit the same request is sponsored
    h.chain.setProject(project.projectId as Hex, { senderDailyLimit: 1_000n * PEPU });
    expect(await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: buildUserOp({ nonce: 2n }) })).toMatchObject({ status: "approved" });
  });

  it("the free pool keeps 0 = no per-sender limit (only projects fail closed)", async () => {
    const h = makeHarness();
    h.chain.freeConfig = { ...h.chain.freeConfig, senderDailyLimit: 0n };
    const { token } = h.addFreeApp();
    const r = await h.engine.evaluate({ appToken: token, privyToken: h.asUser("u"), userOp: buildUserOp({ nonce: 1n }) });
    expect(r).toMatchObject({ status: "approved" });
  });
});

describe("L-5: allowAccountDeployment=false is enforced by the engine (REST and ERC-7677 alike)", () => {
  const factoryOp = (nonce: bigint) => buildUserOp({ nonce, factory: "0x0000000000000000000000000000000000000f00", factoryData: "0xdeadbeef" });

  it("denies a factory op with account_deployment_disabled (403) and records nothing", async () => {
    const h = makeHarness({ allowAccountDeployment: false });
    const { serverKey, project } = h.addProject();
    const r = await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: factoryOp(1n) });
    expect(r).toMatchObject({ status: "denied", reason: "account_deployment_disabled" });
    expect(statusForSponsorshipReason("account_deployment_disabled")).toBe(403);
    expect(h.db.listUsage(project.key, 10)).toHaveLength(0);
    // an already-deployed account is unaffected
    expect(await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: buildUserOp({ nonce: 2n }) })).toMatchObject({ status: "approved" });
  });

  it("factory ops are sponsored when the switch is on", async () => {
    const h = makeHarness({ allowAccountDeployment: true });
    const { serverKey } = h.addProject();
    expect(await h.engine.evaluate({ appToken: serverKey, privyToken: null, userOp: factoryOp(1n) })).toMatchObject({ status: "approved" });
  });
});

describe("M-3: audit retention runs on the reconciler timer", () => {
  it("prunes audit_log_v2 rows older than the retention window, at most hourly", async () => {
    const h = makeHarness();
    const day = 86_400_000;
    const now = h.clock.now;
    const row = (tsMs: number) => h.db.appendAudit({ tsMs, decision: "denied", reason: "app_suspended", projectKey: null, sponsor: null, identityKey: null, sender: null, targets: [], maxCostWei: null, epHash: null, detail: null });
    row(now - 40 * day);
    row(now - 31 * day);
    row(now - 29 * day);
    row(now - day);
    expect(h.db.listAudit(10)).toHaveLength(4);
    const clock = { now };
    const rec = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 0, auditRetentionMs: 30 * day, now: () => clock.now });
    const s1 = await rec.runOnce();
    expect(s1?.auditPruned).toBe(2);
    expect(h.db.listAudit(10)).toHaveLength(2);
    // inside the hour nothing more is pruned, even for a newly aged row
    row(clock.now - 31 * day);
    expect((await rec.runOnce())?.auditPruned).toBe(0);
    clock.now += 2 * 3_600_000;
    expect((await rec.runOnce())?.auditPruned).toBe(1);
  });

  it("keeps everything when no retention is configured", async () => {
    const h = makeHarness();
    h.db.appendAudit({ tsMs: 1, decision: "denied", reason: "x", projectKey: null, sponsor: null, identityKey: null, sender: null, targets: [], maxCostWei: null, epHash: null, detail: null });
    const rec = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 0 });
    expect((await rec.runOnce())?.auditPruned).toBe(0);
    expect(h.db.listAudit(10)).toHaveLength(1);
  });
});
