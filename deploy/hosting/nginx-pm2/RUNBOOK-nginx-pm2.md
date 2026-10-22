# Hosting runbook (nginx + pm2): PEPU bundler and v1 paymaster on the existing VPS

This runbook takes the existing Linux VPS (`<SERVER_IP>`, already running nginx and pm2) to a hosted, monitored bundler at `https://bundler.pepeunchained.com` and v1 paymaster at `https://paymaster.pepeunchained.com` for PEPU mainnet (chain 97741). It replaces the Docker + Caddy path of [the main hosting runbook](../RUNBOOK.md), which stays in the repo as an alternative. Everything not specific to nginx/pm2 (key rotation policy, what the caps mean, `/ready` semantics) is in that runbook; this one points to it instead of repeating it.

**Status of this kit.** Written without access to the VPS. Nothing here has been run on it. What WAS verified locally:

- Both nginx site files plus the `conf.d` and `snippets` files pass `nginx -t` on nginx 1.24.0 (the Ubuntu 24.04 version) and 1.28.0, and they were exercised against mock backends: path allowlist (including `//admin`, `/ADMIN`, `/%61dmin`, `/metrics`, `/v2/*`), localhost-only `/ready`, Origin allowlist (suffix and dot-escape attacks), CORS preflight, the optional shared secret, 256 KB body cap, per-IP 429s, 308 redirect, `X-Forwarded-For` overwrite, and that the `/paymaster/<token>` segment never reaches the access or error log.
- `ecosystem.config.cjs` parses (`node --check`) and, with the exact environment it defines, the real policy service starts in `NODE_ENV=production`, loads `/etc/pepu`-style secret files and `--env-file`, and binds loopback only (the same build without the preload binds every interface).
- The scripts are shellcheck-clean; `install.sh --dry-run` was run on Ubuntu 24.04 (WSL); the monitor wrapper, backup script (real `VACUUM INTO` snapshot), `run-alto.sh` secret loading and `policy-cli.cjs` were run with test layouts.
- Alto 0.0.21's modules and CLI load on Node 22.21.1.

What was NOT verified is listed in section 14. Treat the first deploy as the proof, and expect small fixes.

## 1. What you are deploying

```
Internet --443--> nginx (TLS, per-IP rate limits, body cap, Origin allowlist + CORS, path allowlist, redacted JSON logs)
                    |-- bundler.pepeunchained.com   -> 127.0.0.1:4337  Alto 0.0.21        (pm2 app pepu-bundler)
                    `-- paymaster.pepeunchained.com -> 127.0.0.1:8788  policy service v1  (pm2 app pepu-paymaster, ONE instance)
