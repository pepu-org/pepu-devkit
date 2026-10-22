# Hosting runbook: PEPU bundler and v1 paymaster policy service

This runbook takes a bare VM to a hosted, monitored bundler (`https://bundler.<DOMAIN>`) and v1 paymaster (`https://paymaster.<DOMAIN>`) for PEPU mainnet (chain 97741).

**Not using Docker?** On a Linux VPS that already runs nginx and pm2, use the [nginx + pm2 variant](nginx-pm2/RUNBOOK-nginx-pm2.md) instead: same services and same rules (rate limits, Origin allowlist, path allowlist, token-redacted logs), ported from this kit's Caddyfile to nginx. Key handling, rotation policy and `/ready` semantics below apply to both.

**Status of this kit.** The Docker builds, `docker compose config`/`up`, TLS issuance and the `rate_limit` Caddy module were NOT executed: no Docker daemon was available where the kit was authored. What was verified: the Caddyfile parses on stock Caddy 2.10.2 and its Origin, shared-secret, path-allowlist, body-cap and log-redaction behavior was exercised against a mock backend (with the `rate_limit` blocks removed); the compose files parse as YAML. Treat the first deploy as the proof, and expect to fix small things. The policy service code (reconciler, `/ready`, shutdown, secrets loading, dev/prod apps split) is covered by the policy-service vitest suite (300+ tests); the monitor script by its own `node --test` suite.

## 1. What you are deploying

```
Internet --443--> caddy (TLS, per-IP rate limit, body cap, Origin allowlist, path allowlist)
                    |-- bundler.<DOMAIN>   -> alto:4337            (no published port)
                    `-- paymaster.<DOMAIN> -> policy-service:8788  (loopback port 18788 for ops only)
```

| Piece | Where | Notes |
|---|---|---|
| Alto bundler | `../../services/bundler/Dockerfile` | npm `@pimlico/alto` **0.0.21** (the proven version) on `node:24.4.1-bookworm-slim`, non-root. Production config `alto.config.prod.json` turns Alto's CORS off; Caddy owns CORS. |
| Policy service | `../../services/paymaster/policy-service/Dockerfile` | Node 22.21.1, non-root, `node dist/index.js`, state in the `pepu_policy_data` volume. **Single replica only.** |
| Caddy | `caddy/Dockerfile`, `Caddyfile` | Built with the `caddy-ratelimit` module via xcaddy. |
| Monitor | `scripts/healthcheck-alert.sh` | Cron + webhook; also checks the chain directly (deposit, executor float). |
| Backup | `scripts/backup-sqlite.sh` | Online SQLite snapshot, gzip, retention, optional upload. |

Why a proxy at all: Alto runs with `safe-mode: false` (upstream bug, see [the bundler README](../../services/bundler/README.md)) and Alto's CORS flag reflects any origin. Port 4337 must never be reachable directly. Never add a `ports:` entry to the `alto` service.

### What the owner must supply

| Item | Why |
|---|---|
| A domain you control (`DOMAIN`) | TLS and the two hostnames |
| A VM (Hetzner CX22 / DigitalOcean 2 vCPU 4 GB or similar) | Hosting |
| PEPU RPC URL (Conduit key embedded) | Alto, reconciler, `/ready`, monitor |
| Privy app id and secret | Policy service auth |
| Admin key holder (the account with `DEFAULT_ADMIN_ROLE` or `MANAGER_ROLE` on the paymaster) | `addSigner`, `updateBundlerAllowlist`, `withdrawTo` |
| PEPU float for the executor and the paymaster deposit | See section 5 |
| Webhook URL (Slack/Discord) and optionally a heartbeat URL | Alerts |
| Frontend origins | `ALLOWED_ORIGIN_REGEX`, `PAYMASTER_RPC_ALLOWED_ORIGINS` |

## 2. Provision the VM

1. Create the VM: Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM / 40 GB disk (Hetzner CX22 is enough), SSH key login only.
2. Cloud firewall (Hetzner/DO firewall, not only `ufw`): allow TCP 22 (restrict to your IP if you can), TCP 80, TCP 443, UDP 443. Everything else denied. Note that Docker-published ports bypass `ufw`, which is why only Caddy publishes anything public and the policy loopback port binds `127.0.0.1`.
3. Base hardening:
   ```sh
   sudo apt update && sudo apt -y upgrade
   sudo apt -y install unattended-upgrades ufw curl git
   sudo dpkg-reconfigure -plow unattended-upgrades
   sudo ufw default deny incoming && sudo ufw allow 22,80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
   ```
4. Install Docker Engine and the compose plugin from Docker's apt repository (`https://docs.docker.com/engine/install/ubuntu/`), then `docker compose version` must work.
5. Create the service user. The containers run as **uid 1000**, so use a user with that uid (the default first user on Ubuntu images usually is) and give it docker access:
   ```sh
   id            # expect uid=1000; if not, create one: sudo useradd -m -u 1000 -s /bin/bash deploy
   sudo usermod -aG docker "$USER"   # re-login afterwards
   ```
