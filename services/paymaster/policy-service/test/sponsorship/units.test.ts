/** Unit tests: config flag/validation, rate limiter, db (tokens/nonces/sessions), reconciler, ABI drift. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { PEPU_SPONSORED_PAYMASTER_ABI } from "../../src/sponsorship/abi.js";
import { describeConfig, isSponsorshipV2Enabled, loadSponsorshipConfig } from "../../src/sponsorship/config.js";
import { SponsorshipDb } from "../../src/sponsorship/db.js";
import { RateLimiter } from "../../src/sponsorship/rateLimit.js";
import { Reconciler } from "../../src/sponsorship/reconciler.js";
import { createSponsorshipRuntime } from "../../src/sponsorship/runtime.js";
import { PEPU } from "./helpers/fakeChain.js";
import { freshOp, makeHarness } from "./helpers/harness.js";

const BASE_ENV = {
  SPONSORSHIP_V2_ENABLED: "true",
  SPONSORSHIP_V2_PAYMASTER_ADDRESS: "0x00000000000000000000000000000000000056aa",
  SPONSORSHIP_V2_RPC_URL: "https://rpc.example/KEY123",
  SPONSORSHIP_SIWE_DOMAINS: "dash.example.com",
  SPONSORSHIP_PUBLIC_BASE_URL: "https://pm.example.com/",
};

describe("config / feature flag", () => {
  it("is OFF by default and returns null without validating anything", () => {
    expect(isSponsorshipV2Enabled({})).toBe(false);
    expect(loadSponsorshipConfig({})).toBeNull();
    expect(loadSponsorshipConfig({ SPONSORSHIP_V2_ENABLED: "false", SPONSORSHIP_V2_PAYMASTER_ADDRESS: "garbage" })).toBeNull();
  });
  it("the runtime builds nothing when off (no DB file, no chain client)", () => {
    expect(createSponsorshipRuntime({ signerAccount: {} as never, privy: {} as never, defaultDbDir: "/nonexistent", env: {} })).toBeNull();
  });
  it("loads documented defaults: 50 PEPU/user/day, no ceiling or anonymous knobs, admin api off", () => {
    const c = loadSponsorshipConfig(BASE_ENV);
    expect(c?.freeTier.perUserDailyWei).toBe(50n * PEPU);
    expect(c?.freeTier).not.toHaveProperty("chainDailyCeilingWei");
    expect(c?.freeTier).not.toHaveProperty("anonPerSenderDailyWei");
    expect(c?.adminToken).toBeNull();
    expect(c?.publicBaseUrl).toBe("https://pm.example.com");
    expect(c?.paymasterVerificationGasLimit).toBe(200_000n);
    expect(c?.paymasterPostOpGasLimit).toBe(40_000n);
  });
  it("removed knobs (chain-wide ceiling, anonymous tier) are ignored even if still set in an old env file", () => {
    const c = loadSponsorshipConfig({ ...BASE_ENV, ANON_FREE_TIER_PER_SENDER_DAILY_WEI: "999", ANON_FREE_TIER_CHAIN_DAILY_CEILING_WEI: "999" });
    expect(JSON.stringify(c?.freeTier, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/ceiling|anon/i);
    expect(describeConfig(c as NonNullable<typeof c>)).toMatchObject({ freeTierRequiresPrivyToken: true });
  });
  it("refuses a postOp gas limit below the contract minimum", () => {
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_V2_PM_POST_OP_GAS_LIMIT: "39999" })).toThrow(/40000/);
    expect(loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_V2_PM_POST_OP_GAS_LIMIT: "40000" })?.paymasterPostOpGasLimit).toBe(40_000n);
  });
  it("every number is overridable", () => {
    const c = loadSponsorshipConfig({ ...BASE_ENV, FREE_TIER_PER_USER_DAILY_WEI: String(75n * PEPU), FREE_TIER_PER_USER_HOURLY_WEI: String(40n * PEPU), FREE_TIER_CHAIN_DAILY_CEILING_WEI: "5", PROJECT_DEFAULT_PER_USER_DAILY_WEI: "7" });
    expect(c?.freeTier.perUserDailyWei).toBe(75n * PEPU);
    expect(c?.project.defaultPerUserDailyWei).toBe(7n);
  });
  it("rejects bad input with clear errors", () => {
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_V2_PAYMASTER_ADDRESS: "0x12" })).toThrow(/address/);
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_ADMIN_TOKEN: "short" })).toThrow(/32/);
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_SIWE_DOMAINS: "" })).toThrow(/SIWE_DOMAINS/);
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, FREE_TIER_PER_USER_DAILY_WEI: "-1" })).toThrow();
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, FREE_TIER_PER_USER_HOURLY_WEI: String(99n * PEPU) })).toThrow(/HOURLY/);
    expect(() => loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_V2_RPC_URL: "" })).toThrow(/RPC/);
  });
  it("describeConfig never contains the RPC url or admin token", () => {
    const c = loadSponsorshipConfig({ ...BASE_ENV, SPONSORSHIP_ADMIN_TOKEN: "z".repeat(40) });
    const text = JSON.stringify(describeConfig(c as NonNullable<typeof c>));
    expect(text).not.toContain("KEY123");
    expect(text).not.toContain("zzzz");
  });
});

describe("RateLimiter", () => {
  it("allows max hits per window, then blocks, then recovers", () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 2 }, () => t);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(true);
    const blocked = rl.check("a");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rl.check("b").ok).toBe(true); // keys are independent
    t = 1001;
    expect(rl.check("a").ok).toBe(true);
  });
  it("bounds memory when many keys appear", () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 1, maxKeys: 50 });
    for (let i = 0; i < 500; i++) rl.check(`k${i}`);
    expect(rl.check("fresh").ok).toBe(true);
  });
});

describe("SponsorshipDb", () => {
  it("stores only the token hash and resolves by constant-time hash lookup", () => {
    const db = new SponsorshipDb(":memory:");
    const { token, project } = db.createFreeApp({ label: "x", perUserDailyCapWei: 1n, allowedDestinations: null, nowMs: 1 });
    expect(db.resolveByToken(token)?.key).toBe(project.key);
    expect(db.resolveByToken(token + "x")).toBeNull();
    expect(db.resolveByToken("")).toBeNull();
    expect(JSON.stringify(project, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(token);
  });
  it("issues a client token AND a server key for on-chain projects: both hashed, distinguishable, independently rotatable", () => {
    const db = new SponsorshipDb(":memory:");
    const pid = ("0x" + "ab".repeat(32)) as Hex;
    const { token, serverKey, project } = db.createOnchainProject({
      projectId: pid,
      appId: "app",
      owner: "0x00000000000000000000000000000000000000a1",
      perUserDailyCapWei: 1n,
      requireIdentity: false,
      allowedOrigins: ["https://a.example"],
      nowMs: 1,
    });
    expect(token).toMatch(/^ppt_/);
    expect(serverKey).toMatch(/^ppk_/);
    expect(db.resolveCredential(token)).toMatchObject({ kind: "client" });
    expect(db.resolveCredential(serverKey)).toMatchObject({ kind: "server" });
    expect(db.resolveCredential(serverKey)?.project.key).toBe(project.key);
    expect(db.resolveByToken(serverKey)).toBeNull(); // a server key is never accepted where only client tokens are
    expect(db.resolveCredential("ppk_nope")).toBeNull();
    expect(JSON.stringify(project, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(serverKey);
    const next = db.rotateServerKey(project.key, 2) as string;
    expect(db.resolveCredential(serverKey)).toBeNull();
    expect(db.resolveCredential(next)).toMatchObject({ kind: "server" });
    expect(db.resolveCredential(token)).toMatchObject({ kind: "client" }); // client token untouched
    // free-tier-only apps have no server key
    const free = db.createFreeApp({ label: "f", perUserDailyCapWei: 1n, allowedDestinations: null, nowMs: 1 });
    expect(db.rotateServerKey(free.project.key, 3)).toBeNull();
  });
  it("migrates a database created before server keys / origins existed", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const path = join(mkdtempSync(join(tmpdir(), "spdb-old-")), "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (key TEXT PRIMARY KEY, project_id TEXT UNIQUE, app_id TEXT NOT NULL, owner TEXT, token_hash TEXT UNIQUE, token_prefix TEXT, token_rotated_at INTEGER, status TEXT NOT NULL DEFAULT 'active', per_user_daily_cap_wei TEXT NOT NULL, require_identity INTEGER NOT NULL DEFAULT 0, allowed_destinations TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
    old.exec(`INSERT INTO projects (key, app_id, status, per_user_daily_cap_wei, created_at, updated_at) VALUES ('app:legacy', 'legacy', 'active', '1', 1, 1)`);
    old.close();
    const db = new SponsorshipDb(path);
    const p = db.getByKey("app:legacy");
    expect(p?.allowedOrigins).toEqual([]);
    expect(p?.serverKeyPrefix).toBeNull();
    const created = db.createOnchainProject({ projectId: ("0x" + "cd".repeat(32)) as Hex, appId: "n", owner: "0x00000000000000000000000000000000000000a1", perUserDailyCapWei: 1n, requireIdentity: false, nowMs: 2 });
    expect(db.resolveCredential(created.serverKey)?.kind).toBe("server");
    db.close();
  });
  it("nonces are single-use and expire; sessions expire and are revocable", () => {
    const db = new SponsorshipDb(":memory:");
    const { nonce } = db.createNonce(0, 10);
    expect(db.nonceIsLive(nonce, 5_000)).toBe(true);
    expect(db.consumeNonce(nonce, 5_000)).toBe(true);
    expect(db.consumeNonce(nonce, 5_000)).toBe(false);
    const n2 = db.createNonce(0, 10).nonce;
    expect(db.consumeNonce(n2, 11_000)).toBe(false);
    const { token } = db.createSession("0x00000000000000000000000000000000000000a1", 0, 60);
    expect(db.getSession(token, 59_000)?.address).toBe("0x00000000000000000000000000000000000000a1");
    expect(db.getSession(token, 61_000)).toBeNull();
    db.deleteSession(token);
    expect(db.getSession(token, 1)).toBeNull();
  });
  it("persists across reopen (survives restart)", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = join(mkdtempSync(join(tmpdir(), "spdb-")), "s.db");
    const a = new SponsorshipDb(path);
    const { token } = a.createFreeApp({ label: "persist", perUserDailyCapWei: 1n, allowedDestinations: null, nowMs: 1 });
    a.close();
    const b = new SponsorshipDb(path);
    expect(b.resolveByToken(token)?.appId).toBe("persist");
    b.close();
  });
});

describe("Reconciler", () => {
  async function approveOne() {
    const h = makeHarness();
    const { token } = h.addFreeApp();
    const r = await h.engine.evaluate({ appToken: token, privyToken: h.asUser("u"), userOp: freshOp() });
    if (r.status !== "approved") throw new Error("expected approval");
    return { h, ep: r.userOpHash, validUntil: r.validUntil };
  }
  const ev = (name: string, args: Record<string, unknown>, block: bigint) => ({ name, args, blockNumber: block, transactionHash: `0x${"ab".repeat(32)}` as Hex, logIndex: 0 });

  it("records the ACTUAL charge from UserOpSettled and is idempotent on re-scan", async () => {
    const { h, ep } = await approveOne();
    h.chain.events.push(ev("SponsorReserved", { userOpHash: ep, amount: 6n * PEPU }, 900n), ev("UserOpSettled", { userOpHash: ep, charged: 3n * PEPU, reserved: 6n * PEPU }, 901n));
    const rec = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 0 });
    const s1 = await rec.runOnce();
    expect(s1).toMatchObject({ reserved: 1, settled: 1 });
    expect(h.db.getUsageByEpHash(ep)).toMatchObject({ status: "settled", finalWei: 3n * PEPU, executed: true });
    h.chain.blockNumber = 1_010n;
    const s2 = await rec.runOnce(); // overlap rescan: no harm
    expect(s2?.voided).toBe(0);
    expect(h.db.getUsageByEpHash(ep)?.finalWei).toBe(3n * PEPU);
  });

  it("voids an approval that expired without ever being seen on-chain, but never one that was reserved (postOp-revert case)", async () => {
    const a = await approveOne();
    const b = await approveOne();
    // both signatures expire before the chain head timestamp; only `b` was seen on-chain (reserved, no settle)
    a.h.chain.blockTimestamp = a.validUntil + 10;
    const recA = new Reconciler({ db: a.h.db, chain: a.h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 0 });
    expect((await recA.runOnce())?.voided).toBe(1);
    expect(a.h.db.getUsageByEpHash(a.ep)?.status).toBe("voided");
    b.h.chain.events.push(ev("SponsorReserved", { userOpHash: b.ep, amount: 6n * PEPU }, 950n));
    b.h.chain.blockTimestamp = b.validUntil + 10;
    const recB = new Reconciler({ db: b.h.db, chain: b.h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 0 });
    expect((await recB.runOnce())?.voided).toBe(0);
    expect(b.h.db.getUsageByEpHash(b.ep)?.status).toBe("approved");
  });

  it("does not void while the signature could still be used, and keeps its cursor on RPC failure", async () => {
    const { h, ep, validUntil } = await approveOne();
    h.chain.blockTimestamp = validUntil - 5;
    const rec = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 500n, voidSafetyMarginSeconds: 30 });
    expect((await rec.runOnce())?.voided).toBe(0);
    const cursor = rec.status().nextBlock;
    h.chain.failReads = true;
    await expect(rec.runOnce()).rejects.toThrow();
    expect(rec.status().nextBlock).toBe(cursor);
    expect(h.db.getUsageByEpHash(ep)?.status).toBe("approved");
  });
});

describe("ABI drift guard", () => {
  it("src/sponsorship/abi.ts matches contracts/out after a rebuild (skipped when the contract is not built)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const artifact = join(here, "../../../contracts/out/PepuSponsoredPaymasterV7.sol/PepuSponsoredPaymasterV7.json");
    if (!existsSync(artifact)) return;
    const built = JSON.parse(readFileSync(artifact, "utf8")).abi as unknown;
    expect(PEPU_SPONSORED_PAYMASTER_ABI).toEqual(built);
  });
});
