/**
 * v1 executed-marker reconciler: closes the "caps under-count after valid_until" gap by marking approvals
 * executed when the EntryPoint emits a UserOperationEvent for this paymaster.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { PolicyDb, type CapLimits, type RecordApprovalInput } from "../src/db.js";
import {
  ExecutedReconciler,
  type ExecutedChainReader,
  type UserOperationEventLog,
} from "../src/executedReconciler.js";

const PAYMASTER = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0" as Address;
const SENDER_A = "0x00000000000000000000000000000000000000aA" as Address;
const SENDER_B = "0x00000000000000000000000000000000000000Bb" as Address;

const LIMITS: CapLimits = {
  userHourlyCountCap: 1000,
  userDailyCountCap: 1000,
  userLifetimeCountCap: 1000,
  userHourlySpendCapWei: 10n ** 18n,
  userDailySpendCapWei: 10n ** 18n,
  userLifetimeSpendCapWei: 10n ** 18n,
  appDailySpendCapWei: 10n ** 18n,
  appLifetimeSpendCapWei: null,
  globalDailySpendCeilingWei: 10n ** 18n,
};

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const T0_SEC = Math.floor(T0 / 1000);
let n = 0;
const hash = (): Hex => `0x${(++n).toString(16).padStart(64, "0")}` as Hex;

function approve(db: PolicyDb, over: Partial<RecordApprovalInput> = {}): Hex {
  const userOpHash = over.userOpHash ?? hash();
  const sender = over.sender ?? SENDER_A;
  const result = db.recordApprovalIfWithinCaps({
    nowMs: T0,
    userId: `sender:${sender.toLowerCase()}`,
    appId: "app-a",
    sender,
    targets: [],
    worstCaseCostWei: 1_000n,
    userOpHash,
    finalHash: hash(),
    validUntil: T0_SEC + 90,
    validAfter: 0,
    limits: LIMITS,
    ...over,
  });
  expect(result.ok).toBe(true);
  return userOpHash;
}

/** In-memory chain: blocks have timestamps; events are placed in blocks. */
class FakeChain implements ExecutedChainReader {
  head = 100n;
  events: UserOperationEventLog[] = [];
  blockTs = new Map<bigint, number>();
  failNext = false;
  queries: Array<[bigint, bigint]> = [];
  async getBlockNumber() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("rpc down");
    }
    return this.head;
  }
  async getBlockTimestamp(b: bigint) {
    return this.blockTs.get(b) ?? T0_SEC + Number(b);
  }
  async getUserOperationEvents(_pm: Address, from: bigint, to: bigint) {
    this.queries.push([from, to]);
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }
  async getDeposit() {
    return 0n;
  }
}

function ev(over: Partial<UserOperationEventLog> = {}): UserOperationEventLog {
  return {
    userOpHash: hash(),
    sender: SENDER_A,
    success: true,
    actualGasCost: 400n,
    blockNumber: 50n,
    ...over,
  };
}

