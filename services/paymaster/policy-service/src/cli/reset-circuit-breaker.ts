/**
 * Admin CLI: manually clears the global circuit breaker without needing the
 * HTTP service to be up (operates directly on the sqlite file). This is the
 * "usable without redeploying the service" admin action the brief asks for
 * (Part 2 step 7), as an alternative/companion to the protected
 * `POST /admin/circuit-breaker/reset` HTTP endpoint in server.ts (same
 * underlying `PolicyDb.manuallyResetCircuitBreaker`, so both paths are
 * exercised by the same tested code — see test/circuitBreaker.test.ts).
 *
 * Usage: npm run reset-circuit-breaker  (reads DB_PATH the same way index.ts does)
 */
import { loadConfig, loadEnvFiles } from "../config.js";
import { PolicyDb } from "../db.js";

function main(): void {
  loadEnvFiles();
  const config = loadConfig();
  const db = new PolicyDb(config.dbPath);
  db.manuallyResetCircuitBreaker(Date.now());
  db.close();
  console.log(`[reset-circuit-breaker] global circuit breaker manually reset at ${config.dbPath}`);
}

main();
