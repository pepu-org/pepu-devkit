# Operating the Bundler

Runbook for anyone running the PEPU Alto bundler: locally for development, or as a hosted service. The source is `services/bundler` in the repository. Read [Bundler Overview](overview.md) first for what the service is and why it is configured the way it is.

PEPU runs this bundler as the hosted service at `https://bundler.pepeunchained.com`, behind nginx and pm2 (see the hosting kit in `deploy/`). Treat "Hosting readiness" as the requirements for any hosted deployment, including your own. `docker-compose.yml` is a starting point; adjust it for your environment.

## Prerequisites

- Node.js v24.4.1 or later.
- A PEPU mainnet RPC URL. The Conduit URL embeds an API key, so the whole URL is a secret.
- A **fresh executor key** (an EOA used only by the bundler) with a small PEPU float. Never reuse a deploy key or a key that holds meaningful funds.

## Run it locally

From `services/bundler`:

```bash
cp .env.example .env
# edit .env: set ALTO_RPC_URL and ALTO_EXECUTOR_PRIVATE_KEYS

npm install
npm start          # alto run --config alto.config.json, listens on :4337
```

Confirm it is alive:

```bash
npm run healthcheck
```

or by hand:

```bash
curl -s -X POST http://localhost:4337 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"0x17dcd"}
```

Alto reads its config **once at startup**; there is no hot reload. After any change to `alto.config.json` or `.env`, restart the process and confirm the new process started after the file changed.

### Configuration files

| File | Contents | Committed |
|---|---|---|
| `alto.config.json` | EntryPoints, chain type, safe mode, CORS, ports and so on. No secrets | Yes |
| `.env` | `ALTO_RPC_URL`, `ALTO_EXECUTOR_PRIVATE_KEYS` | **No**, never |
| `alto.config.unsafe-diagnostic.json` | Same shape on port 4338, for running a second isolated instance to compare behavior | Yes |

Alto's CLI maps every `ALTO_`-prefixed environment variable onto the matching `--kebab-case` flag. That is how the RPC URL and keys reach it without being written into the committed config or passed as arguments (which would leak into process listings). Never put either in `alto.config.json`.

| Variable | What it is |
|---|---|
| `ALTO_RPC_URL` | PEPU mainnet RPC URL (secret: embeds the API key) |
| `ALTO_EXECUTOR_PRIVATE_KEYS` | Comma-separated executor private key(s) (secret) |
| `ALTO_UTILITY_PRIVATE_KEY` | Refills executors below the minimum balance. Deliberately unset; `refilling-wallets` is `false` |
| `ALTO_LOG_LEVEL` | Optional override of `log-level` (default `info`) |

## Docker

`services/bundler/docker-compose.yml` runs `ghcr.io/pimlicolabs/alto:v1.2.8`, mounts `alto.config.json` read-only, reads secrets from `.env`, publishes `4337:4337` and has a Node-based `eth_chainId` health check. Note the following:

- The `v1.2.8` image corresponds to `@pimlico/alto@0.0.20`, one release behind the `0.0.21` that the npm path pins. Track the Alto repository for a newer image tag before relying on the container.
- Validate the container with `npm run healthcheck` equivalents and a real `scripts/estimate-kernel-userop.mjs --send` before relying on it.

Bind to `127.0.0.1:4337:4337` if the host is internet-facing and you want only the proxy to reach Alto.

## Hosting readiness

What a hosted deployment needs (PEPU publishes `PEPU_BUNDLER_URL` as `https://bundler.pepeunchained.com`; use this list for your own):

| Requirement | Detail |
|---|---|
| Containerised service | Docker or compose (or an equivalent platform) with a restart policy, instead of a foreground `npm start`. Validate `docker-compose.yml` first |
| Reverse proxy in front | Fixed hostname, TLS, `Origin` filtering (Alto reflects any origin), rate limiting and request size limits. Alto should not be reachable except through it |
| Fresh executor key, small float | A key created for this service only, funded with a bounded amount and topped up on a schedule. See the next section |
| Secrets management | RPC URL and executor key in a secrets manager or the host's protected environment, never in the repository. Plan key rotation |
| More than one executor | Production should use several executor keys so one in-flight bundle does not block the next. The default configuration uses one |
| Monitoring and alerting | Alert on health-check failure, executor balance, process exit and error rate. Ship the JSON logs somewhere searchable |
| Stable URL | Tunnels change URL on restart and break every Privy Dashboard that has the old URL pasted in |
| Safe-mode decision | Off because of the Alto 0.0.21 bug. Re-test on each Alto release. Do not expose the RPC to untrusted submitters while off without the proxy controls above |