describe("ExecutedReconciler", () => {
  let db: PolicyDb;
  let chain: FakeChain;
  let rec: ExecutedReconciler;

  beforeEach(() => {
    db = new PolicyDb(":memory:");
    chain = new FakeChain();
    rec = new ExecutedReconciler({
      db,
      chain,
      paymaster: PAYMASTER,
      chunkBlocks: 40n,
      lookbackBlocks: 1_000n,
      confirmations: 2n,
      now: () => T0 + 5_000,
      log: () => undefined,
    });
  });
  afterEach(() => db.close());

  it("marks the approval executed so it keeps counting after valid_until", async () => {
    const h = approve(db);
    const afterExpiry = T0 + 200_000;
    // Unreconciled: once valid_until has passed the approval no longer counts.
    expect(db.isCircuitBreakerTripped(afterExpiry, 1n)).toBe(false);

    chain.events = [ev()];
    const summary = await rec.runOnce();
    expect(summary).toMatchObject({ events: 1, marked: 1, duplicate: 0, unmatched: 0 });
    expect(db.isExecuted(h)).toBe(true);
    // Executed rows keep counting toward the caps.
    expect(db.isCircuitBreakerTripped(afterExpiry, 1n)).toBe(true);
  });

  it("an expired, never-executed approval stays uncounted (not marked)", async () => {
    const h = approve(db);
    chain.events = [];
    await rec.runOnce();
    expect(db.isExecuted(h)).toBe(false);
    expect(db.isCircuitBreakerTripped(T0 + 200_000, 1n)).toBe(false);
  });

  it("is idempotent: re-scanning the same event never marks a second approval", async () => {
    const first = approve(db);
    const second = approve(db);
    chain.events = [ev()];
    await rec.runOnce();
    // Force a full overlap re-scan of the same range.
    db.setReconcilerState("executed_reconcile_next_block", "40");
    const again = await rec.runOnce();
    expect(again?.marked).toBe(0);
    expect(again?.duplicate).toBe(1);
    expect(db.isExecuted(first)).toBe(true);
    expect(db.isExecuted(second)).toBe(false);
  });

  it("matches per sender, oldest approval first", async () => {
    const aOld = approve(db, { nowMs: T0, sender: SENDER_A });
    const aNew = approve(db, { nowMs: T0 + 1_000, sender: SENDER_A });
    const bOnly = approve(db, { nowMs: T0, sender: SENDER_B });
    chain.events = [ev({ sender: SENDER_A }), ev({ sender: SENDER_B, blockNumber: 51n })];
    await rec.runOnce();
    expect(db.isExecuted(aOld)).toBe(true);
    expect(db.isExecuted(aNew)).toBe(false);
    expect(db.isExecuted(bOnly)).toBe(true);
  });

  it("matches case-insensitively on sender", async () => {
    const h = approve(db, { sender: SENDER_A });
    chain.events = [ev({ sender: SENDER_A.toLowerCase() as Address })];
    await rec.runOnce();
    expect(db.isExecuted(h)).toBe(true);
  });

  it("does not match an approval whose signature had already expired at the block timestamp", async () => {
    const h = approve(db, { validUntil: T0_SEC + 10 });
    chain.blockTs.set(50n, T0_SEC + 500);
    chain.events = [ev()];
    const summary = await rec.runOnce();
    expect(summary?.unmatched).toBe(1);
    expect(db.isExecuted(h)).toBe(false);
  });

  it("does not match an approval created after the block, or one whose worst-case cost is below the actual cost", async () => {
    const late = approve(db, { nowMs: T0 + 3_600_000 });
    const cheap = approve(db, { sender: SENDER_B, worstCaseCostWei: 100n });
    chain.events = [ev({ blockNumber: 50n }), ev({ sender: SENDER_B, actualGasCost: 5_000n, blockNumber: 51n })];
    const summary = await rec.runOnce();
    expect(summary).toMatchObject({ marked: 0, unmatched: 2 });
    expect(db.isExecuted(late)).toBe(false);
    expect(db.isExecuted(cheap)).toBe(false);
  });

  it("marks a reverted-but-included op (success=false) executed: the paymaster still paid", async () => {
    const h = approve(db);
    chain.events = [ev({ success: false })];
    await rec.runOnce();
    expect(db.isExecuted(h)).toBe(true);
  });

  it("reports unmatched events (paymaster paid with no recorded approval)", async () => {
    chain.events = [ev({ sender: SENDER_B })];
    const summary = await rec.runOnce();
    expect(summary?.unmatched).toBe(1);
  });

  it("advances the cursor to head - confirmations + 1 and the next run resumes with a small overlap", async () => {
    chain.head = 100n;
    await rec.runOnce();
    expect(rec.status().nextBlock).toBe("99");
    chain.queries = [];
    chain.head = 120n;
    await rec.runOnce();
    expect(chain.queries[0]?.[0]).toBe(97n); // 99 - overlap(2)
    expect(rec.status().nextBlock).toBe("119");
  });

  it("scans in chunks no larger than chunkBlocks", async () => {
    chain.head = 100n;
    await rec.runOnce(); // lookback 1000 > head, so it starts at 0; safe head is 98
    for (const [from, to] of chain.queries) expect(to - from + 1n).toBeLessThanOrEqual(40n);
    expect(chain.queries[0]?.[0]).toBe(0n);
    expect(chain.queries.at(-1)?.[1]).toBe(98n);
  });

  it("an RPC failure leaves the cursor untouched so the next run retries", async () => {
    await rec.runOnce();
    const cursor = rec.status().nextBlock;
    chain.failNext = true;
    await expect(rec.runOnce()).rejects.toThrow("rpc down");
    expect(rec.status().nextBlock).toBe(cursor);
  });

  it("uses startBlock for the first run when given", async () => {
    const r = new ExecutedReconciler({
      db,
      chain,
      paymaster: PAYMASTER,
      chunkBlocks: 1_000n,
      lookbackBlocks: 5n,
      startBlock: 60n,
      confirmations: 2n,
      log: () => undefined,
    });
    await r.runOnce();
    expect(chain.queries[0]?.[0]).toBe(60n);
  });

  it("does not run two scans concurrently", async () => {
    const a = rec.runOnce();
    const b = await rec.runOnce();
    expect(b).toBeNull();
    expect(await a).not.toBeNull();
  });

  it("survives a restart: reconciled hashes persist in the database", async () => {
    const h = approve(db);
    chain.events = [ev()];
    await rec.runOnce();
    const rec2 = new ExecutedReconciler({
      db,
      chain,
      paymaster: PAYMASTER,
      chunkBlocks: 1_000n,
      lookbackBlocks: 1_000n,
      confirmations: 2n,
      log: () => undefined,
    });
    db.setReconcilerState("executed_reconcile_next_block", "0");
    const summary = await rec2.runOnce();
    expect(summary).toMatchObject({ marked: 0, duplicate: 1 });
    expect(db.isExecuted(h)).toBe(true);
  });
});
