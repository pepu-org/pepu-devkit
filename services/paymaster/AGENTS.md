# AGENTS.md -- services/paymaster

Guidance for an AI agent (or a human moving fast) working in this specific
directory. Read `README.md` first for what this service *is*, the
byte-layout cross-check, every policy rule, and the full threat model —
this file is about how to work on it safely.

## Scope

This directory is the ERC-4337 v0.7 verifying paymaster for PEPU mainnet
(chain 97741): `contracts/` (the on-chain `PepuVerifyingPaymasterV7`) and
`policy-service/` (the off-chain service that decides whether to sign a
sponsorship). It is **not** a bundler — that's `services/bundler/`, a
separate service maintained separately; read it for reference if needed,
never edit it from here.

## Hard rules

- **Never print, log, commit, or otherwise surface a private key.**
  `PAYMASTER_SIGNER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, and
  `FUNDING_PRIVATE_KEY` (all in the repo-root, gitignored `deploy/.keys.env`)
  are secrets. When code needs a key's *identity*, derive and log only its
  **address** (`privateKeyToAccount(key).address`) — see `src/config.ts`'s
  `loadConfig` (validates the signer address, never logs the key) and
  `src/cli/monitor-deposit.ts` (funding account address only) for the
  established pattern.
- **Never broadcast `contracts/deploy-paymaster.sh` without `--broadcast`
  being the user's own explicit, deliberate choice.** Default (no args) is
  a dry-run/plan that sends zero transactions — that's what to run and
  show the user; `--broadcast` sends real money and is the user's call to
  make, not an agent's.
- **Never invent an ABI, a Foundry/`cast` flag, or a viem API.** Verify
  against the actually-installed source first:
  `contracts/lib/account-abstraction-v7/` and
  `contracts/lib/openzeppelin-contracts-v5.0.2/` for Solidity interfaces;
  `policy-service/node_modules/viem/` for the exact viem version pinned
  (`2.56.8`) and its actual exports. `forge <cmd> --help` /
  `cast <cmd> --help` (via `~/.foundry/versions/stable/{forge,cast}`,
  **not** foundry-zksync, which shadows `forge`/`cast` on PATH on this
  machine) is the source of truth for flags — several were verified this
  way this session (`forge create --constructor-args`, `forge
  verify-contract --chain-id`, `cast send --json`'s field names) rather
  than assumed from memory or another chain's conventions.
- **The contract has no on-chain spending cap.** Every safeguard is the
  policy service's job. Don't add a "quick" contract-side cap without
  understanding this is a deliberate architectural choice (see README
  "Why a verifying paymaster, and why the contract has no caps") — and
  don't remove or weaken an off-chain check on the assumption "the
  contract will catch it," because it won't.
- **A one-byte disagreement in the hash byte-layout is the most dangerous
  possible bug here** — it doesn't error loudly, it produces an opaque
  `AA33 reverted` from the bundler, discovered whenever someone actually
  submits a sponsored op. Any change to `contracts/src/PepuVerifyingPaymasterV7.sol`'s
  `_getHash`/`getHash`, `BaseSingletonPaymaster.sol`'s
  `_parsePaymasterAndData`/`_parseVerifyingConfig`, or
  `policy-service/src/{paymasterData,userOpHash}.ts` **must** be
  re-verified against `contracts/test/PaymasterHashCrossCheck.t.sol` +
  `policy-service/test/paymasterHashCrossCheck.test.ts` (see README for how
  the frozen golden-hash constant in both files was derived) before being
  considered done.
- **Don't claim something works without having observed it working.**
  This service's own history includes two examples worth knowing about:
  (1) `policy-service`'s `npm start`/`npm run dev` scripts looked correct
  but silently never ran on this machine's Node version until traced to a
  `.js`-vs-`.ts` import-resolution gap and fixed via a real build step
  (`tsup.config.ts`); (2) `src/db.ts`'s plain `node:sqlite` import
  typechecked and ran fine standalone but broke the entire test suite
  under this exact vitest/vite-node version, traced into vite-node's own
  source before finding the actual fix (`process.getBuiltinModule`, see
  README "A real bug found and fixed while getting this to actually run").
  Both were caught by actually running things, not by reading the code and
  assuming it worked.

## Layout

```
contracts/
  src/PepuVerifyingPaymasterV7.sol       the contract (fork of Pimlico's
                                           SingletonPaymasterV7, ERC-20 mode
                                           deleted -- see its own NatSpec)
  src/base/                              BasePaymaster, BaseSingletonPaymaster,
                                           ManagerAccessControl, MultiSigner
  test/PepuVerifyingPaymasterV7.t.sol     17 security tests (signature,
                                           bundler allowlist, multisigner,
                                           access control, time windows)
  test/PaymasterHashCrossCheck.t.sol      the byte-layout cross-check (1/2)
  deploy-paymaster.sh                     plans by default; --broadcast to send
  deployed-address.txt                    written after a real deploy (public
                                           address, not a secret)

