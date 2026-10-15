# nginx + pm2 hosting kit

The non-Docker variant of [the hosting kit](../RUNBOOK.md): the same bundler and v1 paymaster policy service, fronted by nginx and run by pm2 on a Linux VPS that already hosts other things. The Docker + Caddy kit in the parent directory stays as an alternative.

Start with [RUNBOOK-nginx-pm2.md](RUNBOOK-nginx-pm2.md). It is written for `bundler.pepeunchained.com` and `paymaster.pepeunchained.com` on `<SERVER_IP>`, and ends with what was and was not verified.

| File | What it is |
|---|---|
| `RUNBOOK-nginx-pm2.md` | Step-by-step: preflight, install, keys, start, nginx + TLS, smoke tests, monitoring, rollback, SDK swap |
| `install.sh` | One-time, idempotent host preparation (user, directories, Node, pm2, build). Has `--dry-run`; read the header first |
| `deploy.sh` | Update: snapshot DB, pull or checkout, build, `pm2 startOrReload`, health wait. Also the rollback tool (`--ref`) |
| `ecosystem.config.cjs` | pm2 apps `pepu-bundler` (Alto 0.0.21, 127.0.0.1:4337) and `pepu-paymaster` (policy service, 127.0.0.1:8788, one instance) |
| `bin/run-alto.sh` | Reads Alto's secrets from files, then execs Alto bound to loopback |
| `bin/loopback-bind.mjs` (+ `.test.mjs`) | `node --import` preload that forces listeners onto 127.0.0.1; test with `node --test bin/loopback-bind.test.mjs` |
| `bin/policy-cli.cjs` | Runs the policy service's operator CLIs (gen-key, hash-api-key, resets, backup) with the service's exact environment |
| `nginx/conf.d/` | http-level: rate-limit zones + redacting log format (`pepu-zones.conf`), Origin allowlist (`pepu-origins.conf`), optional bundler secret (`pepu-bundler-key.conf`) |
| `nginx/snippets/` | TLS, proxy and security-header includes |
| `nginx/sites-available/` | `bundler.pepeunchained.com.conf`, `paymaster.pepeunchained.com.conf`, and the temporary `pepu-acme-bootstrap.conf` used to obtain certificates |
| `etc-pepu/` | Templates for `/etc/pepu/policy-service.env` and `/etc/pepu/monitor.env` |
| `scripts/healthcheck-cron.sh`, `scripts/backup-sqlite-host.sh`, `crontab.example` | Monitoring and backups (the checker itself is `../scripts/healthcheck-alert.mjs`) |

Secrets never live in this directory: the kit only knows file paths under `/etc/pepu/secrets`, created on the VPS.
