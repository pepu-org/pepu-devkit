/**
 * Admin CLI: clears per-user/per-sender and/or per-app spend & count
 * history directly against the sqlite file, no running server needed —
 * same "usable without redeploying the service" shape as
 * `reset-circuit-breaker.ts` (see that file's doc comment), and built for
 * the same reason: during cap-sizing debugging (too-low caps denying
 * everything, then corrected), failed AND partial attempts can leave
 * `sponsorship_events` rows that count against the trailing-hour/day
 * windows even after the caps themselves are fixed — silently reproducing
 * the same denial for reasons that have nothing to do with a user's real
 * usage. This is the same problem `manuallyResetCircuitBreaker` solves for
 * the GLOBAL breaker; this script is the per-user/sender/app equivalent.
 *
 * Deliberately does NOT touch `audit_log` (the permanent approved+denied
 * decision history — see `PolicyDb.resetSpendEvents`'s doc comment) or
 * `circuit_breaker_state` (use `npm run reset-circuit-breaker` /
 * `POST /admin/circuit-breaker/reset` for that).
 *
 * Usage (reads DB_PATH the same way index.ts does):
 *   npm run reset-spend-counters                  # clear EVERYTHING
 *   npm run reset-spend-counters -- --user <id>    # scope to one user/sender id
 *   npm run reset-spend-counters -- --app <id>     # scope to one app id
 *   npm run reset-spend-counters -- --user <id> --app <id>   # both (AND)
 *
 * `<id>` for `--user` is whatever `sponsorship_events.user_id` holds for
 * that row — a Privy `user_id` string for `/sponsor`-originated events, or
 * `sender:0x...` (see `src/paymasterRpcAuth.ts`'s `senderKeyedUserId`) for
 * paymaster-JSON-RPC-originated ones.
 */
import { loadConfig, loadEnvFiles } from "../config.js";
import { PolicyDb } from "../db.js";

function parseArgs(argv: readonly string[]): { userId?: string; appId?: string } {
  const filter: { userId?: string; appId?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--user") {
      const value = argv[i + 1];
      if (!value) throw new Error("--user requires a value");
      filter.userId = value;
      i++;
    } else if (arg === "--app") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app requires a value");
      filter.appId = value;
      i++;
    } else {
      throw new Error(`Unrecognized argument "${arg}". Supported: --user <id>, --app <id>.`);
    }
  }
  return filter;
}

function main(): void {
  const filter = parseArgs(process.argv.slice(2));
  loadEnvFiles();
  const config = loadConfig();
  const db = new PolicyDb(config.dbPath);
  const deleted = db.resetSpendEvents(filter);
  db.close();

  const scope =
    filter.userId && filter.appId
      ? `user/sender "${filter.userId}" AND app "${filter.appId}"`
      : filter.userId
        ? `user/sender "${filter.userId}"`
        : filter.appId
          ? `app "${filter.appId}"`
          : "ALL users/senders/apps";

  console.log(
    `[reset-spend-counters] deleted ${deleted} sponsorship_events row(s) (scope: ${scope}) at ${config.dbPath}. ` +
      `audit_log and circuit_breaker_state were not touched.`,
  );
}

main();
