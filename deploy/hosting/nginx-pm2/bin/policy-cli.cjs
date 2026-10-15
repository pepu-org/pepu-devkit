#!/usr/bin/env node
/**
 * Runs one of the policy service's operator CLIs with EXACTLY the environment the pm2 app has (same Node binary,
 * same --env-file, same DB_PATH, same *_FILE secrets), taken from ecosystem.config.cjs. Run it as the pepu user:
 *
 *   sudo -u pepu /opt/pepu/node/22.21.1/bin/node /opt/pepu/app/deploy/hosting/nginx-pm2/bin/policy-cli.cjs <cli> [args]
 *
 *   gen-key <file>                     fresh key (mode 0400), prints only the address
 *   hash-api-key <raw token>           sha256 for apps.json
 *   reset-circuit-breaker              clear a tripped global breaker (works while the service runs: SQLite WAL)
 *   reset-spend-counters [--user ID] [--app ID]
 *   backup-db <dir>                    one SQLite snapshot (the backup cron uses scripts/backup-sqlite-host.sh)
 *
 * (`monitor-deposit` is not offered: it reads the repo-root .env of a dev checkout. Deposit monitoring on this host
 * is healthcheck-alert; top-ups are done with `cast` from the funding wallet.)
 */
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path").posix;
const eco = require("../ecosystem.config.cjs");

const CLIS = ["gen-key", "hash-api-key", "reset-circuit-breaker", "reset-spend-counters", "backup-db"];
const [cli, ...args] = process.argv.slice(2);
if (!cli || !CLIS.includes(cli)) {
  console.error(`usage: policy-cli.cjs <${CLIS.join("|")}> [args]`);
  process.exit(2);
}
const app = eco.apps.find((a) => a.name === "pepu-paymaster");
if (!app) {
  console.error("policy-cli: pepu-paymaster not found in ecosystem.config.cjs");
  process.exit(2);
}
const result = spawnSync(app.interpreter, [...app.node_args, path.join(app.cwd, "dist", "cli", `${cli}.js`), ...args], {
  cwd: app.cwd,
  env: { ...process.env, ...app.env },
  stdio: "inherit",
});
if (result.error) {
  console.error(`policy-cli: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