policy-service/
  src/
    privyAuth.ts        Privy token verification + sender-ownership check
    kernelDecoder.ts     Kernel v3 execute() calldata decoder (deny-by-default)
    allowlist.ts         two-layer (global AND per-app) destination check
    appRegistry.ts       API-key (hashed) -> app resolution
    db.ts                sqlite-backed cap/spend accounting + audit log
    cost.ts              worst-case sponsorship cost formula
    paymasterData.ts      builds the 65-byte paymasterAndData hash prefix
    userOpHash.ts          reproduces the contract's _getHash, signs it
    policy.ts             PolicyEngine.evaluate -- the ordered pipeline
    server.ts             minimal node:http layer (/health, /sponsor, /admin/*)
    config.ts             env/config loading, fails fast on bad config
    depositMonitor.ts      pure top-up-amount arithmetic (unit-tested)
    cli/
      hash-api-key.ts            prints sha256(rawKey) for apps.json
      reset-circuit-breaker.ts   admin CLI, works directly on the db file
      monitor-deposit.ts         status / watch / top-up for the EntryPoint deposit
  test/                  59 tests, 6 files -- see README "Automated tests"
  integration-test.mjs   live E2E: Kernel UserOp -> policy-service -> bundler
  tsup.config.ts         REQUIRED for `npm run build`/`start` to work -- see
                          README "Why npm run build && node dist/index.js"
  config/
    allowlist.json       ships EMPTY -- populate before real use
    apps.json            ships one documented example app
```

## Before touching the hash/signature scheme

Read the "byte-layout cross-check" section of README.md in full, then:

1. Make your change in exactly one place (contract or service).
2. Update the fixed test vector / expected values in **both**
   `contracts/test/PaymasterHashCrossCheck.t.sol` and
   `policy-service/test/paymasterHashCrossCheck.test.ts` if the change was
   intentional (e.g. a genuinely new field order) -- see each file's own
   comment for exactly how the frozen constant was derived, so you can
   re-derive it rather than guessing a new one.
3. Run both: `forge test --match-contract PaymasterHashCrossCheckTest -vv`
   and `npm test -- test/paymasterHashCrossCheck.test.ts`. Both green
   is the only acceptable outcome before calling this done.

## Verifying a change

- **Contracts:** `cd contracts && forge test` (18/18 expected). For a
  deploy-script change, run it with **no** arguments first (dry-run) and
  read the PLAN output carefully — especially the creation-bytecode-hash
  reconfirmation and the already-deployed guard — before ever suggesting
  `--broadcast` to the user.
- **Policy service:** `cd policy-service && npm run typecheck && npm test`
  (59/59 expected), then `npm run build && npm start` and hit
  `GET /health` for a real liveness check. A `POST /sponsor` with no
  `Authorization` header should return `401
  {"reason":"invalid_or_expired_token"}` — this is the cheapest real
  smoke test that doesn't need a Privy account, and was used repeatedly
  this session to prove the server is actually live (not just that it
  compiled).
- **Integration:** `node integration-test.mjs` (run from `policy-service/`,
  needs the bundler on `:4337` and the policy service running). Read
  README.md "Integration test" for exactly how far this got in this
  session and why, before assuming a different result without having
  re-run it.

## Known gaps

See README.md "Known gaps" for the full, current list (no on-chain
reconciliation/monitoring for signer-key compromise, no dedicated funding
key, allowlist/app-registry ship with placeholder/empty config, the
integration test's gas-estimation-before-sponsorship ordering). Don't
silently "fix" any of these by guessing — they're documented gaps because
closing them properly needs something (a deployed+indexed contract, a
funded dedicated key, a real Privy login flow) that wasn't available when
this pass was done.
