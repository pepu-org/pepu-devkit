/**
 * Reconciles off-chain approvals with on-chain truth, closing v1's known gap ("no reconciler"):
 *
 *   - `SponsorReserved`  -> the op was included on-chain: mark it executed (it must never be voided, even if its
 *                           postOp later reverts, because the sponsor was charged the full reservation).
 *   - `UserOpSettled`    -> record the ACTUAL charge (`final_wei`); user budgets then count actual, not worst case.
 *   - After scanning up to the chain head: approvals whose signature expired before the head block's timestamp
 *     (minus a safety margin) and that were never seen on-chain can no longer execute, so they are VOIDED and stop
 *     counting toward caps.
 *
 * Idempotent: re-processing the same events (the scan overlaps the previous range by `REORG_OVERLAP` blocks) is a
 * no-op. The cursor lives in the `kv` table. Failures leave the cursor untouched, so the next run retries.
 */
import type { Hex } from "viem";
import type { ChainReader } from "./chain.js";
import type { SponsorshipDb } from "./db.js";

const CURSOR_KEY = "reconcile_next_block";
const TS_KEY = "reconcile_head_ts";
const REORG_OVERLAP = 2n;
const PRUNE_KEY = "audit_pruned_at_ms";
/** Audit retention runs at most this often (the delete is cheap, but there is no reason to run it every few seconds). */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export interface ReconcileSummary {
  fromBlock: string;
  toBlock: string;
  reserved: number;
  settled: number;
  voided: number;
  /** `audit_log_v2` rows deleted by the retention job in this run. */
  auditPruned: number;
}

export class Reconciler {
  private running = false;

  constructor(
    private readonly deps: {
      db: SponsorshipDb;
      chain: Pick<ChainReader, "getBlockNumber" | "getBlockTimestamp" | "getEvents">;
      deployBlock: bigint;
      chunkBlocks: bigint;
      voidSafetyMarginSeconds: number;
      /** Keep `audit_log_v2` rows this long (ms); older rows are pruned by `runOnce`. 0 or absent = keep forever. */
      auditRetentionMs?: number;
      now?: () => number;
    },
  ) {}

  /** Retention for `audit_log_v2` (review 3, M-3): at most hourly, driven by the reconciler timer. */
  private pruneAudit(): number {
    const keepMs = this.deps.auditRetentionMs ?? 0;
    if (keepMs <= 0) return 0;
    const now = (this.deps.now ?? Date.now)();
    const last = Number(this.deps.db.getKv(PRUNE_KEY) ?? 0);
    if (now - last < PRUNE_EVERY_MS) return 0;
    const removed = this.deps.db.pruneAudit(now - keepMs);
    this.deps.db.setKv(PRUNE_KEY, String(now));
    return removed;
  }

  status(): { nextBlock: string | null; headTimestamp: number | null } {
    const ts = this.deps.db.getKv(TS_KEY);
    return { nextBlock: this.deps.db.getKv(CURSOR_KEY), headTimestamp: ts === null ? null : Number(ts) };
  }

  async runOnce(): Promise<ReconcileSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const { db, chain } = this.deps;
      const head = await chain.getBlockNumber();
      const stored = db.getKv(CURSOR_KEY);
      let from = stored === null ? this.deps.deployBlock : BigInt(stored) - REORG_OVERLAP;
      if (from < this.deps.deployBlock) from = this.deps.deployBlock;
      const summary: ReconcileSummary = { fromBlock: from.toString(), toBlock: head.toString(), reserved: 0, settled: 0, voided: 0, auditPruned: 0 };
      if (from > head) {
        summary.auditPruned = this.pruneAudit();
        return summary;
      }

      for (let start = from; start <= head; start += this.deps.chunkBlocks) {
        const end = start + this.deps.chunkBlocks - 1n < head ? start + this.deps.chunkBlocks - 1n : head;
        const events = await chain.getEvents(start, end);
        for (const ev of events) {
          if (ev.name === "SponsorReserved") {
            if (db.markExecuted(ev.args.userOpHash as Hex)) summary.reserved++;
          } else if (ev.name === "UserOpSettled") {
            if (db.markSettled(ev.args.userOpHash as Hex, ev.args.charged as bigint, Number(ev.blockNumber), ev.transactionHash)) summary.settled++;
          }
        }
      }

      const headTs = await chain.getBlockTimestamp(head);
      summary.voided = db.voidExpiredApprovals(headTs - this.deps.voidSafetyMarginSeconds);
      db.setKv(TS_KEY, String(headTs));
      db.setKv(CURSOR_KEY, (head + 1n).toString());
      summary.auditPruned = this.pruneAudit();
      return summary;
    } finally {
      this.running = false;
    }
  }
}