6. Get the code:
   ```sh
   sudo mkdir -p /opt/pepu && sudo chown "$USER":"$USER" /opt/pepu
   git clone <your-repo-url> /opt/pepu
   cd /opt/pepu/deploy/hosting
   ```

## 3. DNS

Create **A** (and **AAAA** if the VM has IPv6) records, TTL 300:

| Name | Value |
|---|---|
| `bundler.<DOMAIN>` | VM public IP |
| `paymaster.<DOMAIN>` | VM public IP |

Check from your laptop: `dig +short bundler.<DOMAIN> paymaster.<DOMAIN>`. Caddy obtains Let's Encrypt certificates automatically on first start; this needs the records to resolve to the VM and ports 80 and 443 to be reachable. Optional hardening: a CAA record allowing only `letsencrypt.org`.

## 4. Configuration files

```sh
cd /opt/pepu/deploy/hosting
cp .env.example .env
cp policy-service.env.example policy-service.env
cp monitor.env.example monitor.env
cp policy-config/apps.example.json policy-config/apps.json
cp policy-config/allowlist.example.json policy-config/allowlist.json
chmod 600 .env policy-service.env monitor.env
```

Edit them:

- `.env`: `DOMAIN`, `ACME_EMAIL`, `ALLOWED_ORIGIN_REGEX` (anchored regex, keep the single quotes), rate limits. Leave `BUNDLER_SHARED_SECRET` empty for a public bundler (browsers and the SDK cannot send it).
- `policy-service.env`: `PAYMASTER_CONTRACT_ADDRESS`, `PRIVY_APP_ID`, `PAYMASTER_RPC_ALLOWED_ORIGINS`, caps, `GLOBAL_DAILY_SPEND_CEILING_WEI`, `READY_*`. `PAYMASTER_SIGNER_ADDRESS` is filled in step 5.
- `policy-config/apps.json`: one entry per app, with the **sha256 hash** of the app token (generated below). It must not contain the local-dev key: the service refuses to start in production if it does.
- `policy-config/allowlist.json`: contracts the paymaster may pay gas for. Keep it minimal.
- `monitor.env`: public URLs, executor address(es), thresholds, webhook, heartbeat.

Origins are enforced in three places on purpose: Caddy (`ALLOWED_ORIGIN_REGEX`, browsers only), the policy service (`PAYMASTER_RPC_ALLOWED_ORIGINS`) and Alto's CORS (off; Caddy answers CORS for the bundler). `PAYMASTER_RPC_ALLOW_MISSING_ORIGIN=true` lets server-side callers (no `Origin` header) through; browsers always send `Origin`, so a visitor on another site is still refused. `Origin` is not authentication: the controls that matter against scripts are the rate limit, the app token, the caps and the small deposit.

## 5. Keys and secrets

**Do not reuse the dev keys** (`deploy/.keys.env`, the old executor `0xF585...`, signer `0x106e...`). The hosted deployment gets a **fresh dedicated executor key and a fresh dedicated paymaster signer key**, each with a small float. The kit never contains real keys; you generate them on the VM so they never leave it.

### 5.1 Generate (on the VM)

