/**
 * Persistence layer, built on Node's built-in `node:sqlite` (`DatabaseSync`).
 * Confirmed working synchronously on this machine's Node v24.4.1 in this
 * session (prints an `ExperimentalWarning` on import — expected, harmless,
 * see README). Chosen specifically to avoid `better-sqlite3`'s node-gyp
 * native build step, which is a real pain point on Windows.
 *
 * Design notes:
 *
 * - All cap/spend accounting is event-sourced: every APPROVED sponsorship
 *   writes one row to `sponsorship_events` (never denials — denials must
 *   never consume budget). Hourly/daily/lifetime counts and spend are
 *   computed by querying this table with a time-window filter, rather than
 *   maintained as separately-updated running counters. This trades a little
 *   query cost for correctness: no separate "reset the counter" logic to
 *   get wrong, and it directly satisfies the "survives a restart" and
 *   "auditable" requirements from the same table.
 *
 * - Per-USER hourly/daily caps use a trailing ROLLING window (now - 3600s /
 *   now - 86400s), not calendar-day buckets — this is deliberately tighter
 *   than a UTC-midnight reset (a user can't "reset" their daily cap early by
 *   waiting for midnight). Per-APP daily spend and the GLOBAL circuit
 *   breaker use calendar-day UTC, per the brief's explicit allowance
 *   ("calendar-day UTC rollover is fine" — Part 2 step 7). This asymmetry is
 *   intentional and documented again in README "Rolling vs calendar-day
 *   windows".
 *
 * - Monetary sums are done in JS with BigInt after fetching rows, never via
 *   SQL SUM() — sqlite's SUM uses floating point internally, which is not
 *   safe for wei-precision values that can exceed 2^53.
 *
 * - Atomicity: `recordApprovalIfWithinCaps` reads current counters, compares
 *   against caps, and inserts the new event/audit rows, all synchronously
 *   (node:sqlite's DatabaseSync API is fully synchronous) with zero `await`
 *   in between — Node's single-threaded event loop means no other request's
 *   JS can interleave partway through, which is what actually makes this
 *   safe under concurrent requests within one process. It's still wrapped in
 *   an explicit SQL transaction for crash-safety (all-or-nothing if the
 *   process dies mid-write), not for concurrency.
 *
 * - `DatabaseSync` is fetched via `process.getBuiltinModule("node:sqlite")`
 *   rather than a plain `import { DatabaseSync } from "node:sqlite"`. These
 *   are behaviorally identical in production (Node's real ESM loader
 *   resolves "node:sqlite" as a builtin either way — confirmed directly in
 *   this session). The difference only matters under this test suite's
 *   runner: vitest 2.1.9 / vite-node's builtin-detection (`isNodeBuiltin` in
 *   vite-node's `utils.mjs`) hardcodes a small exception list for
 *   prefix-only built-ins (`node:test`) that predates `node:sqlite`'s
 *   existence, so a static `import "node:sqlite"` gets misresolved as a
 *   missing bare npm package named "sqlite" and the whole test file fails
 *   to load — confirmed by reproducing the exact failure in this session,
 *   tracing it into vite-node's own source, and confirming no public config
 *   option (server.deps.external, as either a string or a RegExp) changes
 *   the outcome. `process.getBuiltinModule` is a plain runtime function
 *   call with a string argument, invisible to any bundler/test-runner's
 *   static import analysis, so it sidesteps the bug entirely rather than
 *   working around it. Available since Node 22.3 (this package requires
 *   Node >=22.5 already, per package.json's `engines` field).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Address, Hex } from "viem";
import type { AuditLogEntry, DenialReason } from "./types.js";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface CapLimits {
  userHourlyCountCap: number;
  userDailyCountCap: number;
  userLifetimeCountCap: number;
  userHourlySpendCapWei: bigint;
  userDailySpendCapWei: bigint;
  userLifetimeSpendCapWei: bigint;
  appDailySpendCapWei: bigint;
  appLifetimeSpendCapWei: bigint | null;
  globalDailySpendCeilingWei: bigint;
}

export interface RecordApprovalInput {
  nowMs: number;
  userId: string;
  appId: string;
  sender: Address;
  targets: readonly Address[];
  worstCaseCostWei: bigint;
  userOpHash: Hex;
  finalHash: Hex;
  validUntil: number;
  validAfter: number;
  limits: CapLimits;
}

export type RecordApprovalResult =
  | { ok: true }
  | { ok: false; reason: DenialReason; message: string };

function startOfUtcDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class PolicyDb {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sponsorship_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        cost_wei TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_user_ts ON sponsorship_events (user_id, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_events_app_ts ON sponsorship_events (app_id, ts_ms);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        user_id TEXT,
        app_id TEXT,
        sender TEXT,
        targets_json TEXT NOT NULL,
        worst_case_cost_wei TEXT,
        user_op_hash TEXT,
        final_hash TEXT,
        valid_until INTEGER,
        valid_after INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts_ms);

      CREATE TABLE IF NOT EXISTS circuit_breaker_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        manual_reset_at_ms INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO circuit_breaker_state (id, manual_reset_at_ms) VALUES (1, 0);

      -- v1 executed-marker reconciler (src/executedReconciler.ts)
      CREATE TABLE IF NOT EXISTS reconciler_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reconciled_user_ops (
        ep_user_op_hash TEXT PRIMARY KEY,
        event_id INTEGER,
        sender TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_ts_sec INTEGER NOT NULL,
        actual_gas_cost_wei TEXT NOT NULL,
        success INTEGER NOT NULL,
        reconciled_at_ms INTEGER NOT NULL
      );
    `);
    this.migrateSponsorshipEvents();
  }

  /**
   * Additive migration for DBs created before idempotency / expiry-voiding:
   * adds user_op_hash, valid_until, voided, executed to sponsorship_events.
   * Legacy rows keep NULL user_op_hash / valid_until and so keep counting
   * exactly as before (they never expire out of the sums).
   */
  private migrateSponsorshipEvents(): void {
    const cols = (
      this.db.prepare(`PRAGMA table_info(sponsorship_events)`).all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("user_op_hash")) this.db.exec(`ALTER TABLE sponsorship_events ADD COLUMN user_op_hash TEXT`);
    if (!cols.includes("valid_until")) this.db.exec(`ALTER TABLE sponsorship_events ADD COLUMN valid_until INTEGER`);
    if (!cols.includes("voided")) this.db.exec(`ALTER TABLE sponsorship_events ADD COLUMN voided INTEGER NOT NULL DEFAULT 0`);
    if (!cols.includes("executed")) this.db.exec(`ALTER TABLE sponsorship_events ADD COLUMN executed INTEGER NOT NULL DEFAULT 0`);
    // Unique index = cross-connection/process backstop for "one charge per userOpHash".
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_user_op_hash ON sponsorship_events (user_op_hash) WHERE user_op_hash IS NOT NULL`,
    );
  }

  /**
   * SQL predicate for events that still count toward caps at `nowMs`: not
   * voided, and either confirmed executed, legacy (no valid_until), or whose
   * paymaster signature is still usable on-chain (valid_until in the future).
   */
  private static readonly COUNTED = `voided = 0 AND (executed = 1 OR valid_until IS NULL OR valid_until * 1000 > ?)`;

  /** Expose only for tests that need to prove a restart survives. Do not use in app code. */
  close(): void {
    this.db.close();
  }

  /** Readiness probe: proves the database handle is open and answers a query. Throws if not. */
  ping(): void {
    const row = this.db.prepare(`SELECT 1 AS ok`).get() as { ok: number } | undefined;
    if (row?.ok !== 1) throw new Error("database ping returned an unexpected result");
  }

  getReconcilerState(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM reconciler_state WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setReconcilerState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO reconciler_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /**
   * Records that the EntryPoint emitted a UserOperationEvent for this paymaster and, if it can be
   * attributed to a recorded approval, marks that approval executed (so it keeps counting toward
   * caps after its signature's valid_until passes).
   *
   * Why attribution is by sender and not by hash: `sponsorship_events.user_op_hash` is the
   * PAYMASTER's hash (signature excluded), while the event carries the EntryPoint's userOpHash
   * (signature included); the two differ and the service does not store paymasterAndData. So the
   * match is: same sender, not yet executed, approved before the block (small clock-skew allowance),
   * signature not yet expired at the block's timestamp (the paymaster enforces valid_until on-chain),
   * and recorded worst-case cost >= the event's actual cost (worst case is an upper bound). Oldest
   * approval first. A voided row that turns out to have executed is un-voided: the paymaster was charged.
   *
   * Idempotent per EntryPoint hash: replaying the same event is a "duplicate" no-op. An event that
   * matches no approval is recorded as "unmatched" (also a no-op for caps): that means the paymaster
   * paid for an op this service has no approval for, which operators should investigate.
   */
  recordChainExecution(input: {
    epUserOpHash: Hex;
    sender: Address;
    blockNumber: bigint;
    blockTimestampSec: number;
    actualGasCostWei: bigint;
    success: boolean;
    nowMs: number;
    clockSkewMs?: number;
  }): "marked" | "duplicate" | "unmatched" {
    const skewMs = input.clockSkewMs ?? 5_000;
    const hashKey = input.epUserOpHash.toLowerCase();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const seen = this.db
        .prepare(`SELECT 1 AS x FROM reconciled_user_ops WHERE ep_user_op_hash = ?`)
        .get(hashKey);
      if (seen !== undefined) {
        this.db.exec("COMMIT");
        return "duplicate";
      }
      const candidates = this.db
        .prepare(
          `SELECT id, cost_wei FROM sponsorship_events
           WHERE lower(sender) = ? AND executed = 0 AND ts_ms <= ?
             AND (valid_until IS NULL OR valid_until >= ?)
           ORDER BY ts_ms ASC, id ASC`,
        )
        .all(input.sender.toLowerCase(), input.blockTimestampSec * 1000 + skewMs, input.blockTimestampSec) as {
        id: number;
        cost_wei: string;
      }[];
      const match = candidates.find((c) => BigInt(c.cost_wei) >= input.actualGasCostWei);
      if (match) {
        this.db.prepare(`UPDATE sponsorship_events SET executed = 1, voided = 0 WHERE id = ?`).run(match.id);
      }
      this.db
        .prepare(
          `INSERT INTO reconciled_user_ops
            (ep_user_op_hash, event_id, sender, block_number, block_ts_sec, actual_gas_cost_wei, success, reconciled_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          hashKey,
          match ? match.id : null,
          input.sender.toLowerCase(),
          Number(input.blockNumber),
          input.blockTimestampSec,
          input.actualGasCostWei.toString(),
          input.success ? 1 : 0,
          input.nowMs,
        );
      this.db.exec("COMMIT");
      return match ? "marked" : "unmatched";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Test/ops helper: executed flag for an approval row looked up by the paymaster hash. */
  isExecuted(userOpHash: Hex): boolean | null {
    const row = this.db
      .prepare(`SELECT executed FROM sponsorship_events WHERE user_op_hash = ?`)
      .get(userOpHash) as { executed: number } | undefined;
    return row ? row.executed === 1 : null;
  }

  appendAudit(entry: AuditLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_log
          (ts_ms, decision, reason, user_id, app_id, sender, targets_json, worst_case_cost_wei,
           user_op_hash, final_hash, valid_until, valid_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.tsMs,
        entry.decision,
        entry.reason,
        entry.userId,
        entry.appId,
        entry.sender,
        JSON.stringify(entry.targets),
        entry.worstCaseCostWei,
        entry.userOpHash,
        entry.finalHash,
        entry.validUntil,
        entry.validAfter,
      );
  }

  listAudit(limit = 100): AuditLogEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      tsMs: row.ts_ms as number,
      decision: row.decision as "approved" | "denied",
      reason: row.reason as string,
      userId: (row.user_id as string) ?? null,
      appId: (row.app_id as string) ?? null,
      sender: (row.sender as Address) ?? null,
      targets: JSON.parse(row.targets_json as string) as Address[],
      worstCaseCostWei: (row.worst_case_cost_wei as string) ?? null,
      userOpHash: (row.user_op_hash as Hex) ?? null,
      finalHash: (row.final_hash as Hex) ?? null,
      validUntil: (row.valid_until as number) ?? null,
      validAfter: (row.valid_after as number) ?? null,
    }));
  }

  private sumCostWei(rows: { cost_wei: string }[]): bigint {
    let total = 0n;
    for (const row of rows) total += BigInt(row.cost_wei);
    return total;
  }

  private userEventsSince(userId: string, sinceMs: number, nowMs: number): { cost_wei: string }[] {
    return this.db
      .prepare(`SELECT cost_wei FROM sponsorship_events WHERE user_id = ? AND ts_ms >= ? AND ${PolicyDb.COUNTED}`)
      .all(userId, sinceMs, nowMs) as { cost_wei: string }[];
  }

  private userEventCountSince(userId: string, sinceMs: number, nowMs: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM sponsorship_events WHERE user_id = ? AND ts_ms >= ? AND ${PolicyDb.COUNTED}`)
      .get(userId, sinceMs, nowMs) as { n: number };
    return row.n;
  }

  private appEventsSince(appId: string, sinceMs: number, nowMs: number): { cost_wei: string }[] {
    return this.db
      .prepare(`SELECT cost_wei FROM sponsorship_events WHERE app_id = ? AND ts_ms >= ? AND ${PolicyDb.COUNTED}`)
      .all(appId, sinceMs, nowMs) as { cost_wei: string }[];
  }

  private globalSpendSince(sinceMs: number, nowMs: number): bigint {
    const rows = this.db
      .prepare(`SELECT cost_wei FROM sponsorship_events WHERE ts_ms >= ? AND ${PolicyDb.COUNTED}`)
      .all(sinceMs, nowMs) as { cost_wei: string }[];
    return this.sumCostWei(rows);
  }

  private manualBreakerResetAtMs(): number {
    const row = this.db
      .prepare(`SELECT manual_reset_at_ms FROM circuit_breaker_state WHERE id = 1`)
      .get() as { manual_reset_at_ms: number };
    return row.manual_reset_at_ms;
  }

  /**
   * The window start used for the global circuit breaker's spend sum: the
   * later of (start of today UTC) and (last manual reset). This makes a
   * manual admin "clear" and the natural UTC-midnight rollover the same
   * mechanism — see module doc comment above.
   */
  private circuitBreakerWindowStartMs(nowMs: number): number {
    return Math.max(startOfUtcDayMs(nowMs), this.manualBreakerResetAtMs());
  }

  /** Read-only check: is the global circuit breaker currently tripped? */
  isCircuitBreakerTripped(nowMs: number, ceilingWei: bigint): boolean {
    const spend = this.globalSpendSince(this.circuitBreakerWindowStartMs(nowMs), nowMs);
    return spend >= ceilingWei;
  }

  /** Admin action: clears the breaker by resetting its counting window to "now". Testable, no redeploy needed. */
  manuallyResetCircuitBreaker(nowMs: number): void {
    this.db
      .prepare(`UPDATE circuit_breaker_state SET manual_reset_at_ms = ? WHERE id = 1`)
      .run(nowMs);
  }

  /**
   * Admin/debug action: clears per-user/per-sender AND per-app spend and
   * count history by deleting rows from `sponsorship_events` — the one
   * table every rolling-window per-user cap check and every per-app/
   * calendar-day sum is computed from (see this module's doc comment on
   * the event-sourced design). Under that design, deleting the
   * contributing rows *is* "resetting the counters" — there is no
   * separate counter to zero out.
   *
   * Deliberately does NOT touch `audit_log`: that table is the permanent
   * decision history (every approval AND denial, with its reason), useful
   * evidence if anything needs investigating later, and clearing spend
   * counters must never be confused with destroying that trail. It also
   * does not touch `circuit_breaker_state` — use
   * `manuallyResetCircuitBreaker` (above) for the global breaker, exactly
   * as the existing `POST /admin/circuit-breaker/reset` /
   * `npm run reset-circuit-breaker` tooling already does; this method is
   * only for the per-user/sender/app spend history the global breaker
   * doesn't cover.
   *
   * With no filter (or an empty one), clears EVERY sender/user's and
   * EVERY app's spend/count history. Pass `userId` and/or `appId` to scope
   * the reset instead (both may be combined; each narrows independently).
   * Returns the number of rows deleted.
   */
  resetSpendEvents(filter?: { userId?: string; appId?: string }): number {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter?.appId) {
      clauses.push("app_id = ?");
      params.push(filter.appId);
    }
    const sql =
      clauses.length > 0
        ? `DELETE FROM sponsorship_events WHERE ${clauses.join(" AND ")}`
        : `DELETE FROM sponsorship_events`;
    const result = this.db.prepare(sql).run(...params);
    return Number(result.changes);
  }

  private hasLiveApprovalForHash(userOpHash: Hex, nowMs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS x FROM sponsorship_events WHERE user_op_hash = ? AND voided = 0 AND (valid_until IS NULL OR valid_until * 1000 > ?)`,
      )
      .get(userOpHash, nowMs);
    return row !== undefined;
  }

  /**
   * The full Part-2-step-5..9 gate: checks every cap in order (cheapest /
   * most user-specific first, global breaker last), and — only if every
   * check passes — atomically records the approval event and audit row in
   * one transaction. Returns the specific reason for the first cap that
   * would be exceeded, or `{ ok: true }`. Also writes a "denied" audit row
   * itself when it returns a failure, so callers don't need to.
   */
  recordApprovalIfWithinCaps(input: RecordApprovalInput): RecordApprovalResult {
    const { nowMs, userId, appId, sender, targets, worstCaseCostWei, limits } = input;

    const deny = (reason: DenialReason, message: string): RecordApprovalResult => {
      this.appendAudit({
        tsMs: nowMs,
        decision: "denied",
        reason,
        userId,
        appId,
        sender,
        targets,
        worstCaseCostWei: worstCaseCostWei.toString(),
        userOpHash: input.userOpHash,
        finalHash: input.finalHash,
        validUntil: input.validUntil,
        validAfter: input.validAfter,
      });
      return { ok: false, reason, message };
    };

    // --- idempotency: same userOpHash, still-valid, non-voided => already charged ---
    // The browser may run the sponsor flow twice in parallel (identical hash).
    // The whole method is synchronous (no await between this read and the
    // insert below), so within one process nothing can interleave; the unique
    // index on user_op_hash backstops other connections/processes.
    if (this.hasLiveApprovalForHash(input.userOpHash, nowMs)) return { ok: true };

    // --- per-user counts (rolling windows) ---
    const userHourCount = this.userEventCountSince(userId, nowMs - HOUR_MS, nowMs);
    if (userHourCount + 1 > limits.userHourlyCountCap) {
      return deny(
        "user_hourly_count_cap_exceeded",
        `user ${userId} would have ${userHourCount + 1} sponsorships in the trailing hour, cap is ${limits.userHourlyCountCap}`,
      );
    }
    const userDayCount = this.userEventCountSince(userId, nowMs - DAY_MS, nowMs);
    if (userDayCount + 1 > limits.userDailyCountCap) {
      return deny(
        "user_daily_count_cap_exceeded",
        `user ${userId} would have ${userDayCount + 1} sponsorships in the trailing day, cap is ${limits.userDailyCountCap}`,
      );
    }
    const userLifetimeCount = this.userEventCountSince(userId, 0, nowMs);
    if (userLifetimeCount + 1 > limits.userLifetimeCountCap) {
      return deny(
        "user_lifetime_count_cap_exceeded",
        `user ${userId} would have ${userLifetimeCount + 1} lifetime sponsorships, cap is ${limits.userLifetimeCountCap}`,
      );
    }

    // --- per-user spend (rolling windows) ---
    const userHourSpend = this.sumCostWei(this.userEventsSince(userId, nowMs - HOUR_MS, nowMs));
    if (userHourSpend + worstCaseCostWei > limits.userHourlySpendCapWei) {
      return deny(
        "user_hourly_spend_cap_exceeded",
        `user ${userId} trailing-hour spend ${userHourSpend} + ${worstCaseCostWei} would exceed cap ${limits.userHourlySpendCapWei}`,
      );
    }
    const userDaySpend = this.sumCostWei(this.userEventsSince(userId, nowMs - DAY_MS, nowMs));
    if (userDaySpend + worstCaseCostWei > limits.userDailySpendCapWei) {
      return deny(
        "user_daily_spend_cap_exceeded",
        `user ${userId} trailing-day spend ${userDaySpend} + ${worstCaseCostWei} would exceed cap ${limits.userDailySpendCapWei}`,
      );
    }
    const userLifetimeSpend = this.sumCostWei(this.userEventsSince(userId, 0, nowMs));
    if (userLifetimeSpend + worstCaseCostWei > limits.userLifetimeSpendCapWei) {
      return deny(
        "user_lifetime_spend_cap_exceeded",
        `user ${userId} lifetime spend ${userLifetimeSpend} + ${worstCaseCostWei} would exceed cap ${limits.userLifetimeSpendCapWei}`,
      );
    }

    // --- per-app spend (calendar-day UTC + lifetime) ---
    const appDaySpend = this.sumCostWei(this.appEventsSince(appId, startOfUtcDayMs(nowMs), nowMs));
    if (appDaySpend + worstCaseCostWei > limits.appDailySpendCapWei) {
      return deny(
        "app_daily_spend_cap_exceeded",
        `app ${appId} today's spend ${appDaySpend} + ${worstCaseCostWei} would exceed cap ${limits.appDailySpendCapWei}`,
      );
    }
    if (limits.appLifetimeSpendCapWei !== null) {
      const appLifetimeSpend = this.sumCostWei(this.appEventsSince(appId, 0, nowMs));
      if (appLifetimeSpend + worstCaseCostWei > limits.appLifetimeSpendCapWei) {
        return deny(
          "app_lifetime_spend_cap_exceeded",
          `app ${appId} lifetime spend ${appLifetimeSpend} + ${worstCaseCostWei} would exceed cap ${limits.appLifetimeSpendCapWei}`,
        );
      }
    }

    // --- global circuit breaker (calendar-day UTC, or since last manual reset) ---
    // Scoped correctly: this sums ALL apps'/users' events, not just this
    // request's app/user, so one app/user hitting only ITS OWN cap above
    // never reaches this check, and this check itself only trips from
    // aggregate global spend, never from a single user/app's activity alone
    // unless that activity alone is enough to cross the global ceiling.
    const breakerWindowStart = this.circuitBreakerWindowStartMs(nowMs);
    const globalSpend = this.globalSpendSince(breakerWindowStart, nowMs);
    if (globalSpend + worstCaseCostWei > limits.globalDailySpendCeilingWei) {
      return deny(
        "global_circuit_breaker_tripped",
        `global spend today ${globalSpend} + ${worstCaseCostWei} would exceed the circuit-breaker ceiling ${limits.globalDailySpendCeilingWei}; all sponsorship halted until UTC rollover or an admin reset`,
      );
    }

    // --- all checks passed: record atomically ---
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO sponsorship_events (ts_ms, user_id, app_id, sender, cost_wei, user_op_hash, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(nowMs, userId, appId, sender, worstCaseCostWei.toString(), input.userOpHash, input.validUntil);
      this.appendAudit({
        tsMs: nowMs,
        decision: "approved",
        reason: "ok",
        userId,
        appId,
        sender,
        targets,
        worstCaseCostWei: worstCaseCostWei.toString(),
        userOpHash: input.userOpHash,
        finalHash: input.finalHash,
        validUntil: input.validUntil,
        validAfter: input.validAfter,
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      // Lost a cross-connection race on the unique user_op_hash index: the
      // winner already charged this hash, so this is the idempotent case.
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        return { ok: true };
      }
      throw error;
    }

    return { ok: true };
  }

  /** Denial audit logging for checks that happen before any cap/spend logic (auth, allowlist, decode). */
  appendDenialAudit(params: {
    nowMs: number;
    reason: DenialReason;
    userId: string | null;
    appId: string | null;
    sender: Address | null;
    targets: readonly Address[];
  }): void {
    this.appendAudit({
      tsMs: params.nowMs,
      decision: "denied",
      reason: params.reason,
      userId: params.userId,
      appId: params.appId,
      sender: params.sender,
      targets: params.targets,
      worstCaseCostWei: null,
      userOpHash: null,
      finalHash: null,
      validUntil: null,
      validAfter: null,
    });
  }
}