## Executor funding

- The executor EOA signs and submits every `handleOps` transaction and pays gas up front, then is reimbursed per operation from each payer's EntryPoint deposit (the sender's own, or the paymaster's).
- **If it runs dry, `eth_sendUserOperation` is still accepted but bundles never land.** Estimation does not need executor funds, so the bundler keeps looking healthy to clients. This is the most common silent failure.
- Operations on mainnet cost 3 to 8 PEPU in gas each. Keep the float small on purpose (it is a hot key) but large enough for hours of runway.
- Top up with any normal PEPU transfer to the executor address, or `node scripts/fund-address.mjs`.
- A smart account that sends **without** a paymaster must hold enough PEPU to pay its own prefund. That is a per-account concern, not something the bundler can fix.

## Monitoring

`npm run healthcheck` (`scripts/healthcheck.js`) runs four independent checks and exits `0` if all pass, `1` otherwise:

1. **Bundler responding**: `eth_chainId` against the bundler's port, and it must be `0x17dcd`.
2. **Chain RPC reachable**: `eth_blockNumber` straight against `ALTO_RPC_URL`, so an RPC outage can be told apart from a bundler outage.
3. **EntryPoints reachable**: `eth_supportedEntryPoints` must list both v0.6 and v0.7.
4. **Executor funded**: every executor address derived from `ALTO_EXECUTOR_PRIVATE_KEYS` must hold at least `ALTO_HEALTHCHECK_MIN_EXECUTOR_BALANCE_PEPU` (default 500). Only the address is ever printed.

Wire it into the supervisor, a container health check or an uptime checker. Alert on:

- Any health-check failure, especially executor balance.
- Alto process exit.
- A sustained rise in `eth_sendUserOperation` errors, especially the `0x99410554` signature (it means safe mode was switched back on).

Client-side, `probeBundler` (SDK) and `pepu_bundler_health` (MCP) give an external view without needing server access.

When the bundler is down, every UserOperation flow stops: nothing can be estimated or submitted. Receiving funds and reading balances still work, because they go straight to the chain RPC.

## Verify a change

1. Restart the process.
2. `npm run healthcheck`.
3. `node scripts/estimate-kernel-userop.mjs` confirms gas estimation.
4. `node scripts/estimate-kernel-userop.mjs --send` confirms a real operation lands. It costs a few PEPU of real gas and is the only check that sending works: a successful estimate is not enough (the safe-mode bug affects only sending).

## Limitations

- Single executor key, no utility wallet (refilling is off).
- `safe-mode: false` as a tracked workaround for the Alto 0.0.21 bug.
- The `docker-compose.yml` image is one Alto release behind the npm package.
- `arbitrum-base-fee-multiplier` (150) and `block-time` (5000 ms) are default values; tune them for your load.
- No rate limiting or origin allowlist at the Alto layer.
- This service never sponsors gas. Do not describe it as gasless.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Healthcheck: executor below threshold | Float is low | Top up the executor address |
| Healthcheck: wrong chain | `ALTO_RPC_URL` points at another network | Use the mainnet RPC |
| 500 with `0x99410554` | Safe mode on | Set `safe-mode` to `false` and restart |
| Browser `Failed to fetch` | CORS off, or an old process is still serving the port | Enable CORS, restart, verify the new process is the one listening |
| Config edit ignored | Alto does not hot reload | Restart |

## Related

- [Bundler Overview](overview.md)
- [Bundler JSON-RPC API](api.md)
- [Paymaster Overview](../paymaster/overview.md)
- [Infrastructure Map](../overview.md)