```sh
cd /opt/pepu/deploy/hosting
docker compose build policy-service          # the key generator ships in this image
umask 077

# Fresh paymaster signer key. Prints ONLY the address; the key goes to a 0400 file.
docker compose run --rm --no-deps --user 1000:1000 -v "$PWD/secrets:/out" policy-service \
  node dist/cli/gen-key.js /out/paymaster_signer_private_key
#  -> address: 0xSIGNER...   (put it in policy-service.env as PAYMASTER_SIGNER_ADDRESS)

# Fresh executor key (one is enough to start; see 5.4 for more)
docker compose run --rm --no-deps --user 1000:1000 -v "$PWD/secrets:/out" policy-service \
  node dist/cli/gen-key.js /out/executor_private_keys
#  -> address: 0xEXECUTOR... (put it in monitor.env as EXECUTOR_ADDRESSES)

# Other secrets, typed without echo / shell history
read -rs RPC;   printf '%s' "$RPC"   > secrets/rpc_url;          unset RPC
read -rs PRIVY; printf '%s' "$PRIVY" > secrets/privy_app_secret; unset PRIVY
openssl rand -hex 32 > secrets/admin_token

sudo chown 1000:1000 secrets/* ; chmod 400 secrets/*
```

Back the two private keys up in your password manager or secrets vault **now**; they are never shown again. Never paste a key into chat, an issue, or a shell command line.

How injection works: `docker-compose.yml` mounts each file as a Docker secret at `/run/secrets/<name>` and sets `*_FILE` variables. The policy service (`loadSecretFiles` in `src/config.ts`) and the Alto entrypoint read the files into the process environment, so secrets never appear in the compose file, in `docker inspect`, or in `ps`. A variable set directly in the environment still wins, so the plain environment-variable fallback works too. With `NODE_ENV=production` the service does not read `deploy/.keys.env`.

### 5.2 Register the new keys on-chain (from the admin key holder's machine)

Using Foundry's `cast` on a trusted machine (the admin key never goes on the VM):

```sh
PM=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0
cast send $PM 'addSigner(address)'                 0xSIGNER...   --rpc-url $RPC --private-key $ADMIN_KEY
cast send $PM 'updateBundlerAllowlist(address[],bool)' '[0xEXECUTOR...]' true --rpc-url $RPC --private-key $ADMIN_KEY
cast call $PM 'signers(address)(bool)'             0xSIGNER...   --rpc-url $RPC   # true
cast call $PM 'isBundlerAllowed(address)(bool)'    0xEXECUTOR... --rpc-url $RPC   # true
```

The executor allowlist step is mandatory: the policy service always signs `allowAllBundlers=0`, so ops submitted by an executor that is not allowlisted revert with `BundlerNotAllowed`. This also means the paymaster only ever pays for bundles from your executor, which partly offsets `safe-mode: false`. See `deploy/allow-bundler.sh` for the existing pattern.

### 5.3 Fund (small floats on purpose)

The contract enforces no on-chain spending cap, so **the EntryPoint deposit is the entire loss if the signer key leaks**. The policy caps do not bound a key compromise, only normal abuse. Keep the deposit small and top it up often.

| Balance | Placeholder start | Alerts in `monitor.env` |
|---|---|---|
| Executor EOA (native PEPU, pays gas up front, reimbursed per op) | 200 PEPU | `EXECUTOR_MIN_WEI` |
| Paymaster EntryPoint deposit | 250 PEPU | `DEPOSIT_LOW_WEI` 100, `DEPOSIT_HIGH_WEI` 500 |
| `GLOBAL_DAILY_SPEND_CEILING_WEI` | 100 PEPU/day (at or below the deposit) | |

Measured costs: an account deployment op is about 12 PEPU, later ops about 3 PEPU. Pick numbers with the owner; the above are starting values, not a recommendation of record.

