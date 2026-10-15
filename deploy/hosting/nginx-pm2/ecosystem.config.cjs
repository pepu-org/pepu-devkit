/**
 * pm2 ecosystem for the hosted PEPU bundler (Alto 0.0.21) and v1 paymaster policy service.
 * This is the non-Docker twin of deploy/hosting/docker-compose.yml. nginx (../nginx-pm2/nginx/) fronts both.
 *
 *   pepu-bundler    Alto, 127.0.0.1:4337   (fork mode, exactly 1 instance, secrets from files)
 *   pepu-paymaster  policy-service, 127.0.0.1:8788 (fork mode, EXACTLY 1 instance: the SQLite file has one owner)
 *
 * Run it as the unprivileged `pepu` user with its own pm2 daemon (see RUNBOOK-nginx-pm2.md), never as root:
 *   sudo pepu-pm2 startOrReload /opt/pepu/app/deploy/hosting/nginx-pm2/ecosystem.config.cjs --update-env
 * (`pepu-pm2` is the wrapper install.sh creates around `sudo -u pepu pm2`.)
 *
 * There is NO secret in this file. Secrets are passed as the PATH of a file owned by the pepu user (mode 0400):
 *   - bundler:   ALTO_RPC_URL_FILE, ALTO_EXECUTOR_PRIVATE_KEYS_FILE  -> read by bin/run-alto.sh
 *   - paymaster: PAYMASTER_SIGNER_PRIVATE_KEY_FILE, PRIVY_APP_SECRET_FILE, ADMIN_TOKEN_FILE, RPC_URL_FILE
 *                -> read by loadSecretFiles() in policy-service/src/config.ts
 * Non-secret policy settings live in /etc/pepu/policy-service.env, loaded with Node's --env-file.
 * Neither loader overrides a variable that is already set, so the values below always win.
 *
 * Node versions (see RUNBOOK-nginx-pm2.md, "Node versions"): the policy service needs node:sqlite (>= 22.13 flag-free) and is pinned
 * to 22.21.1, the version of its Docker image. Alto 0.0.21 was proven live on 24.4.1; its modules also load on
 * 22.21.1 but that was not run against the chain, so the default keeps the proven pairing. To run both on one
 * Node 22, set PEPU_ALTO_NODE to the 22 binary (and re-run the bundler README "Proof of life" checks).
 *
 * Every path can be overridden from the environment of the shell that runs pm2 (then use --update-env).
 */
const path = require("node:path").posix; // this host is Linux: always forward slashes

const HOME = process.env.PEPU_HOME || "/opt/pepu";
const APP = process.env.PEPU_APP_DIR || path.join(HOME, "app");
const KIT = path.join(APP, "deploy", "hosting", "nginx-pm2");
const ETC = process.env.PEPU_ETC_DIR || "/etc/pepu";
const SECRETS = path.join(ETC, "secrets");
const STATE = process.env.PEPU_STATE_DIR || "/var/lib/pepu";
const LOGS = process.env.PEPU_LOG_DIR || "/var/log/pepu";

const NODE_POLICY = process.env.PEPU_POLICY_NODE || path.join(HOME, "node", "22.21.1", "bin", "node");
const NODE_ALTO = process.env.PEPU_ALTO_NODE || path.join(HOME, "node", "24.4.1", "bin", "node");
// A file: URL works as an --import specifier on every platform and survives odd characters in the path.
const LOOPBACK = require("node:url").pathToFileURL(path.join(KIT, "bin", "loopback-bind.mjs")).href;

module.exports = {
  apps: [
    {
      name: "pepu-bundler",
      script: path.join(KIT, "bin", "run-alto.sh"),
      interpreter: "/bin/sh",
      cwd: path.join(APP, "services", "bundler"),
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",
        // Consumed by run-alto.sh (not by Alto): which node binary and checkout to use.
        PEPU_ALTO_NODE: NODE_ALTO,
        PEPU_BUNDLER_DIR: path.join(APP, "services", "bundler"),
        // Secrets by FILE PATH. run-alto.sh reads them, exports ALTO_RPC_URL / ALTO_EXECUTOR_PRIVATE_KEYS and
        // unsets these *_FILE names before exec'ing Alto. Port 4337 comes from alto.config.prod.json.
        ALTO_RPC_URL_FILE: path.join(SECRETS, "rpc_url"),
        ALTO_EXECUTOR_PRIVATE_KEYS_FILE: path.join(SECRETS, "executor_private_keys"),
      },

      autorestart: true,
      min_uptime: "30s",
      max_restarts: 15,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "1200M",
      // Alto drains its mempool loop on SIGINT/SIGTERM; give it the same window as the Docker kit (20 s).
      kill_timeout: 20000,

      out_file: path.join(LOGS, "pepu-bundler.out.log"),
      error_file: path.join(LOGS, "pepu-bundler.err.log"),
      merge_logs: true,
      // Alto logs JSON (`"json": true` in alto.config.prod.json) with its own timestamps: do not prefix lines.
      time: false,
      watch: false,
    },

    {
      name: "pepu-paymaster",
      script: "dist/index.js",
      cwd: path.join(APP, "services", "paymaster", "policy-service"),
      interpreter: NODE_POLICY,
      node_args: ["--import", LOOPBACK, `--env-file=${path.join(ETC, "policy-service.env")}`],
      // EXACTLY ONE instance, ever. Cap accounting assumes a single process owns the SQLite file.
      // Never use cluster mode, never raise `instances`, never run a second pm2 daemon with this app.
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",
        PORT: "8788", // bound to 127.0.0.1 by the loopback preload; nginx is the only public listener
        DB_PATH: path.join(STATE, "db", "policy.db"), // persistent, backed up by backup-sqlite-host.sh
        APPS_CONFIG_PATH: path.join(ETC, "apps.json"),
        ALLOWLIST_CONFIG_PATH: path.join(ETC, "allowlist.json"),
        PAYMASTER_SIGNER_PRIVATE_KEY_FILE: path.join(SECRETS, "paymaster_signer_private_key"),
        PRIVY_APP_SECRET_FILE: path.join(SECRETS, "privy_app_secret"),
        ADMIN_TOKEN_FILE: path.join(SECRETS, "admin_token"),
        RPC_URL_FILE: path.join(SECRETS, "rpc_url"),
        // Behind exactly one proxy (nginx on this host). nginx OVERWRITES X-Forwarded-For with the TCP peer it saw,
        // so with one hop the last entry is the real client. Used by the (opt-in) v2 API limiters.
        TRUST_PROXY: "true",
        TRUSTED_PROXY_HOPS: "1",
        // Must stay below kill_timeout so pm2 never SIGKILLs a clean shutdown (the service force-exits 2 s after this).
        SHUTDOWN_TIMEOUT_MS: "10000",
      },

      autorestart: true,
      min_uptime: "20s",
      max_restarts: 15,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "400M",
      kill_timeout: 20000, // >= SHUTDOWN_TIMEOUT_MS (10 s) + 2 s hard-exit grace + margin

      out_file: path.join(LOGS, "pepu-paymaster.out.log"),
      error_file: path.join(LOGS, "pepu-paymaster.err.log"),
      merge_logs: true,
      time: true, // the service logs plain text lines without timestamps
      watch: false,
    },
  ],
};
