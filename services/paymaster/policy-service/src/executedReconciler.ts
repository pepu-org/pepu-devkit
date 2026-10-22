/**
 * v1 executed-marker reconciler.
 *
 * Problem (known gap): cap accounting counts an approval only while its paymaster signature can still be used
 * on-chain (`valid_until` in the future) or once it is confirmed `executed` (see db.ts COUNTED). Nothing in v1
 * ever set `executed`, so an op that DID land on-chain stopped counting toward the user/app/global caps the
 * moment `valid_until` passed, i.e. caps under-counted real spend by up to ~everything.
 *
 * Fix: a small polling job that reads the EntryPoint's `UserOperationEvent` logs filtered to this paymaster and
 * marks the matching approval executed (PolicyDb.recordChainExecution). It is a job, not a request-path
 * dependency: if the chain RPC is down the service keeps serving, and the cursor does not advance so the next
 * run retries the same range.
 *
 * Properties:
 *   - Idempotent: every EntryPoint userOpHash is recorded once (`reconciled_user_ops`), so the deliberate
 *     overlap between runs (REORG_OVERLAP) and manual re-runs never double-mark.
 *   - Reorg tolerant: scans only up to `head - confirmations`, and re-scans the last REORG_OVERLAP blocks.
 *   - Reports `unmatched` events (the paymaster paid for an op this service has no approval for). In a healthy
 *     deployment that is zero; a non-zero value after the first run means a leaked signer key, a second
 *     service instance, or the lookback window starting mid-history. Alert on it.
 *   - No private key involved: read-only RPC calls.
 *
 * The chain access sits behind `ExecutedChainReader` so tests inject an in-memory fake.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import type { PolicyDb } from "./db.js";
import { safeErrorMessage } from "./redact.js";

const CURSOR_KEY = "executed_reconcile_next_block";
const REORG_OVERLAP = 2n;

export interface UserOperationEventLog {
  /** EntryPoint userOpHash (indexed). */
  userOpHash: Hex;
  sender: Address;
  success: boolean;
  actualGasCost: bigint;
  blockNumber: bigint;
}

export interface ExecutedChainReader {
  getBlockNumber(): Promise<bigint>;
  /** Unix seconds of the block. */
  getBlockTimestamp(blockNumber: bigint): Promise<number>;
  /** UserOperationEvent logs emitted by the EntryPoint for `paymaster` in [fromBlock, toBlock]. */
  getUserOperationEvents(paymaster: Address, fromBlock: bigint, toBlock: bigint): Promise<UserOperationEventLog[]>;
  /** EntryPoint deposit of `account` in wei (balanceOf). */
  getDeposit(account: Address): Promise<bigint>;
}

const userOperationEventAbi = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);
const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Production reader over a viem public client. */
export function createViemExecutedChainReader(rpcUrl: string, entryPoint: Address): ExecutedChainReader {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }) });
  return {
    getBlockNumber: () => client.getBlockNumber(),
    async getBlockTimestamp(blockNumber) {
      const block = await client.getBlock({ blockNumber });
      return Number(block.timestamp);
    },
    async getUserOperationEvents(paymaster, fromBlock, toBlock) {
      const logs = await client.getLogs({
        address: entryPoint,
        event: userOperationEventAbi,
        args: { paymaster },
        fromBlock,
        toBlock,
      });
      return logs.map((log) => ({
        userOpHash: log.args.userOpHash as Hex,
        sender: log.args.sender as Address,
        success: log.args.success as boolean,
        actualGasCost: log.args.actualGasCost as bigint,
        blockNumber: log.blockNumber as bigint,
      }));
    },
    getDeposit: (account) =>
      client.readContract({ address: entryPoint, abi: balanceOfAbi, functionName: "balanceOf", args: [account] }),
  };
}

export interface ExecutedReconcileSummary {
  fromBlock: string;
  toBlock: string;
  events: number;
  marked: number;
  duplicate: number;
  unmatched: number;
}