```sh
# Executor: plain transfer from your funding wallet
cast send 0xEXECUTOR... --value 200ether --rpc-url $RPC --private-key $FUNDING_KEY
# Paymaster deposit: anyone can deposit
cast send 0x0000000071727De22E5E9d8BAf0edAc6f37da032 'depositTo(address)' $PM --value 250ether --rpc-url $RPC --private-key $FUNDING_KEY
# The existing v1 deposit may be larger than you want. Admin can pull the excess back:
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 'balanceOf(address)(uint256)' $PM --rpc-url $RPC
cast send $PM 'withdrawTo(address,uint256)' $TREASURY 1750ether --rpc-url $RPC --private-key $ADMIN_KEY
```

`deploy/fund-paymaster.sh` does the deposit with the dev keys and defaults to 2000 PEPU; override `DEPOSIT_PEPU` or use the commands above. Alerting on the deposit is external and independent of the service: `healthcheck-alert` reads `EntryPoint.balanceOf(paymaster)` straight from the chain.

### 5.4 More executor keys

One executor serializes bundles on its nonce. For more throughput generate several (`executor_1`, `executor_2` ...), allowlist each on-chain, fund each, and join them: `paste -sd, secrets/executor_* > secrets/executor_private_keys` (then delete the single files you no longer need, keep them backed up), and list all addresses in `EXECUTOR_ADDRESSES`.

### 5.5 Create an app token

```sh
RAW=$(openssl rand -hex 24)
docker compose run --rm --no-deps policy-service node dist/cli/hash-api-key.js "$RAW"   # prints the sha256
```

Put the hash in `policy-config/apps.json` as `apiKeyHashHex`. The raw token goes only into that app's paymaster URL `https://paymaster.<DOMAIN>/paymaster/$RAW`. Treat the URL as a secret (Caddy redacts it in access logs). `unset RAW` when done.

### 5.6 Rotation

Rotate on a schedule (suggest every 90 days) and immediately on any suspicion.

