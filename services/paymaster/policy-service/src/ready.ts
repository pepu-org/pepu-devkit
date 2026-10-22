/**
 * Readiness check behind `GET /ready` (liveness stays on the cheap `GET /health`).
 *
 * "Ready" means the service can actually sponsor right now:
 *   - db      : the SQLite handle answers a query;
 *   - rpc     : the chain RPC answers eth_blockNumber;
 *   - deposit : the paymaster's EntryPoint deposit is at or above READY_MIN_DEPOSIT_WEI
 *               (an empty deposit makes every sponsored op fail on-chain). A deposit above
 *               READY_MAX_DEPOSIT_WEI is a WARNING only (blast radius of a signer-key leak is the deposit).
 *
 * Results are cached for a few seconds so a polling monitor (or a hostile caller, if the proxy ever exposes
 * this path) cannot turn /ready into an RPC amplifier. The proxy config does not expose /ready publicly.
 * The response never contains secrets: only booleans, the block number, and the deposit in wei.
 */
import type { Address } from "viem";
import type { PolicyDb } from "./db.js";
import { safeErrorMessage } from "./redact.js";

export interface ReadyChain {
  getBlockNumber(): Promise<bigint>;
  getDeposit(account: Address): Promise<bigint>;
}

export interface ReadyCheck {
  ok: boolean;
  detail?: string;
}

export interface ReadinessReport {
  status: "ready" | "not_ready";
  checks: {
    db: ReadyCheck;
    rpc: ReadyCheck & { blockNumber?: string };
    deposit: ReadyCheck & { wei?: string; belowMinimum?: boolean; aboveMaximum?: boolean };
  };
  warnings: string[];
}

export interface ReadinessOptions {
  db: Pick<PolicyDb, "ping">;
  /** null = no RPC configured (dev): rpc and deposit checks are reported as skipped and do not fail readiness. */
  chain: ReadyChain | null;
  paymaster: Address;
  minDepositWei: bigint;
  maxDepositWei: bigint;
  cacheMs?: number;
  rpcTimeoutMs?: number;
  now?: () => number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createReadinessChecker(opts: ReadinessOptions): () => Promise<ReadinessReport> {
  const cacheMs = opts.cacheMs ?? 5_000;
  const rpcTimeoutMs = opts.rpcTimeoutMs ?? 5_000;
  const now = opts.now ?? Date.now;
  let cached: { at: number; report: ReadinessReport } | null = null;
  let pending: Promise<ReadinessReport> | null = null;

  async function compute(): Promise<ReadinessReport> {
    const warnings: string[] = [];

    let db: ReadyCheck;
    try {
      opts.db.ping();
      db = { ok: true };
    } catch (error) {
      db = { ok: false, detail: safeErrorMessage(error) };
    }

    let rpc: ReadinessReport["checks"]["rpc"];
    let deposit: ReadinessReport["checks"]["deposit"];
    if (!opts.chain) {
      rpc = { ok: true, detail: "skipped: RPC_URL not configured" };
      deposit = { ok: true, detail: "skipped: RPC_URL not configured" };
      warnings.push("RPC_URL is not configured: RPC and deposit checks are skipped");
    } else {
      const chain = opts.chain;
      try {
        const block = await withTimeout(chain.getBlockNumber(), rpcTimeoutMs, "eth_blockNumber");
        rpc = { ok: true, blockNumber: block.toString() };
      } catch (error) {
        rpc = { ok: false, detail: safeErrorMessage(error) };
      }
      if (!rpc.ok) {
        deposit = { ok: false, detail: "not checked: RPC unreachable" };
      } else {
        try {
          const wei = await withTimeout(chain.getDeposit(opts.paymaster), rpcTimeoutMs, "EntryPoint.balanceOf");
          const belowMinimum = opts.minDepositWei > 0n && wei < opts.minDepositWei;
          const aboveMaximum = opts.maxDepositWei > 0n && wei > opts.maxDepositWei;
          deposit = {
            ok: !belowMinimum,
            wei: wei.toString(),
            belowMinimum,
            aboveMaximum,
            ...(belowMinimum ? { detail: `deposit ${wei} wei is below READY_MIN_DEPOSIT_WEI ${opts.minDepositWei}` } : {}),
          };
          if (aboveMaximum) {
            warnings.push(`deposit ${wei} wei is above READY_MAX_DEPOSIT_WEI ${opts.maxDepositWei} (blast-radius ceiling)`);
          }
        } catch (error) {
          deposit = { ok: false, detail: safeErrorMessage(error) };
        }
      }
    }

    const ready = db.ok && rpc.ok && deposit.ok;
    return { status: ready ? "ready" : "not_ready", checks: { db, rpc, deposit }, warnings };
  }

  return async () => {
    if (cached && now() - cached.at < cacheMs) return cached.report;
    if (!pending) {
      pending = compute()
        .then((report) => {
          cached = { at: now(), report };
          return report;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}
