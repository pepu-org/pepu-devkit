---
name: pepu-debug-transaction
description: Diagnoses a failed, stuck, denied or unexpectedly expensive transaction, UserOperation or Privy/paymaster/session error on Pepe Unchained (PEPU) V2 mainnet (chain 97741). Starts with the MCP tools pepu_explain_tx, pepu_explain_error and pepu_known_gotchas and the SDK's explainError, describeUserOpFailure and toErrorResponse, then covers revert decoding, the Multicall3 canonical-address trap, Nitro's dual-fee gas, debug_traceCall on the gated Conduit RPC, eth_getLogs pagination, session-signer denials and sponsorship denials. Use whenever a PEPU transaction reverted, never landed, a sponsored send was denied, a session action returned 409, login or wallet creation misbehaves, or an error message needs a cause and a fix.
---

# Debugging on PEPU

Most "mysterious" PEPU failures are in the SDK's error catalog. Ask the tools before reasoning from scratch.

## When to use

- A transaction reverted, is stuck, or cost more than expected.
- A sponsored send or session action was denied (`PAYMASTER_*`, `SESSION_*`, `BUNDLER_*`, `AAxx`).
- Login or wallet creation failed, or any error string needs explaining.

## Chain facts

Chain 97741, mainnet only, ArbOS 51 (Nitro). Generated facts and addresses: [reference/chain-facts.md](reference/chain-facts.md). Rules: [reference/rules.md](reference/rules.md).
Gas is high in gwei (about 12,500) and that is normal; RPC `eth_getLogs` is capped at 2,000 blocks; `debug_*` needs a Conduit key.

## SDK functions to use

```ts
import { explainError, toPepuError, toErrorResponse, PepuError, PEPU_ERROR_CATALOG, explorerLinks, estimateTransactionCost, formatPepu } from "@pepu-chain/sdk";
import { describeUserOpFailure, redactSecrets, checkSponsorship, getPaymasterDeposit } from "@pepu-chain/sdk/aa";
import { mapPaymasterReason } from "@pepu-chain/sdk/paymaster";
import { checkPepuEnv } from "@pepu-chain/sdk/doctor";
```

`explainError(e)` takes an Error, a message string or raw revert hex and returns `{ code, title, cause, fix, docsUrl, matched }`. Pure, synchronous, never throws.

## MCP tools to call first

1. `pepu_explain_tx` with `hash` (a transaction hash, or a UserOperation hash when a bundler URL is configured): what it was (EOA transaction or UserOperation), sender vs owner, who paid gas, status, fee in PEPU, explorer links.
2. `pepu_explain_error` with `error` (message text, a paymaster reason code such as `project_not_claimed_onchain`, or raw `0x` revert data): catalog match, decoded revert, fix, docs link. (`pepu_decode_error` is the older revert-only decoder.)
3. `pepu_known_gotchas`: the full curated list of PEPU footguns.
4. For env or dashboard suspects: `pepu_check_env`, `pepu_check_privy_config`. For sponsorship: `pepu_sponsorship_status`, `pepu_bundler_health`, `pepu_paymaster_health`.
5. `pepu_get_transaction`, `pepu_estimate_gas_cost`, `pepu_verify_contract_status` for raw details and the ABI.

## Steps

1. **Classify.** Run `pepu_explain_tx` on the hash. Check `status` before anything else: a reverted transaction, a UserOperation that was never included, and a request a policy denied before it became a transaction are three different problems.
2. **Explain the message.** Paste the exact text, never a paraphrase, into `pepu_explain_error` (or `explainError(e)` in code). A `matched: "catalog"` result has the cause and the fix. In an API route, return `toErrorResponse(e)` so clients get `{ error: { code, message, hint } }`.
3. **Decode a bare revert.** If the reason is missing, replay the call at its block: `cast call <to> <calldata> --rpc-url <rpc> --block <n>`. A verified contract's ABI (`pepu_verify_contract_status`, format `detailed`) decodes custom errors.
4. **Work the family below.**

### Family: sponsorship and UserOperations

`describeUserOpFailure(e)` turns a raw bundler or paymaster failure into a typed `PepuBundlerError` or `PepuPaymasterError` with a hint and secrets redacted (`redactSecrets`). Codes: `BUNDLER_AA_FAILED` (AA21 prefund missing, AA23 signature or validation reverted, AA25 invalid nonce, AA31/AA33/AA34 paymaster problems), `BUNDLER_UNREACHABLE`,
`PAYMASTER_DENIED`, `PAYMASTER_DESTINATION_NOT_ALLOWED`, `PAYMASTER_IDENTITY_REQUIRED`, `PAYMASTER_NO_BALANCE`, `PAYMASTER_CAP`, `PAYMASTER_RATE_LIMITED`, `PAYMASTER_PROJECT_*`. Start with `pepu_sponsorship_status`; fixes are listed there. See `pepu-sponsored-transactions`.

