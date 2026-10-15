/**
 * Unit tests for `PolicyDb.resetSpendEvents` — the admin/debug reset used by
 * `src/cli/reset-spend-counters.ts` (see that file's and `resetSpendEvents`'s
 * own doc comments for why this exists: stale `sponsorship_events` rows from
 * before a cap fix can otherwise keep denying a sender under the CORRECTED
 * caps too, for reasons that have nothing to do with real usage).
 *
 * Every other `PolicyDb` behavior (cap ordering, denial reasons, the
 * circuit breaker) is already covered end-to-end via `PolicyEngine` in
 * policyEngine.test.ts; this file only covers the one method that's new.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { PolicyDb, type CapLimits, type RecordApprovalInput } from "../src/db.js";

const GENEROUS_LIMITS: CapLimits = {
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
let hashCounter = 0;
function freshHash(): Hex {
  hashCounter += 1;
  return `0x${hashCounter.toString(16).padStart(64, "0")}` as Hex;
}

function approvalInput(overrides: Partial<RecordApprovalInput> = {}): RecordApprovalInput {
  return {
    nowMs: T0,
    userId: "sender:0x0000000000000000000000000000000000000042",
    appId: "app-a",
    sender: "0x0000000000000000000000000000000000000042" as Address,
    targets: ["0x0000000000000000000000000000000000000001" as Address],
    worstCaseCostWei: 1_000n,
    userOpHash: freshHash(),
    finalHash: "0x0000000000000000000000000000000000000000000000000000000000000002" as Hex,
    validUntil: Math.floor(T0 / 1000) + 90,
    validAfter: 0,
    limits: GENEROUS_LIMITS,
    ...overrides,
  };
}

describe("PolicyDb.resetSpendEvents", () => {
  let db: PolicyDb;

  beforeEach(() => {
    db = new PolicyDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("deletes every sponsorship_events row when called with no filter, leaving audit_log intact", () => {
    const a = db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xaaa", appId: "app-a" }));
    const b = db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xbbb", appId: "app-b" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const auditCountBefore = db.listAudit(100).length;
    expect(auditCountBefore).toBeGreaterThanOrEqual(2);

    const deleted = db.resetSpendEvents();
    expect(deleted).toBe(2);

    // A third request from either sender, right up against a tight cap,
    // now succeeds again -- the whole point of this method: stale spend
    // no longer counts against the (now-corrected) caps.
    const tightLimits: CapLimits = { ...GENEROUS_LIMITS, userHourlySpendCapWei: 1_000n };
    const afterReset = db.recordApprovalIfWithinCaps(
      approvalInput({ userId: "sender:0xaaa", appId: "app-a", limits: tightLimits }),
    );
    expect(afterReset.ok).toBe(true);

    // audit_log (the permanent decision history) is untouched by the reset.
    expect(db.listAudit(100).length).toBe(auditCountBefore + 1);
  });

  it("scopes the reset to a single userId when --user is given, leaving other users' spend intact", () => {
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xaaa", appId: "app-a" }));
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xbbb", appId: "app-a" }));

    const deleted = db.resetSpendEvents({ userId: "sender:0xaaa" });
    expect(deleted).toBe(1);

    // 0xaaa's spend is gone -- a second approval for it succeeds even
    // against a cap too tight to allow two.
    const tightLimits: CapLimits = { ...GENEROUS_LIMITS, userHourlySpendCapWei: 1_500n };
    const aaaAgain = db.recordApprovalIfWithinCaps(
      approvalInput({ userId: "sender:0xaaa", appId: "app-a", limits: tightLimits, worstCaseCostWei: 1_000n }),
    );
    expect(aaaAgain.ok).toBe(true);

    // 0xbbb's prior spend is still counted -- a second approval for IT
    // against that same tight cap is denied.
    const bbbAgain = db.recordApprovalIfWithinCaps(
      approvalInput({ userId: "sender:0xbbb", appId: "app-a", limits: tightLimits, worstCaseCostWei: 1_000n }),
    );
    expect(bbbAgain.ok).toBe(false);
  });

  it("scopes the reset to a single appId when --app is given, leaving other apps' spend intact", () => {
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xaaa", appId: "app-a" }));
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xbbb", appId: "app-b" }));

    const deleted = db.resetSpendEvents({ appId: "app-a" });
    expect(deleted).toBe(1);

    const tightAppLimits: CapLimits = { ...GENEROUS_LIMITS, appDailySpendCapWei: 1_500n };
    const appAAgain = db.recordApprovalIfWithinCaps(
      approvalInput({ userId: "sender:0xccc", appId: "app-a", limits: tightAppLimits, worstCaseCostWei: 1_000n }),
    );
    expect(appAAgain.ok).toBe(true); // app-a's prior spend was cleared

    const appBAgain = db.recordApprovalIfWithinCaps(
      approvalInput({ userId: "sender:0xddd", appId: "app-b", limits: tightAppLimits, worstCaseCostWei: 1_000n }),
    );
    expect(appBAgain.ok).toBe(false); // app-b's prior spend still counts
  });

  it("combining --user and --app narrows to rows matching both", () => {
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xaaa", appId: "app-a" }));
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xaaa", appId: "app-b" }));
    db.recordApprovalIfWithinCaps(approvalInput({ userId: "sender:0xbbb", appId: "app-a" }));

    const deleted = db.resetSpendEvents({ userId: "sender:0xaaa", appId: "app-a" });
    expect(deleted).toBe(1);
  });

  it("returns 0 and touches nothing when there is nothing to delete", () => {
    expect(db.resetSpendEvents()).toBe(0);
    expect(db.resetSpendEvents({ userId: "sender:0xnobody" })).toBe(0);
  });

  it("never touches circuit_breaker_state's manual reset point", () => {
    // Move the breaker's counting window start to ts=2000.
    db.manuallyResetCircuitBreaker(2_000);
    // resetSpendEvents() must not revert that (there's nothing to delete
    // yet either -- exercises the "0 rows" path against a non-default
    // circuit_breaker_state row).
    expect(db.resetSpendEvents()).toBe(0);

    // Record an event BEFORE the manual-reset point (ts=1000 < 2000).
    const result = db.recordApprovalIfWithinCaps(approvalInput({ nowMs: 1_000, worstCaseCostWei: 5_000n }));
    expect(result.ok).toBe(true);

    // If manual_reset_at_ms were still 2000 (untouched), the breaker's
    // window start at "now"=3000 is max(startOfUtcDay(3000)=0, 2000)=2000,
    // so the ts=1000 event falls OUTSIDE the window and does not count ->
    // not tripped even against a ceiling of 1 wei. If resetSpendEvents had
    // reset manual_reset_at_ms back to its 0 default, the window start
    // would instead be 0, the ts=1000 event WOULD count, and this would be
    // tripped -- so this assertion fails if resetSpendEvents ever starts
    // touching circuit_breaker_state.
    expect(db.isCircuitBreakerTripped(3_000, 1n)).toBe(false);
  });
});

describe("PolicyDb idempotency and expiry voiding", () => {
  let db: PolicyDb;
  beforeEach(() => {
    db = new PolicyDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  const HASH_A = "0x00000000000000000000000000000000000000000000000000000000000000aa" as Hex;
  const tight = (extra: Partial<CapLimits>): CapLimits => ({ ...GENEROUS_LIMITS, ...extra });

  it("charges exactly once for two back-to-back calls with the same userOpHash", () => {
    const limits = tight({ userHourlySpendCapWei: 1_500n });
    const first = db.recordApprovalIfWithinCaps(approvalInput({ userOpHash: HASH_A, limits }));
    // Second call alone would exceed the 1_500 cap if it were charged again.
    const second = db.recordApprovalIfWithinCaps(approvalInput({ userOpHash: HASH_A, limits, nowMs: T0 + 66 }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Only one event: a different hash for 1_000 more is denied (1_000 + 1_000 > 1_500), proving one 1_000 charge.
    const other = db.recordApprovalIfWithinCaps(approvalInput({ limits }));
    expect(other.ok).toBe(false);
    expect(db.resetSpendEvents()).toBe(1);
  });

  it("the unique index rejects a duplicate user_op_hash row even if the pre-check were bypassed", () => {
    db.recordApprovalIfWithinCaps(approvalInput({ userOpHash: HASH_A }));
    // Past validUntil the pre-check no longer short-circuits; the unique index still protects the table.
    const later = db.recordApprovalIfWithinCaps(
      approvalInput({ userOpHash: HASH_A, nowMs: T0 + 10 * 60_000, validUntil: Math.floor(T0 / 1000) + 10 * 60 + 90 }),
    );
    expect(later.ok).toBe(true);
    expect(db.resetSpendEvents()).toBe(1);
  });

  it("an expired, never-executed approval stops counting toward spend caps", () => {
    const limits = tight({ userHourlySpendCapWei: 1_500n });
    db.recordApprovalIfWithinCaps(approvalInput({ limits }));
    // Still inside validUntil (T0+90s): counts, so a second 1_000 is denied.
    expect(db.recordApprovalIfWithinCaps(approvalInput({ limits, nowMs: T0 + 30_000 })).ok).toBe(false);
    // After validUntil (> T0+90s) the first approval is void: a new one fits.
    expect(
      db.recordApprovalIfWithinCaps(
        approvalInput({ limits, nowMs: T0 + 91_000, validUntil: Math.floor(T0 / 1000) + 91 + 90 }),
      ).ok,
    ).toBe(true);
  });

  it("an expired approval no longer counts toward count caps or the circuit breaker", () => {
    const limits = tight({ userHourlyCountCap: 1, globalDailySpendCeilingWei: 1_500n });
    db.recordApprovalIfWithinCaps(approvalInput({ limits }));
    const result = db.recordApprovalIfWithinCaps(
      approvalInput({ limits, nowMs: T0 + 120_000, validUntil: Math.floor(T0 / 1000) + 120 + 90 }),
    );
    expect(result.ok).toBe(true);
    expect(db.isCircuitBreakerTripped(T0 + 120_000, 1_500n)).toBe(false);
  });

  it("legacy rows without valid_until keep counting (migration keeps old DBs conservative)", () => {
    // Simulate a pre-migration row: no valid_until / user_op_hash.
    const raw = (db as unknown as { db: { exec(sql: string): void } }).db;
    raw.exec(
      `INSERT INTO sponsorship_events (ts_ms, user_id, app_id, sender, cost_wei) VALUES (${T0}, 'sender:0x0000000000000000000000000000000000000042', 'app-a', '0x42', '1000')`,
    );
    const limits = tight({ userHourlySpendCapWei: 1_500n });
    expect(db.recordApprovalIfWithinCaps(approvalInput({ limits, nowMs: T0 + 3_000_000 })).ok).toBe(false);
  });

  it("spend window boundary: an event exactly one hour old no longer counts; one just inside still does", () => {
    const HOUR = 3_600_000;
    const limits = tight({ userHourlySpendCapWei: 1_500n });
    // executed rows can't be set via the public API, so use a far-future validUntil to keep the row live.
    const farFuture = Math.floor(T0 / 1000) + 10_000;
    db.recordApprovalIfWithinCaps(approvalInput({ limits, validUntil: farFuture }));
    // 1ms inside the window: ts >= now - HOUR  => still counted => denied.
    expect(
      db.recordApprovalIfWithinCaps(approvalInput({ limits, nowMs: T0 + HOUR - 1, validUntil: farFuture })).ok,
    ).toBe(false);
    // Exactly at the boundary the window start equals ts_ms (>=): still counted.
    expect(
      db.recordApprovalIfWithinCaps(approvalInput({ limits, nowMs: T0 + HOUR, validUntil: farFuture })).ok,
    ).toBe(false);
    // 1ms past the boundary: dropped out of the trailing hour => approved.
    expect(
      db.recordApprovalIfWithinCaps(approvalInput({ limits, nowMs: T0 + HOUR + 1, validUntil: farFuture })).ok,
    ).toBe(true);
  });
});
