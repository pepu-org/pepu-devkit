# AGENTS.md -- services/bundler

Guidance for an AI agent (or a human moving fast) working in this specific
directory. Read `README.md` first for what this service *is* and the full
verification story -- this file is about how to work on it safely.

## Scope

This directory is a self-hosted ERC-4337 Alto bundler for PEPU mainnet
(chain 97741). It is **not** a paymaster and does not sponsor gas for
anyone -- see `services/paymaster/` (a separate service, out of scope here)
for that. Do not blur this line in comments, commit messages, or anything
user-facing generated from this service.

## Hard rules

- **Never print, log, commit, or otherwise surface a private key.**
  `ALTO_EXECUTOR_PRIVATE_KEYS` (in the gitignored `.env`) and any owner key
  used in a test script are secrets. When a script needs a key's *address*,
  derive it (`privateKeyToAccount(key).address`) and only ever
  print/return the address -- see `scripts/healthcheck.js` and
  `scripts/fund-address.mjs` for the established pattern.
- **Never commit `.env`.** `.gitignore` already blocks it; don't work
  around that.
- **Never invent an Alto CLI flag or config key.** Alto's config surface
  changes between versions. If you need a flag that isn't already in
  `alto.config.json`, verify it against the actually-installed
  `node_modules/@pimlico/alto` source (or the matching tag/commit of
  `pimlicolabs/alto` on GitHub) before adding it, and state the version you
  verified against in a comment or commit message.
- **Don't claim something works without having observed it working.** This
  service's history includes a real, non-obvious bug (see "The safe-mode
  bug" in README.md) that looked like a signature problem before it was
  traced to Alto's own decode logic. If you change gas estimation, signing,
  or the bundler config, re-run `scripts/estimate-kernel-userop.mjs --send`
  and read the actual response before saying it works.
- **A precisely-reported failure is more useful than a vague success.** If
  something breaks, capture the exact error, the exact request that
  triggered it, and (if it's an Alto-internal error) trace it to the
  actual line in `node_modules/@pimlico/alto` before guessing at a fix.

## Layout

```
alto.config.json                    -- production config (committed, no secrets)
alto.config.unsafe-diagnostic.json  -- same shape, different port (4338), for
                                        spinning up a second isolated instance
                                        to compare behavior without touching
                                        the production process (this is how
                                        the safe-mode bug was isolated)
.env.example / .env                 -- secrets (RPC URL, executor key); .env
                                        is gitignored and must never be committed
docker-compose.yml                  -- unexecuted (no Docker in dev env), see README
scripts/
  estimate-kernel-userop.mjs        -- the reusable end-to-end proof script:
                                        builds a real Kernel v3.1 UserOp,
                                        estimates it, optionally sends it
  fund-address.mjs                  -- sends plain native PEPU from a funder
                                        key to a target address (used to fund
                                        a counterfactual smart account's prefund)
  healthcheck.js                    -- operational healthcheck, see README
                                        "Monitoring"
.throwaway-owner-key.json           -- gitignored, cached disposable owner key
                                        used by estimate-kernel-userop.mjs;
                                        controls no funds directly, safe to
                                        delete to force a fresh account
```

## Before touching `alto.config.json`

Read the config table in `README.md` first -- every key there has a
one-line justification for its current value, sourced from either a live
check against this chain or a specific upstream doc/source citation.
Changing a value without updating that table's justification is how this
file drifts out of sync with reality. In particular:

- `safe-mode` is currently `false` **as a deliberate, evidenced workaround
  for a confirmed Alto 0.0.21 bug**, not a permanent design choice. Read
  "The safe-mode bug" in README.md in full before changing it back to
  `true` -- and if you do, re-verify with
  `node scripts/estimate-kernel-userop.mjs --send` before trusting it.
- `chain-type: "arbitrum"` and `arbitrum-base-fee-multiplier` exist
  specifically to handle PEPU's Arbitrum-Nitro dual-fee gas model (L2
  execution + L1 data posting). Don't remove these to "simplify" the
  config -- they're load-bearing for correct gas estimation on this chain.

## Verifying a change

1. `npm start` (or restart the already-running process -- **Alto reads its
   config file once at startup; there is no hot reload**, so a config edit
   does nothing to an already-running process until it's restarted).
2. `npm run healthcheck` -- confirms the process is up, talking to the
   right chain, both EntryPoints are reachable, and the executor EOA is
   funded.
3. `node scripts/estimate-kernel-userop.mjs` -- confirms gas estimation
   still works.
4. `node scripts/estimate-kernel-userop.mjs --send` -- confirms a real
   UserOperation still lands on-chain. This costs real PEPU (a few PEPU in
   gas per run; see README "Proof of life" for actual observed costs) and
   is not free to run repeatedly without limit, but it is the only thing
   that actually proves `eth_sendUserOperation` works end to end -- gas
   estimation succeeding is not sufficient proof, as the safe-mode
   investigation demonstrated directly.

## Known environment gotcha (not specific to this service)

While investigating the safe-mode bug, a second Alto instance was started
on port `4338` for isolated comparison
(`alto.config.unsafe-diagnostic.json`). Background processes started with
a tool's own "run in background" plumbing were observed to get reaped
between separate tool invocations in this sandbox; a process backgrounded
with a plain shell `(cmd &)` inside one invocation, by contrast, persisted
across later invocations. If you need a genuinely long-lived second
instance for comparison testing, prefer the latter pattern and confirm
with `netstat`/`Get-CimInstance Win32_Process` that it's actually still
listening before relying on it.

## Known gaps

See README.md "Known gaps" for the full, current list (single executor
key, no refill wallet, `safe-mode: false` as a tracked workaround,
unexecuted `docker-compose.yml`, un-load-tested Arbitrum fee multiplier and
block time). Don't silently "fix" any of these by guessing -- they're
documented gaps because closing them properly needs something (a second
funded key, a Docker-capable environment, real load data) that wasn't
available when this service was built.