### Family: sessions

- **Privy mode** (`pepu-session-keys`): a denial or broadcast failure is a failed transaction, not a lost session; only `409 SESSION_NONE` means no signer. Check in order: policy mismatch (method `eth_signTransaction`, exact contract, function, zero value), expiry, policy name over 49 characters, key quorum mismatch (`PRIVY_KEY_QUORUM_MISMATCH`, `401 No valid authorization keys...`). Server-side `eth_sendTransaction` on 97741 is rejected by Privy (`PRIVY_CHAIN_REJECTED_97741`): the SDK routes sign and broadcast instead.
- **Kernel mode** (`pepu-sponsored-session`): `SESSION_APPROVAL_MISMATCH` (browser and server scope differ), `SESSION_EXPIRED`, `SESSION_NONE`, `429` while another action runs, caps below the gas reservation (about 20.5 PEPU first operation, 6.9 later).

### Family: login and wallet

`CONFIG_ORIGIN_MISMATCH` (origin with port not in Allowed origins), `CONFIG_PRIVY_DASHBOARD`, `CONFIG_PRIVY_CREATE_ON_LOGIN`, `WALLET_NOT_PROVISIONED`, `WALLET_INJECTED_ACTIVE` (an extension is the active wagmi account), `WALLET_COINBASE_UNSUPPORTED_CHAIN`, `AUTH_INVALID_TOKEN`. See `pepu-onboarding-privy`.

### Family: plain EVM

- **Common real causes before suspecting a contract bug:** a non-zero `value` to a nonpayable function, insufficient value to a payable one, a stale nonce or a gap (`eth_getTransactionCount` for the sender, `TX_NONCE_RACE`), the wrong Multicall3.
- **Multicall3 trap (`MULTICALL3_CANONICAL_ADDRESS`).** If a batched read fails with "contract not deployed" or an empty result and the target is `0xcA11bde05977b3631167028862bE2a173976CA11`: that address has no code on PEPU and never will. Use `pepuMulticall(client, calls)` or a chain object that carries PEPU's `contracts.multicall3` (`pepu-chain-setup`).
- **Gas surprises.** The price looks huge in gwei: normal, do not hardcode a lower one or the transaction sticks. An "out of gas" on large calldata means a stale estimate that ignored Nitro's L1 data component: re-run `estimateTransactionCost(client, request)` (or `pepu_estimate_gas_cost`) with the real `to`, `data`, `value`.
- **`debug_traceCall`** for deep reverts needs a Conduit key (the public endpoint returns `-32401`):

  ```bash
  curl -s -X POST "https://<rpc-with-key>" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"debug_traceCall","params":[{"to":"<address>","data":"<calldata>","from":"<sender>"},"latest",{"tracer":"callTracer"}]}'
  ```

  `eth_simulateV1` works on the authenticated endpoint for multi-call sequences. Keep the key in a server-side env var; never commit it or ship it to a client.
- **`eth_getLogs`:** `-32602` means the range exceeds 2,000 blocks; paginate by 2,000 or less. `-32017` is rate limiting (use a key or slow down).
- **Testnet dead ends:** pepuscan indexes mainnet only; do not debug on 97740.

| Code or symptom | Meaning | Fix |
|---|---|---|
| `-32017` | public RPC rate limit | Conduit key, or slow down |
| `-32401` | `debug_*` or `trace_*` gated | Conduit key |
| `-32602` on `eth_getLogs` | range over 2,000 blocks | paginate |
| empty response from a "well-known" address | canonical Multicall3, or a pre-deployment address | `getPepuAddresses()`; canonical Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` genuinely is deployed, so empty there means wrong RPC or chain id |

## Verify

1. `explainError` or `pepu_explain_error` now returns `matched: "catalog"` for the failure, or you have the decoded revert.
2. After the fix, repeat the action and confirm with `pepu_explain_tx` (status success, the expected payer) and the pepuscan link from `explorerLinks({ tx }).tx`.
3. If the cause was configuration: `pepu_check_env`, `pepu_check_privy_config` and `pepu_sponsorship_status` are clean.

## Pitfalls

- Do not paraphrase an error before explaining it: the catalog matches on the original text.
- Do not retry a sponsored send in a loop on `PAYMASTER_DENIED`: it will keep being denied until the cause is fixed.
- Never paste a paymaster URL, authorization key or app secret into a bug report, a tool call or an answer. `redactSecrets` exists for logs.
- A failed Privy-mode session action is not proof the session is gone.

## Never hand-roll

Do not write your own revert decoder, AAxx parser, paymaster-reason mapper, nonce or gas heuristics, or "is the bundler up" probe. Use `explainError`, `describeUserOpFailure`, `mapPaymasterReason`, `estimateTransactionCost`, `checkSponsorship`
or the tools above. See [reference/rules.md](reference/rules.md).