```

| Piece | Where | Notes |
|---|---|---|
| nginx site files | `nginx/sites-available/*.conf` | Separate `server` blocks only. Rules ported from the [Caddyfile](../Caddyfile). |
| nginx http-level bits | `nginx/conf.d/pepu-*.conf` | Rate-limit zones, log format, Origin map, optional bundler key. Every name is prefixed `pepu_`. |
| pm2 apps | `ecosystem.config.cjs` | Fork mode, one instance each, secrets by file path, loopback bind. |
| Install / update | `install.sh`, `deploy.sh` | Read the header of each before running; both have `--dry-run`. |
| Monitor + backup | `scripts/healthcheck-cron.sh`, `scripts/backup-sqlite-host.sh`, `crontab.example` | Same checker and snapshot mechanism as the Docker kit. |
| Operator CLIs | `bin/policy-cli.cjs` | gen-key, hash-api-key, reset-circuit-breaker, reset-spend-counters, backup-db with the service's exact environment. |

### Layout on the VPS

| Path | Owner / mode | Contents |
|---|---|---|
| `/opt/pepu/app` | `pepu` | This repo (git clone or rsync copy). Built in place. |
| `/opt/pepu/node/22.21.1`, `/opt/pepu/node/24.4.1` | `root` | Node binaries (no system-wide install). |
| `/opt/pepu/tools` | `root` | pm2 (pinned). The `pepu-pm2` wrapper in `/usr/local/bin` runs it as `pepu`. |
| `/etc/pepu` | `root:pepu` 750 | `policy-service.env`, `monitor.env`, `apps.json`, `allowlist.json` (640). |
| `/etc/pepu/secrets` | `pepu:pepu` 700 | `rpc_url`, `executor_private_keys`, `paymaster_signer_private_key`, `privy_app_secret`, `admin_token` (400). |
| `/var/lib/pepu` | `pepu` | `db/policy.db` (SQLite), `backups/`, `monitor/alert-state.json`, `deploy-history.log`. |
| `/var/log/pepu` | `pepu` | pm2 logs (rotated by pm2-logrotate). nginx logs stay in `/var/log/nginx/pepu-*.log`. |
| `/var/lib/pepu/.pm2` | `pepu` | pepu's OWN pm2 daemon (pepu's home directory is `/var/lib/pepu`). Your existing pm2 daemon and apps are not touched. |

### Node versions

- **Policy service: Node 22.21.1** (its Docker image's version; the code needs `node:sqlite`, flag-free from 22.13).
- **Alto 0.0.21: Node 24.4.1**, the version it was proven live on (see [the bundler README](../../../services/bundler/README.md)). Alto's `package.json` declares no `engines` field, and its modules and CLI do load on Node 22.21.1, but it was not run against the chain there.
- So one Node 22 *can probably* run both, but the default keeps the proven pairing; `install.sh` downloads both tarballs side by side (checksum-verified) under `/opt/pepu/node`, no nvm, no system Node touched. To use Node 22 for both anyway: `ALTO_NODE_VERSION=22.21.1` when running `install.sh` / `deploy.sh`, `PEPU_ALTO_NODE=/opt/pepu/node/22.21.1/bin/node` when running pm2, then repeat the bundler README "Proof of life" checks before opening it up.

### Why the loopback preload exists

Neither service lets you choose the bind address: Alto hard-codes `0.0.0.0`, the policy service calls `listen(port)` (all interfaces). `bin/loopback-bind.mjs` (loaded with `node --import`) forces both onto `127.0.0.1`. ufw is the second layer (section 2). Alto runs with `safe-mode: false`, so port 4337 must never be reachable from outside.

## 2. Preflight on the VPS (read-only)

Nothing below changes anything. SSH in as a sudoer and run it; stop and think if any answer differs from the expected one.

```sh
# machine
whoami; lsb_release -ds; uname -m; nproc; free -h | head -2; df -h / /opt /var | cat
#   expect x86_64 or aarch64, >= 2 GB free RAM (Alto peaks around 1 GB), >= 3 GB free disk

# nginx: version, what it already serves, and where it reads config from
nginx -v
sudo nginx -t
sudo nginx -T 2>/dev/null | grep -E '^\s*(server_name|listen)\s' | sort | uniq -c | sort -rn | head -40
ls /etc/nginx/sites-enabled /etc/nginx/conf.d 2>&1
grep -nE 'include\s+(/etc/nginx/)?(sites-enabled|conf\.d)' /etc/nginx/nginx.conf
#   Expect both includes. If sites-enabled is NOT included (nginx.org layout), put the two site files in
#   /etc/nginx/conf.d/ instead of sites-available + symlinks in section 7.

# nothing of ours is there yet (no name collision), and see how the existing config tunes the shared bits
sudo nginx -T 2>/dev/null | grep -n 'pepu_' | head          # expect no output
sudo nginx -T 2>/dev/null | grep -nE 'server_names_hash_bucket_size|limit_req_zone|log_format|ssl_session_cache'
cat /etc/logrotate.d/nginx | head -12                         # expect /var/log/nginx/*.log: our logs are rotated too

# ports: 4337 and 8788 must be free; 80 and 443 should be held by nginx
sudo ss -ltnp | grep -E ':(80|443|4337|8788)\b'
#   Also list EVERYTHING that listens publicly, you need it for the firewall step:
sudo ss -ltnp | awk 'NR==1 || /0\.0\.0\.0|\[::\]|\*:/' | cat

# pm2: which daemons exist (ours will be a separate one, run by the pepu user)
ps -eo user,pid,args | grep -i '[P]M2' | head
which pm2; pm2 -v 2>/dev/null

# tools install.sh needs
for c in curl git rsync openssl sudo useradd sha256sum certbot dig; do printf '%-10s' $c; command -v $c || echo MISSING; done
#   missing ones (Debian/Ubuntu):  sudo apt-get install -y curl git rsync openssl dnsutils certbot

# DNS: both names must point at this VPS, and have no AAAA (or you uncomment the [::] listen lines in the site files)
dig +short bundler.pepeunchained.com A; dig +short paymaster.pepeunchained.com A       # expect <SERVER_IP>
dig +short bundler.pepeunchained.com AAAA; dig +short paymaster.pepeunchained.com AAAA # expect nothing
curl -s https://api.ipify.org; echo                                                    # expect <SERVER_IP>

# firewall
sudo ufw status verbose
```

**Firewall decision (only 80 and 443 public).** The host firewall must end up allowing only SSH, 80 and 443. Because this VPS already hosts other things, look at the "listens publicly" list above BEFORE enabling or tightening ufw: any other service that is meant to be reachable (a database, another site on 8080, a mail port) needs its own `allow`, or it goes dark.

```sh
# if ufw is already active, just add what is missing and verify:
sudo ufw allow OpenSSH            # or: sudo ufw allow <your ssh port>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 4337/tcp            # explicit even under default-deny: this is the unsandboxed bundler
sudo ufw deny 8788/tcp
sudo ufw status numbered
# if ufw is inactive: allow SSH FIRST, add the other ports you need, only then:  sudo ufw enable
```

If the provider has its own cloud firewall (Hostinger hPanel, etc.), make it match: inbound TCP 22, 80, 443 only. Both layers are cheap; the loopback preload is the third.

## 3. Install

### 3.1 Get the code onto the VPS

Pick one. Neither copies `.env` files or `deploy/.keys.env` (the dev keys never go to the VPS).

**A. Clone** (the VPS needs read access to the repo; for a private repo, a read-only deploy key):

```sh
git clone <git-url-of-the-repo> /tmp/pepu-src
cd /tmp/pepu-src/deploy/hosting/nginx-pm2
```

**B. Ship a tarball from your laptop** (tracked files only, so no secrets can be in it):

```sh
# on your laptop, in the repo root, on the commit you want to deploy
git archive --format=tar.gz --prefix=pepu-src/ -o /tmp/pepu-src.tgz HEAD
scp /tmp/pepu-src.tgz <you>@<SERVER_IP>:/tmp/
# on the VPS
cd /tmp && rm -rf pepu-src && tar xzf pepu-src.tgz && cd pepu-src/deploy/hosting/nginx-pm2
```

### 3.2 Run the installer

```sh
less install.sh                      # read the header: it lists every change
sudo ./install.sh --dry-run          # prints every command, changes nothing
sudo ./install.sh                    # option A: prefix with REPO_URL=<git-url> so /opt/pepu/app becomes a git clone
```

It is idempotent. Afterwards:

```sh
KIT=/opt/pepu/app/deploy/hosting/nginx-pm2
ls -la /etc/pepu /etc/pepu/secrets /var/lib/pepu /var/log/pepu
sudo pepu-pm2 ls                      # pepu's own daemon, shows pm2-logrotate
sudo -u pepu /opt/pepu/node/22.21.1/bin/node -v    # v22.21.1
```

Updates without git (option B): repeat 3.1-B, run `sudo ./install.sh` from the new tree (it mirrors the code and rebuilds), then `sudo /opt/pepu/app/deploy/hosting/nginx-pm2/deploy.sh --no-pull`.

## 4. Configure

Four files in `/etc/pepu`, created from templates, never overwritten by later installs.

```sh
sudoedit /etc/pepu/policy-service.env   # PRIVY_APP_ID, PAYMASTER_RPC_ALLOWED_ORIGINS, caps, GLOBAL_DAILY_SPEND_CEILING_WEI, READY_*
sudoedit /etc/pepu/monitor.env          # EXECUTOR_ADDRESSES (after 5.1), thresholds, WEBHOOK_URL, HEARTBEAT_URL
sudoedit /etc/pepu/allowlist.json       # contracts the paymaster may pay gas for: keep it minimal
sudoedit /etc/pepu/apps.json            # one entry per app; apiKeyHashHex = sha256 of the app token (below)
```

`PAYMASTER_SIGNER_ADDRESS` is filled in at 5.1. The service refuses to start in production with the local-dev app key hash in `apps.json`. All the values the owner has to choose are collected in section 12.

**App token** (the secret that goes into `https://paymaster.pepeunchained.com/paymaster/<token>`):

```sh
RAW=$(openssl rand -hex 24)
sudo -u pepu /opt/pepu/node/22.21.1/bin/node $KIT/bin/policy-cli.cjs hash-api-key "$RAW"   # prints the sha256
```

Put the printed hash in `apps.json` as `apiKeyHashHex`. Keep `$RAW` in your password manager and `unset RAW`. (The raw token is briefly visible in `ps` on the VPS while the command runs; on a single-admin box that is acceptable. To avoid it, compute the hash on your laptop with `printf %s "$RAW" | sha256sum`.)

## 5. Keys, on-chain registration, funding

**Do not reuse the dev keys** (`deploy/.keys.env`; old executor `0xF585...`, signer `0x106e...`). The hosted deployment gets a **fresh signer key and a fresh executor key**, generated on the VPS so they never leave it.

### 5.1 Generate (on the VPS)

```sh
CLI="sudo -u pepu /opt/pepu/node/22.21.1/bin/node $KIT/bin/policy-cli.cjs"

$CLI gen-key /etc/pepu/secrets/paymaster_signer_private_key
#   address: 0xSIGNER...   -> PAYMASTER_SIGNER_ADDRESS in /etc/pepu/policy-service.env
$CLI gen-key /etc/pepu/secrets/executor_private_keys
#   address: 0xEXECUTOR... -> EXECUTOR_ADDRESSES in /etc/pepu/monitor.env

# other secrets, typed without echo or shell history (the files end up pepu:pepu 400)
sudo -u pepu bash -c 'umask 077; read -rsp "PEPU RPC URL (with the Conduit key): " v; echo; printf %s "$v" > /etc/pepu/secrets/rpc_url'
sudo -u pepu bash -c 'umask 077; read -rsp "Privy app secret: " v; echo; printf %s "$v" > /etc/pepu/secrets/privy_app_secret'
sudo -u pepu bash -c 'umask 077; openssl rand -hex 32 > /etc/pepu/secrets/admin_token'
sudo -u pepu chmod 400 /etc/pepu/secrets/*
sudo ls -l /etc/pepu/secrets
```

`gen-key` refuses to overwrite a file, writes mode 0400 and prints only the address. Never paste a key into chat, an issue, or a command line. Losing the signer key costs nothing (rotate, 5.6); losing the executor key forfeits only its small float, so a backup is optional. If you want one, read the file once in a private terminal (`sudo -u pepu cat ...`), store it in a password manager and clear the scrollback.

### 5.2 Register the new keys on-chain (admin machine, NOT the VPS)

The key holder with `DEFAULT_ADMIN_ROLE` or `MANAGER_ROLE` on the v1 paymaster does this from a trusted machine with Foundry. Use `--interactive` (prompts for the key) or `--account <keystore>`; never put the admin key on the command line or on the VPS.

```sh
PM=0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0
RPC='<PEPU RPC URL>'
SIGNER=0xSIGNER...        # from 5.1
EXECUTOR=0xEXECUTOR...    # from 5.1

# 1. authorise the new signer (onlyAdminOrManager)
cast send $PM 'addSigner(address)' $SIGNER --rpc-url $RPC --interactive
# 2. allowlist the executor as bundler (onlyAdminOrManager). Mandatory: the service always signs allowAllBundlers=0,
#    so ops from any other submitter revert with BundlerNotAllowed. This also means the paymaster only ever pays for
#    bundles from YOUR executor, which partly offsets Alto running with safe-mode=false.
cast send $PM 'updateBundlerAllowlist(address[],bool)' "[$EXECUTOR]" true --rpc-url $RPC --interactive

# verify, both must print true
cast call $PM 'signers(address)(bool)'          $SIGNER   --rpc-url $RPC
cast call $PM 'isBundlerAllowed(address)(bool)' $EXECUTOR --rpc-url $RPC
```

Then, on the VPS, set `PAYMASTER_SIGNER_ADDRESS` and `EXECUTOR_ADDRESSES` (section 4). See `deploy/allow-bundler.sh` for the existing pattern.

### 5.3 Fund the executor (small float)

The executor fronts the gas of each bundle and is reimbursed per op out of the paymaster deposit, so it only needs to cover a few in-flight bundles. At the measured costs (about 12 PEPU for an account-deploying op, about 3 PEPU after) the main runbook starts at 200 PEPU; you may well run with less. **Owner decides** (section 12).

```sh
cast send $EXECUTOR --value 200ether --rpc-url $RPC --interactive     # from your funding wallet
cast balance $EXECUTOR --rpc-url $RPC --ether
```

`EXECUTOR_MIN_WEI` in `monitor.env` should alert well before it runs dry.

### 5.4 The paymaster deposit (currently about 1,943 PEPU)

The contract enforces no spending cap, so **the EntryPoint deposit is the entire loss if the signer key ever leaks**. The deposit on the v1 paymaster is about 1,943 PEPU today, far more than the 250 PEPU the main runbook suggests as a starting blast radius. Check it, and reduce it if the owner wants:

```sh
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032
cast call $EP 'balanceOf(address)(uint256)' $PM --rpc-url $RPC | cast from-wei          # or: cast call $PM 'getDeposit()(uint256)' --rpc-url $RPC

# Only DEFAULT_ADMIN_ROLE can withdraw (not MANAGER). Check yours first, must print true:
cast call $PM 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 $ADMIN_ADDR --rpc-url $RPC
# Pull the excess back to a treasury address, e.g. 1,700 PEPU, leaving about 243:
cast send $PM 'withdrawTo(address,uint256)' $TREASURY $(cast to-wei 1700) --rpc-url $RPC --interactive
```

Top-ups later are anyone's `cast send $PM 'deposit()' --value 100ether` or `EntryPoint.depositTo`. Set `READY_MAX_DEPOSIT_WEI`, `DEPOSIT_HIGH_WEI` and `GLOBAL_DAILY_SPEND_CEILING_WEI` to match whatever you choose (until then `/ready` only warns, and the monitor alerts "deposit above HIGH").

### 5.5 Retire the dev keys on the contract (recommended, after go-live)

The old dev signer (`0x106e6d6dB9f22AF147D27E7EFa3E7D6f5DeF2454`) lives on a development machine and can still sign approvals that spend the deposit. Once the hosted signer works, remove it, and un-allowlist the old executor. This stops local dev flows that use those keys, so do it deliberately:

```sh
cast send $PM 'removeSigner(address)' 0x106e6d6dB9f22AF147D27E7EFa3E7D6f5DeF2454 --rpc-url $RPC --interactive
cast send $PM 'updateBundlerAllowlist(address[],bool)' '[0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e]' false --rpc-url $RPC --interactive
```

### 5.6 Rotation

Policy and the on-chain sequence are the same as [main runbook 5.6](../RUNBOOK.md). Only the commands that restart things differ:

- Signer: replace `/etc/pepu/secrets/paymaster_signer_private_key` (new file via `gen-key`, mv over the old), set the new `PAYMASTER_SIGNER_ADDRESS`, then `sudo pepu-pm2 restart pepu-paymaster --update-env`.
- Executor: new key into `executor_private_keys`, `sudo pepu-pm2 restart pepu-bundler` (in-flight ops in Alto's memory are lost; users retry), update `EXECUTOR_ADDRESSES`.
- RPC URL, Privy secret, admin token: replace the file, restart the app(s) that read it (`pepu-bundler` reads `rpc_url`; `pepu-paymaster` reads all but the executor key). The monitor reads `rpc_url` on every run.
- App tokens: replace the hash in `apps.json`, restart `pepu-paymaster`; the old URL dies.

## 6. Start the services

Before the first start, every file the apps read must exist (deploy.sh checks and tells you which is missing). Then:

```sh
sudo $KIT/deploy.sh --no-pull --skip-backup
```

This builds (already done by install, so it is a no-op), starts both apps with `pm2 startOrReload`, saves the process list, waits for `http://127.0.0.1:8788/health` and `http://127.0.0.1:4337/health`, and prints `/ready`. Alto needs up to a minute on first start (it deploys its simulation contracts if they are not on chain yet).

```sh
sudo pepu-pm2 status
sudo pepu-pm2 logs --lines 60 --nostream
```

Look for: policy service `starting: ... signer=0xSIGNER...` matching what you registered, `listening on :8788`, **no** `reconciler is OFF` warning; Alto "Contracts used for simulation" and a block number. First-start gotchas: `could not be read` means a secret file is not readable by `pepu`; a signer mismatch means `PAYMASTER_SIGNER_ADDRESS` does not match the key file; Alto exiting at once means `rpc_url` or `executor_private_keys` is empty.

**Prove nothing is publicly reachable** (the services must be loopback-only before nginx is even configured):

```sh
sudo ss -ltnp | grep -E ':(4337|8788)\b'         # every line must start with 127.0.0.1:
# from your laptop (not the VPS): both must fail / time out
nc -vz -w 3 <SERVER_IP> 4337; nc -vz -w 3 <SERVER_IP> 8788
# on the VPS, loopback works
curl -s localhost:4337 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'   # 0x17dcd
curl -s localhost:8788/ready
```

**Start on boot** (one-time; a separate unit `pm2-pepu`, independent of any existing `pm2-<user>` unit):

```sh
sudo env PATH=$PATH:/opt/pepu/node/22.21.1/bin /opt/pepu/tools/node_modules/.bin/pm2 startup systemd -u pepu --hp /var/lib/pepu --service-name pm2-pepu
sudo pepu-pm2 save
systemctl status pm2-pepu --no-pager | head -5
```

`deploy.sh` runs `pm2 save` after every reload, so the saved list stays current. Optional, once: reboot the VPS in a quiet moment and confirm both apps come back.

pm2-logrotate was installed by `install.sh` (20 MB, 14 files kept, compressed, daily). Verify: `sudo pepu-pm2 conf pm2-logrotate`.

## 7. nginx and TLS

Files go to `/etc/nginx`; nothing existing is replaced (`cp -i` asks before overwriting). Run these on the VPS.

### 7.1 Shared files

```sh
N=$KIT/nginx
sudo mkdir -p /etc/nginx/snippets /var/www/certbot
sudo cp -i $N/snippets/pepu-*.conf /etc/nginx/snippets/
sudo cp -i $N/conf.d/pepu-zones.conf $N/conf.d/pepu-origins.conf $N/conf.d/pepu-bundler-key.conf /etc/nginx/conf.d/
sudoedit /etc/nginx/conf.d/pepu-origins.conf     # DECISION: the browser origins that may call the endpoints
sudo nginx -t
```

`nginx -t` must still pass (the new files define only `pepu_`-prefixed names). If it says `could not build server_names_hash, you should increase server_names_hash_bucket_size: 32`, add `server_names_hash_bucket_size 64;` to the `http {}` block of `/etc/nginx/nginx.conf` (Linux x86 defaults are normally enough; this showed up only on Windows).

### 7.2 Certificates (certbot, webroot)

The real site files reference `/etc/letsencrypt/live/<host>/`, which does not exist yet, so first enable a plain-HTTP bootstrap that serves only the ACME challenge:

```sh
sudo cp -i $N/sites-available/pepu-acme-bootstrap.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/pepu-acme-bootstrap.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# issue both certificates (replace the e-mail; --deploy-hook reloads nginx on every renewal)
sudo certbot certonly --webroot -w /var/www/certbot --cert-name bundler.pepeunchained.com \
  -d bundler.pepeunchained.com -m ops@pepeunchained.com --agree-tos --no-eff-email --deploy-hook 'systemctl reload nginx'
sudo certbot certonly --webroot -w /var/www/certbot --cert-name paymaster.pepeunchained.com \
  -d paymaster.pepeunchained.com -m ops@pepeunchained.com --agree-tos --no-eff-email --deploy-hook 'systemctl reload nginx'
sudo ls /etc/letsencrypt/live/
sudo certbot renew --dry-run          # proves renewal; the distro's certbot.timer does it for real
systemctl list-timers 2>/dev/null | grep -i certbot
```

If HTTP-01 fails: DNS not pointing here yet, port 80 blocked by ufw or the provider firewall, or another server block with `default_server` swallowing the host (check `sudo tail /var/log/nginx/pepu-acme.error.log`). The `--nginx` authenticator also works (`sudo certbot certonly --nginx -d ...`), but webroot never edits your nginx files, which matters on a shared host. Optionally add a CAA record allowing only `letsencrypt.org`.

### 7.3 Enable the two sites

```sh
sudo rm /etc/nginx/sites-enabled/pepu-acme-bootstrap.conf       # its port-80 blocks would clash with the real files
sudo cp -i $N/sites-available/bundler.pepeunchained.com.conf $N/sites-available/paymaster.pepeunchained.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/bundler.pepeunchained.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/paymaster.pepeunchained.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

(On a `conf.d`-only layout copy the two site files into `/etc/nginx/conf.d/` instead of linking.) A reload never drops other sites' connections. To take everything offline instantly, see Rollback in section 10.

Notes on behaviour:

- Only these paths exist: bundler `POST /`, `/rpc`, `/v<N>/rpc` (+ preflight) and `GET /health`; paymaster `/paymaster/<token>`, `POST /sponsor`, `GET /health`. Everything else is 404, including `/admin*`, `/metrics`, `/v2/*` and any path starting with `//`. `/ready` answers only from the VPS itself (others get 404). v2 is a commented block in the paymaster site file for later.
- X-Forwarded-For is overwritten with the address nginx saw, matching `TRUST_PROXY=true` / `TRUSTED_PROXY_HOPS=1`. The v1 limits rely on nginx; the policy service only uses it for its opt-in v2 limiters.
- The paymaster vhost logs errors at `crit` only. nginx error lines print the request line, which would contain the app token; failures are visible in the access log instead (`status`, `upstream_status`). `/var/log/nginx` should be 640 root:adm (the default).
- Optional bundler shared secret: instructions at the top of `/etc/nginx/conf.d/pepu-bundler-key.conf`. Leave it off for a public bundler (browsers and the SDK cannot send it).

## 8. Smoke tests

From your laptop. `RAW` is the app token from section 4.

```sh
D=pepeunchained.com

# 1. bundler on the right chain (expect "0x17dcd" = 97741)
curl -s https://bundler.$D -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# 2. EntryPoint v0.7 supported (expect 0x0000000071727De22E5E9d8BAf0edAc6f37da032 in the list)
curl -s https://bundler.$D -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
# 3. paymaster liveness + the ERC-7677 stub call (never consumes a cap)
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
curl -s -o /dev/null -w '%{http_code}\n' --path-as-is https://bundler.$D//rpc -d x                   # 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' https://bundler.$D/health # 403
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS -H 'Origin: https://www.pepeunchained.com' https://bundler.$D/   # 204
curl -s -o /dev/null -w '%{http_code}\n' http://bundler.$D/                                          # 308 to https
head -c 300000 /dev/zero | curl -s -o /dev/null -w '%{http_code}\n' https://bundler.$D/ --data-binary @-   # 413
# on the VPS: /ready via the loopback port, and via nginx from localhost
curl -s http://127.0.0.1:8788/ready
curl -s --resolve paymaster.$D:443:127.0.0.1 https://paymaster.$D/ready
# rate limit: expect 429s once the burst (20) is used up, well before the loop ends
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code} ' https://paymaster.$D/paymaster/$RAW -H 'content-type: application/json' -d '{}'; done; echo
```

Redaction check, on the VPS: `sudo grep -c "$RAW" /var/log/nginx/pepu-*.log` must print 0 for every file, while `sudo tail -n 3 /var/log/nginx/pepu-paymaster.access.log` shows `/paymaster/REDACTED`.

**A real sponsored UserOp.** From a checkout of this repo on your laptop, not the VPS:

```sh
pnpm install && pnpm --filter @pepu-chain/sdk build
PEPU_BUNDLER_URL=https://bundler.pepeunchained.com \
PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/paymaster/$RAW \
  pnpm --filter @pepu-chain/sdk prove-session
```

This sends REAL sponsored UserOperations on mainnet (a few PEPU of the deposit) with throwaway keys and also checks that out-of-scope and post-expiry calls are refused. It sends no `Origin` header, which is why `PAYMASTER_RPC_ALLOW_MISSING_ORIGIN=true`; with `BUNDLER_SHARED_SECRET` enabled it cannot pass (it cannot send the header), so test with the secret disabled. The app must allow the TapScore destination (`0x261eA5971B93237a56990206A46Bc80318e4d078`) in both `apps.json` and `allowlist.json`.

Afterwards confirm accounting, on the VPS:

```sh
sudo pepu-pm2 logs pepu-paymaster --lines 200 --nostream | grep executed-reconciler | tail -3   # marked>0, unmatched=0 within ~1 minute
curl -s http://127.0.0.1:8788/ready                                                               # deposit dropped by the real cost
```

## 9. Monitoring and operations

**Alerts and heartbeat** (checker unchanged from the Docker kit: bundler chain id + EntryPoint, paymaster `/health`, policy `/ready`, chain RPC, deposit LOW/HIGH, executor float, TLS expiry, heartbeat ping on every green run):

```sh
sudo -u pepu crontab -e         # paste the lines from $KIT/crontab.example (health every 5 min, backup daily 03:17)
# test it once: run by hand, then set DEPOSIT_LOW_WEI absurdly high in /etc/pepu/monitor.env, run again,
# expect one alert, revert, run again, expect one RECOVERED message
sudo -u pepu $KIT/scripts/healthcheck-cron.sh; echo "exit=$?"
```

Set `HEARTBEAT_URL` to a dead-man's-switch service (healthchecks.io style) so a dead VPS or cron also alerts you. Outside this kit: an external uptime ping on both `/health` URLs, and CPU/disk alerts from the VPS provider.

**pm2 monitoring** (all through the wrapper, which targets pepu's daemon):

```sh
sudo pepu-pm2 status                       # both online, restart count, memory
sudo pepu-pm2 monit                        # live CPU/memory/log view
sudo pepu-pm2 describe pepu-paymaster      # uptime, restarts, unstable restarts, log paths
sudo pepu-pm2 logs --lines 100             # follow; add --nostream for a snapshot
```

A restart count that keeps growing, or `max_memory_restart` (Alto 1200M, policy 400M) triggering, is the signal to look. Tune those in `ecosystem.config.cjs`, then `deploy.sh --no-pull`.

**Logs.** pm2: `/var/log/pepu/pepu-*.{out,err}.log` (rotated by pm2-logrotate). nginx: `/var/log/nginx/pepu-bundler.access.log`, `pepu-paymaster.access.log` (JSON, token redacted; rotated by the stock logrotate rule). Things to grep: `unmatched=` non-zero in the reconciler line (the paymaster paid for something this service did not approve: possible key leak, investigate), `global_circuit_breaker_tripped` (daily ceiling hit), `Origin not allowed`, nginx `"status":429`.

**Admin actions** (on the VPS only; `/admin/*` is never public). `policy-cli` runs the CLIs with the service's exact environment and works while the service runs (SQLite WAL):

```sh
CLI="sudo -u pepu /opt/pepu/node/22.21.1/bin/node $KIT/bin/policy-cli.cjs"
$CLI reset-circuit-breaker
$CLI reset-spend-counters --user sender:0x...      # support: clear one user's counters
```

**Single instance.** Cap accounting assumes one process owns the SQLite file. The ecosystem file pins `instances: 1`, fork mode. Never use cluster mode, never raise `instances`, never start the app under a second pm2 daemon or a second host against the same file. High availability needs a shared database design, not more instances.

**Backups and restore.** The cron snapshots the DB (`VACUUM INTO` + `integrity_check`) to `/var/lib/pepu/backups` (gzip, 14 days). Set `BACKUP_UPLOAD_CMD` in the cron line to copy it off the VPS; a backup on the same disk is not a backup. Restore:

```sh
sudo pepu-pm2 stop pepu-paymaster
gunzip -c /var/lib/pepu/backups/policy-YYYYMMDDTHHMMSSZ.db.gz | sudo -u pepu tee /tmp/policy.restore.db >/dev/null   # or copy it in from off-box
sudo -u pepu bash -c 'rm -f /var/lib/pepu/db/policy.db-wal /var/lib/pepu/db/policy.db-shm && install -m 600 /tmp/policy.restore.db /var/lib/pepu/db/policy.db' && rm -f /tmp/policy.restore.db
sudo pepu-pm2 start pepu-paymaster
```

**Edge changes.** Origins: edit `/etc/nginx/conf.d/pepu-origins.conf` AND `PAYMASTER_RPC_ALLOWED_ORIGINS` in `/etc/pepu/policy-service.env` (then `sudo pepu-pm2 restart pepu-paymaster --update-env`); `sudo nginx -t && sudo systemctl reload nginx`. Rate limits: the `rate=` values in `pepu-zones.conf` and the `burst=` values in the site files.

## 10. Upgrades and rollback

**Update to the latest main** (git install):

```sh
sudo git -C /opt/pepu/app log --oneline HEAD..origin/main 2>/dev/null   # (after a fetch) review what is coming
sudo $KIT/deploy.sh                       # snapshot DB, fast-forward, build, reload, wait for /health, print /ready
```

The apps restart (fork-mode `pm2 reload` is a restart): expect a few seconds of 502 JSON from nginx. Nothing is lost; state is in SQLite. `deploy.sh --dry-run` shows the plan first. Without git (tarball install) see the end of section 3.

**Roll back the code.** `deploy.sh` prints the previous commit; or read `/var/lib/pepu/deploy-history.log`:

```sh
sudo $KIT/deploy.sh --ref <previous-commit-or-tag>
```

DB migrations in the service are additive (new tables/columns only), so an older build runs against a newer database; restore a snapshot (section 9) only if data itself is damaged. Do not bump Alto casually (see the main runbook's "Alto upgrade").

**Take it offline immediately** (e.g. suspected key leak: also `removeSigner` on chain first, see main runbook 5.6):

```sh
sudo rm /etc/nginx/sites-enabled/bundler.pepeunchained.com.conf /etc/nginx/sites-enabled/paymaster.pepeunchained.com.conf
sudo nginx -t && sudo systemctl reload nginx        # other sites are unaffected
sudo pepu-pm2 stop all                               # optional: stop the services too
```

**Uninstall completely** (reverse of install; keeps your other sites): remove the two site symlinks and files, `/etc/nginx/conf.d/pepu-*.conf`, `/etc/nginx/snippets/pepu-*.conf`, reload nginx; `sudo systemctl disable --now pm2-pepu`; `sudo pepu-pm2 delete all && sudo pepu-pm2 kill`; `sudo certbot delete --cert-name bundler.pepeunchained.com` (and paymaster); then `sudo rm -rf /opt/pepu /var/log/pepu /usr/local/bin/pepu-pm2`; keep or remove `/etc/pepu` and `/var/lib/pepu` (they hold keys and the DB: back up first), and `sudo userdel pepu`.

## 11. After hosting is live: the SDK, docs and MCP swap

Done (wp/go-live). The hosted URLs live in exactly one place: `PEPU_HOSTED` in `packages/sdk/src/endpoints.ts` (see also `RELEASING.md`, "Hosted endpoints: the swap point"). It sets `bundlerUrl` to `https://bundler.pepeunchained.com` and `paymasterBaseUrl` to `https://paymaster.pepeunchained.com`. `paymasterUrl` stays `null` on purpose: v2 serves ERC-7677 at `<base>/v2/paymaster/<token>`, the URL always embeds a project token, and the SDK builds it with `buildErc7677Url` / `hostedErc7677Url(token)`. `createPaymasterApi`, the probes, `checkSponsorship` and the doctor default to the base.

To change the URLs later:

```sh
pnpm --filter @pepu-chain/sdk test
pnpm --filter @pepu-chain/sdk build
node scripts/gen-docs.mjs                         # regenerates docs/reference/endpoints.md and docs/llms*.txt
pnpm --filter @pepu-chain/mcp snapshots           # bundled MCP docs
node scripts/gen-docs.mjs --check && node scripts/check-docs-parity.mjs && node scripts/check-links.mjs
pnpm --filter @pepu-chain/mcp test
```

Then hand-edit the prose pages that quote the URLs and release the SDK and MCP server together.

Browsers on documented domains must be in the nginx origin map and in `PAYMASTER_RPC_ALLOWED_ORIGINS` first, or they get a 403. A project client token additionally needs the project's allowed origins set (otherwise `project_origin_not_allowed`).

## 12. Decisions the owner must make

| Decision | Where it lands | Starting point in the templates |
|---|---|---|
| Executor float | funding amount; `EXECUTOR_MIN_WEI` | 200 PEPU funded, alert below 100 (50 may do) |
| Deposit cap (blast radius) | withdraw excess (5.4); `DEPOSIT_LOW_WEI`, `DEPOSIT_HIGH_WEI`, `READY_MIN_/MAX_DEPOSIT_WEI` | currently ~1,943 PEPU on chain; templates assume 250 target, 100 low, 500 high |
| Global daily ceiling | `GLOBAL_DAILY_SPEND_CEILING_WEI` | 100 PEPU/day, at or below the deposit |
| Per-user caps | `USER_*` in `policy-service.env` | 20/100/2000 ops; 25/100/1000 PEPU (hour/day/lifetime) |
| Allowed frontend origins | `nginx/conf.d/pepu-origins.conf` and `PAYMASTER_RPC_ALLOWED_ORIGINS` (keep in sync) | `pepeunchained.com`, `www`, `guide` (placeholders) |
| Webhook (Slack/Discord) URL | `WEBHOOK_URL` in `monitor.env` | empty = no alerts |
| Heartbeat (dead-man's switch) URL | `HEARTBEAT_URL` in `monitor.env` | empty = off |
| Bundler shared secret | `nginx/conf.d/pepu-bundler-key.conf` + `monitor.env` | off (public bundler) |
| Public SDK paymaster default | section 11 | decided: hosted base only; the ERC-7677 URL needs a project token |
| Retire the dev signer/executor on chain | 5.5 | recommended after go-live |
| Backup destination | `BACKUP_UPLOAD_CMD` in the cron line | none (local only) |
| Alto Node version | section 1 | 24.4.1 (proven) rather than 22.21.1 |
| IPv6 | uncomment `listen [::]` lines if the names get AAAA records | off |
| Code delivery | clone (needs repo access) or tarball | either |
| Let's Encrypt contact e-mail | the two `certbot` commands | `ops@pepeunchained.com` placeholder |

## 13. Production checklist

- [ ] Preflight (section 2) clean: 4337/8788 were free, other sites unaffected (`nginx -t` before and after)
- [ ] ufw/provider firewall: only SSH, 80, 443 inbound; `nc -vz <SERVER_IP> 4337` and `8788` fail from outside
- [ ] `ss -ltnp` shows 4337 and 8788 on 127.0.0.1 only
- [ ] Fresh signer and executor keys; `signers(new)` and `isBundlerAllowed(executor)` both true on chain
- [ ] Dev keys not on the VPS (`ls /etc/pepu/secrets`, no `.keys.env` under `/opt/pepu`)
- [ ] Executor float and deposit are the numbers the owner chose; ceiling at or below the deposit
- [ ] Both certificates issued, `certbot renew --dry-run` passes, `http://` redirects (308)
- [ ] `/admin/*`, `/ready`, `/metrics`, `/v2/*`, `//x` all 404 publicly; bad Origin 403; oversize body 413; rate limit 429
- [ ] Token absent from `/var/log/nginx/pepu-*.log`
- [ ] `prove-session` against the hosted URLs succeeded and the reconciler logged `marked>0 unmatched=0`
- [ ] `pm2-pepu` enabled, `pepu-pm2 save` done, pm2-logrotate configured; exactly ONE `pepu-paymaster`
- [ ] Cron installed; alert and recovery tested; heartbeat configured
- [ ] A backup ran once, was copied off the VPS, and a restore was rehearsed

## 14. Not verified (do not assume)

- Everything that touches the real VPS: `install.sh` and `deploy.sh` running for real (only `--dry-run` and shellcheck/syntax were done), user creation and permissions, the Node tarball downloads and checksums on that machine, `npm ci` on Linux, pm2 7.0.4 starting both apps and `pm2 startup`, `pm2-logrotate` settings, reboot persistence, the `pepu-pm2` wrapper's sudo behavior.
- nginx behavior on the VPS's actual nginx version and its other server blocks (tested on 1.24.0 and 1.28.0 with a clean config; a `default_server` or a conflicting `log_format`/zone name elsewhere would show up in `nginx -t`).
- certbot issuance (needs the real DNS, port 80 and the VPS), renewal, the deploy hook.
- Alto 0.0.21 on Node 22.21.1 end to end (modules and CLI load only), and Alto under pm2 with the loopback preload (the preload was verified with fastify and with the policy service, not with a live Alto against the chain RPC).
- Graceful shutdown timing under pm2 (`kill_timeout` 20 s against the service's 10 s deadline) was read from the code, not exercised; pm2 sends SIGINT first, which both services handle.
- Behavior behind a CDN or second proxy: this kit assumes a direct A record to nginx (one hop).