**Paymaster signer (via the v1 contract's `addSigner` / `removeSigner`, both `onlyAdminOrManager`, effective immediately).**

Planned rotation, no downtime:
1. Generate the new key (5.1, to `secrets/paymaster_signer_private_key.new`), note the new address.
2. `cast send $PM 'addSigner(address)' $NEW ...` and confirm `signers($NEW)` is true.
3. Move the new file over `secrets/paymaster_signer_private_key`, set `PAYMASTER_SIGNER_ADDRESS=$NEW` in `policy-service.env`, `docker compose up -d --force-recreate policy-service`. The service refuses to start if key and address disagree.
4. Wait at least 5 minutes (approvals signed by the old key stay valid for `VALIDITY_WINDOW_SECONDS`, default 90 s).
5. `cast send $PM 'removeSigner(address)' $OLD ...`, confirm `signers($OLD)` is false. Securely delete the old key.

Emergency (suspected leak): do step 5 FIRST for the old key (`removeSigner`; outstanding approvals die immediately, sponsorship fails until step 3), then `withdrawTo` the deposit to a safe address if the leak is serious, then steps 1-3. Reconcile afterwards: the reconciler logs `unmatched` events when the paymaster paid for ops this service never approved.

**Executor.** Generate and fund the new key, `updateBundlerAllowlist([$NEW], true)`, update `secrets/executor_private_keys`, `docker compose up -d --force-recreate alto` (in-flight ops in Alto's memory are lost; users retry), update `EXECUTOR_ADDRESSES`, then `updateBundlerAllowlist([$OLD], false)` and sweep the old balance.

**Others.** RPC URL (provider dashboard), Privy secret, admin token, bundler shared secret: replace the file or `.env` value and `docker compose up -d --force-recreate <service>`. App tokens: replace the hash in `apps.json` and `docker compose restart policy-service`; the old URL dies.

## 6. First deploy

```sh
cd /opt/pepu/deploy/hosting
docker compose config -q                                   # parses? (needs the .env files from section 4)
docker compose build                                       # alto, policy-service, caddy
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
docker compose run --rm --no-deps caddy caddy list-modules | grep rate_limit   # module present
docker compose up -d
docker compose ps                                          # all healthy
docker compose logs -f --tail=100 caddy policy-service alto
```

Look for: Caddy "certificate obtained successfully" for both hosts; policy service `starting: ... signer=0xSIGNER...` matching the address you registered, `listening on :8788`, no `reconciler is OFF` warning; Alto "Contracts used for simulation" and a block number.

First-start gotchas: if a container exits with `could not be read`, the secret file is not owned by uid 1000 or lacks read permission; if the policy service exits with a signer mismatch, `PAYMASTER_SIGNER_ADDRESS` does not match the key file; if Alto exits at once, check `ALTO_RPC_URL`/`ALTO_EXECUTOR_PRIVATE_KEYS` secrets are non-empty.

Optional systemd ownership of the stack: `sudo cp systemd/pepu-hosting.service /etc/systemd/system/ && sudo systemctl enable --now pepu-hosting` (adjust `WorkingDirectory`). Containers also restart on their own (`restart: unless-stopped`) and Docker starts on boot.

Install the cron jobs (`crontab -e`, see `crontab.example`) and create the writable dirs:

```sh
sudo mkdir -p /var/lib/pepu-hosting && sudo chown 1000:1000 /var/lib/pepu-hosting
sudo chown 1000:1000 backups
```

## 7. Smoke tests

Replace `$D` with your domain and `$RAW` with the app token.

```sh
D=example.com

# 1. Bundler answers on the right chain (expect "0x17dcd" = 97741)
curl -s https://bundler.$D -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

# 2. EntryPoint v0.7 is supported (expect 0x0000000071727De22E5E9d8BAf0edAc6f37da032 in the list)
curl -s https://bundler.$D -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'

# 3. Paymaster liveness and the ERC-7677 stub call (never consumes a cap)
curl -s https://paymaster.$D/health
curl -s https://paymaster.$D/paymaster/$RAW -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"pm_getPaymasterStubData","params":[{"sender":"0x0000000000000000000000000000000000000001"},"0x0000000071727De22E5E9d8BAf0edAc6f37da032","0x17dcd",{}]}'
#   -> result with paymaster = 0x2B6F..., paymasterData, isFinal:false
```

Negative checks (all must fail closed):

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://paymaster.$D/admin/circuit-breaker/reset   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://paymaster.$D/ready                                  # 404
curl -s -o /dev/null -w '%{http_code}\n' https://bundler.$D/metrics                                  # 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' https://bundler.$D/health # 403
curl -s -o /dev/null -w '%{http_code}\n' http://bundler.$D/                                          # 308 to https
curl -s http://127.0.0.1:18788/ready                                                                 # on the VM: status ready
# Rate limit: this should start returning 429 well before the loop ends (RATE_PAYMASTER_EVENTS per minute)
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code} ' https://paymaster.$D/paymaster/$RAW -H 'content-type: application/json' -d '{}'; done; echo
```

Real sponsored UserOp: from a checkout of this repo on your laptop (not the VM), with the SDK built:

```sh
pnpm install && pnpm --filter @pepu-chain/sdk build
PEPU_BUNDLER_URL=https://bundler.$D \
PEPU_PAYMASTER_URL=https://paymaster.$D/paymaster/$RAW \
  pnpm --filter @pepu-chain/sdk prove-session
```

This sends REAL sponsored UserOperations on mainnet (a few PEPU of the deposit) using throwaway keys, and also checks that out-of-scope and post-expiry calls are refused. It sends no `Origin` header, which is why `PAYMASTER_RPC_ALLOW_MISSING_ORIGIN=true`; and if you set `BUNDLER_SHARED_SECRET` it cannot pass (it cannot send the header), so test with the secret disabled or from a client that can. The app must allow the TapScore destination (`0x261eA5971B93237a56990206A46Bc80318e4d078`) in both `apps.json` and `allowlist.json`; `PAYMASTER_CONTRACT_ADDRESS` defaults inside the script to the v1 contract.

Afterwards confirm accounting: within about a minute `docker compose logs policy-service | grep executed-reconciler` should show `marked=` greater than 0 and `unmatched=0`; `curl -s http://127.0.0.1:18788/ready` shows the deposit dropped by the real cost.

## 8. Monitoring and operations

**Alerts** (`scripts/healthcheck-alert.sh` every 5 minutes, webhook): bundler chain id and EntryPoint, paymaster `/health`, policy `/ready` (DB, RPC, deposit as the service sees them), chain RPC, **paymaster deposit below/above the thresholds**, **executor float**, TLS certificate expiry (renewal failures), and a heartbeat ping on every green run (set `HEARTBEAT_URL` to a dead-man's-switch service such as healthchecks.io so a dead VM or cron also alerts you). Test it once: temporarily set `DEPOSIT_LOW_WEI` very high in `monitor.env` and run `scripts/healthcheck-alert.sh`; you should get one alert, then a recovery message after you revert.

Also set up outside this kit: provider-side uptime ping on `https://bundler.<DOMAIN>/health` and `https://paymaster.<DOMAIN>/health`, and disk/CPU alerts from the VM provider.

**Logs.** `docker compose logs -f <service>`. Docker rotates logs (20 MB x 5 per container). Caddy writes JSON access logs with the app token, Authorization and keys redacted. Things to grep: `executed-reconciler ... unmatched=` (non-zero after the first run means the paymaster paid for something this service did not approve: investigate as a possible key leak), `global_circuit_breaker_tripped` (daily ceiling hit), `Origin not allowed`.

**`/ready` semantics.** 200 `ready`: DB answers, RPC answers, deposit at or above `READY_MIN_DEPOSIT_WEI`. 503 `not_ready`: one of those failed (see `checks`). A deposit above `READY_MAX_DEPOSIT_WEI` is only a warning. `/ready` is blocked at the proxy; use it on the VM through `127.0.0.1:18788`.

**Admin actions** (on the VM only; `/admin/*` is blocked publicly):

```sh
docker compose exec -T policy-service node dist/cli/reset-circuit-breaker.js        # clear a tripped global breaker
docker compose exec -T policy-service node dist/cli/reset-spend-counters.js --user sender:0x... # support: clear one user's counters
```

(`monitor-deposit` reads the repo-root `.env` of a dev checkout, so it is not usable inside the container; deposit monitoring on the VM is `healthcheck-alert`, and top-ups are done with `cast` from the funding wallet as in 5.3.)

**Single replica.** Cap accounting assumes one process owns the SQLite file. `container_name` in the compose file refuses `--scale`. Never start a second instance against the same volume, never put the service behind a multi-backend load balancer. High availability needs a different design (shared database), not more replicas.

**Executed-marker reconciler.** Runs inside the policy service every `RECONCILER_INTERVAL_MS`. It reads `UserOperationEvent` logs for the paymaster and marks the matching approval executed, so caps keep counting an op after its signature's `valid_until`. Without it, caps under-count. If the RPC is down it retries; the cursor only advances after a successful scan. Between an op landing and the next scan (at most one interval) an approval near its expiry can briefly stop counting; this is a bounded, small window. Backfill from the paymaster's deployment block with `RECONCILER_START_BLOCK` on the first start if you want full history.

**Backups.** The daily cron snapshots the DB (`VACUUM INTO` plus `integrity_check`) to `backups/` (gzip, 14 days). Set `BACKUP_UPLOAD_CMD` to copy off the VM; a backup that lives only on the same disk is not a backup. Restore:

```sh
docker compose stop policy-service
gunzip -c backups/policy-YYYYMMDDTHHMMSSZ.db.gz > /tmp/policy.db
docker run --rm -v pepu_policy_data:/data -v /tmp:/in:ro node:22.21.1-bookworm-slim \
  sh -c 'rm -f /data/policy.db-wal /data/policy.db-shm && cp /in/policy.db /data/policy.db && chown 1000:1000 /data/policy.db*'
docker compose start policy-service
```

## 9. Upgrades and rollback

Policy service or Caddy config:

```sh
cd /opt/pepu && git fetch && git log --oneline HEAD..origin/main     # review what is coming
cd deploy/hosting
docker tag pepu/policy-service:v1 pepu/policy-service:prev            # rollback point
docker tag pepu/alto:0.0.21 pepu/alto:prev
./scripts/backup-sqlite.sh                                            # fresh snapshot first
git pull --ff-only
docker compose build
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
docker compose up -d                                                  # recreates only changed services
scripts/healthcheck-alert.sh && curl -s http://127.0.0.1:18788/ready
```

Redeploying the policy service takes it down for the few seconds of stop (graceful shutdown waits up to `SHUTDOWN_TIMEOUT_MS` = 10 s, `stop_grace_period` 20 s) plus start. Clients retry; no state is lost because it lives in the volume.

**Rollback.** `git checkout <previous-commit>` in `/opt/pepu`, `docker compose build`, `docker compose up -d` (or retag `:prev` back to the main tag and `docker compose up -d --no-build`). Database migrations in this service are additive (new tables/columns only), so an older build runs against a newer database; if you must restore data, use the restore steps in section 8.

**Alto upgrade.** Never bump the version casually: this deployment depends on `@pimlico/alto` 0.0.21 behavior (the `safe-mode` bug and its workaround). To move: change the version in `services/bundler/package.json`, regenerate `package-lock.json`, re-run the bundler README "Proof of life" checks and the smoke tests above against a staging stack, then deploy. Bump the Node pin in the Dockerfile the same deliberate way.

## 10. After hosting is live: the SDK, docs and MCP swap

Do this only when both services pass section 7 and are monitored. The hosted URLs live in exactly one place (see also `RELEASING.md`, "Hosted endpoints: the swap point").

1. Edit `PEPU_HOSTED` in `packages/sdk/src/endpoints.ts`:
   ```ts
   export const PEPU_HOSTED = {
     bundlerUrl: "https://bundler.<DOMAIN>",
     paymasterUrl: "https://paymaster.<DOMAIN>/paymaster/<public-app-token>",
   };
   ```
   Open decision for the owner: the v1 paymaster URL carries the app token in its path, but `RELEASING.md` says "no embedded secrets". A default URL baked into a public SDK exposes that token to everyone, so it must be a dedicated, low-cap, destination-restricted public app (its own `apps.json` entry with a small `dailySpendCapWei` and only the intended contracts), rotated if abused. Alternatively keep `paymasterUrl: null` until the v2 self-serve flow exists. Update the expectation in `packages/sdk/test/endpoints.test.ts` (it currently asserts both are `null`).
2. `pnpm --filter @pepu-chain/sdk build`, then `node scripts/gen-docs.mjs` (regenerates `docs/reference/endpoints.md`, `docs/llms.txt` and `docs/llms-full.txt`).
3. `pnpm --filter @pepu-chain/mcp snapshots` so the bundled MCP docs match.
4. `node scripts/gen-docs.mjs --check`, `node scripts/check-docs-parity.mjs`, `node scripts/check-links.mjs`, SDK tests.
5. Hand-edit the prose pages that quote the hosted URLs: `docs/get-started/network-reference.md`, `docs/onboarding/sponsored-transactions.md`, `docs/infra/overview.md`. Release the SDK and the MCP server together.
6. If browsers on documented domains must call the endpoints, add those origins to `ALLOWED_ORIGIN_REGEX` and `PAYMASTER_RPC_ALLOWED_ORIGINS` first, or they get a 403.

## 11. Production checklist

- [ ] DNS resolves, both certificates issued, `http://` redirects to `https://`
- [ ] Port 4337 is not reachable from outside (`nc -vz <ip> 4337` fails) and `alto` has no `ports:` entry
- [ ] Fresh signer and executor keys, backed up; old/dev keys not present on the VM
- [ ] `addSigner(new)` and `updateBundlerAllowlist(executor)` confirmed on-chain
- [ ] Executor float and deposit are the small numbers you chose; `GLOBAL_DAILY_SPEND_CEILING_WEI` at or below the deposit
- [ ] `apps.json` has no local-dev key (the service enforces it); the allowlist is minimal
- [ ] `/admin/*`, `/ready`, `/metrics`, `/v2/*` return 404 publicly
- [ ] Rate limit returns 429 under the loop in section 7
- [ ] `prove-session` against the hosted URLs succeeded and the reconciler logged `marked>0 unmatched=0`
- [ ] Alerts tested (alert and recovery), heartbeat configured
- [ ] Backup ran once, was copied off-box, and a restore was rehearsed
- [ ] Only ONE policy-service container exists