export interface ExecutedReconcilerOptions {
  db: PolicyDb;
  chain: ExecutedChainReader;
  paymaster: Address;
  chunkBlocks: bigint;
  /** Blocks before head to start from when there is no stored cursor (and no startBlock). */
  lookbackBlocks: bigint;
  /** Explicit first block when there is no stored cursor. */
  startBlock?: bigint | null;
  /** Only scan blocks at least this deep. */
  confirmations: bigint;
  now?: () => number;
  log?: (message: string) => void;
}

export class ExecutedReconciler {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private inFlight: Promise<unknown> | null = null;

  constructor(private readonly opts: ExecutedReconcilerOptions) {}

  /** One scan. Returns null if a scan is already running. Throws on RPC failure (cursor untouched). */
  async runOnce(): Promise<ExecutedReconcileSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const { db, chain, paymaster, chunkBlocks } = this.opts;
      const now = this.opts.now ?? Date.now;
      const head = await chain.getBlockNumber();
      const safeHead = head > this.opts.confirmations ? head - this.opts.confirmations : 0n;

      const stored = db.getReconcilerState(CURSOR_KEY);
      let from: bigint;
      if (stored !== null) {
        from = BigInt(stored) - REORG_OVERLAP;
      } else if (this.opts.startBlock !== null && this.opts.startBlock !== undefined) {
        from = this.opts.startBlock;
      } else {
        from = safeHead > this.opts.lookbackBlocks ? safeHead - this.opts.lookbackBlocks : 0n;
      }
      if (from < 0n) from = 0n;

      const summary: ExecutedReconcileSummary = {
        fromBlock: from.toString(),
        toBlock: safeHead.toString(),
        events: 0,
        marked: 0,
        duplicate: 0,
        unmatched: 0,
      };
      if (from > safeHead) return summary;

      const timestamps = new Map<bigint, number>();
      for (let start = from; start <= safeHead; start += chunkBlocks) {
        const end = start + chunkBlocks - 1n < safeHead ? start + chunkBlocks - 1n : safeHead;
        const events = await chain.getUserOperationEvents(paymaster, start, end);
        for (const ev of events) {
          let ts = timestamps.get(ev.blockNumber);
          if (ts === undefined) {
            ts = await chain.getBlockTimestamp(ev.blockNumber);
            timestamps.set(ev.blockNumber, ts);
          }
          summary.events++;
          const outcome = db.recordChainExecution({
            epUserOpHash: ev.userOpHash,
            sender: ev.sender,
            blockNumber: ev.blockNumber,
            blockTimestampSec: ts,
            actualGasCostWei: ev.actualGasCost,
            success: ev.success,
            nowMs: now(),
          });
          summary[outcome]++;
        }
      }
      db.setReconcilerState(CURSOR_KEY, (safeHead + 1n).toString());
      return summary;
    } finally {
      this.running = false;
    }
  }

  status(): { nextBlock: string | null } {
    return { nextBlock: this.opts.db.getReconcilerState(CURSOR_KEY) };
  }

  /** Starts the polling loop (first run immediately). Errors are logged, never thrown. */
  start(intervalMs: number): void {
    const log = this.opts.log ?? ((m: string) => console.log(m));
    const tick = (): void => {
      if (this.stopped) return;
      this.inFlight = this.runOnce()
        .then((summary) => {
          if (summary && (summary.marked > 0 || summary.unmatched > 0)) {
            log(
              `[policy-service] executed-reconciler blocks ${summary.fromBlock}-${summary.toBlock}: ` +
                `events=${summary.events} marked=${summary.marked} duplicate=${summary.duplicate} unmatched=${summary.unmatched}`,
            );
            if (summary.unmatched > 0) {
              log(
                "[policy-service] WARNING executed-reconciler: paymaster paid for user operations with no recorded approval (leaked signer? second instance? lookback started mid-history?)",
              );
            }
          }
        })
        .catch((error: unknown) => {
          log(`[policy-service] executed-reconciler run failed (will retry): ${safeErrorMessage(error)}`);
        })
        .finally(() => {
          if (!this.stopped) {
            this.timer = setTimeout(tick, intervalMs);
            this.timer.unref();
          }
        });
    };
    tick();
  }

  /** Stops scheduling and waits for an in-flight scan to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight?.catch(() => undefined);
  }
}
