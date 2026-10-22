/**
 * Graceful shutdown with a hard deadline.
 *
 * `server.close()` stops accepting new connections but waits for every open (including keep-alive)
 * connection to end, so a lone idle client could hang SIGTERM forever and the orchestrator would
 * SIGKILL the process mid-write. This helper:
 *   1. stops accepting connections and closes idle keep-alive sockets right away;
 *   2. waits up to `timeoutMs` for in-flight requests to finish;
 *   3. on timeout, destroys the remaining sockets and exits non-zero (1);
 *   4. otherwise runs the cleanup hooks (stop jobs, close the DB) and exits 0.
 * If a hook is still stuck 2s after the deadline, the process exits 1 anyway. Repeated signals are ignored while a shutdown is in progress.
 */
import type { Server } from "node:http";

export interface ShutdownOptions {
  server: Pick<Server, "close" | "closeIdleConnections" | "closeAllConnections">;
  timeoutMs: number;
  /** Cleanup after the server has drained (async allowed). Errors are logged and do not block exit. */
  onDrained: () => void | Promise<void>;
  /** Called before the server drains, e.g. to stop background jobs from starting new work. */
  onStart?: () => void | Promise<void>;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

const HARD_EXIT_GRACE_MS = 2_000;

export function createShutdownHandler(opts: ShutdownOptions): (signal: string) => Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? ((m: string) => console.log(m));
  let started = false;

  return async (signal: string) => {
    if (started) return;
    started = true;
    log(`[policy-service] received ${signal}, shutting down (deadline ${opts.timeoutMs}ms)`);

    let forced = false;
    const deadline = setTimeout(() => {
      forced = true;
      log("[policy-service] shutdown deadline reached; closing remaining connections and exiting");
      opts.server.closeAllConnections();
      // Last resort if a cleanup hook (e.g. an in-flight RPC scan) is still stuck: do not hang forever.
      setTimeout(() => exit(1), HARD_EXIT_GRACE_MS);
    }, opts.timeoutMs);

    try {
      await opts.onStart?.();
    } catch (error) {
      log(`[policy-service] shutdown start hook failed: ${(error as Error).message}`);
    }

    await new Promise<void>((resolve) => {
      opts.server.close(() => resolve());
      opts.server.closeIdleConnections();
    });
    clearTimeout(deadline);

    try {
      await opts.onDrained();
    } catch (error) {
      log(`[policy-service] shutdown cleanup failed: ${(error as Error).message}`);
    }
    exit(forced ? 1 : 0);
  };
}
