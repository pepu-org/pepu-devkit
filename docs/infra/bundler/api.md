# Bundler JSON-RPC API

Method-by-method reference for the PEPU bundler (Alto, ERC-4337 EntryPoint v0.7, chain `97741`). Read this when you are calling the bundler without the SDK, debugging a failing UserOperation or writing your own client. Most apps do not call these methods by hand: viem's bundler client, Privy's smart-wallet client and the SDK (`@pepu-chain/sdk/aa`) do it for you.

> Status: **proven** on mainnet for estimate, send, get-by-hash and get-receipt, including through the hosted endpoint `https://bundler.pepeunchained.com`. `eth_supportedEntryPoints` and `eth_chainId` responses below were captured read-only from a local bundler on 2026-10-03. The other examples show the response shape and use values from the 2026-09-24 proof-of-life run; they are abridged. Write `PEPU_BUNDLER_URL` in your config, or rely on the SDK default (the hosted URL). The local development default is `http://localhost:4337`.

## Endpoint and transport

| | |
|---|---|
| URL | `PEPU_BUNDLER_URL` (browser-exposed variant `NEXT_PUBLIC_PEPU_BUNDLER_URL`). Hosted default `https://bundler.pepeunchained.com`. Local default `http://localhost:4337`. |
| Method | `POST`, `Content-Type: application/json`, JSON-RPC 2.0 body |
| Auth | None at the Alto layer. The hosted deployment sits behind a proxy that may add its own |
| CORS | Enabled; any `Origin` is reflected, `OPTIONS` preflights return 204. See [Bundler Overview](overview.md#cors-and-the-proxy-policy) |
| Batching | Not covered by this page; send one request per call |
| Rate limits | Applied at the proxy if at all; Alto itself has none. Do not rely on them |

The SDK resolves the URL for you (explicit option, then the env variables, then the hosted default, `https://bundler.pepeunchained.com`). Never hard-code a tunnel URL.

Quantities are `0x`-prefixed hex strings, as in all Ethereum JSON-RPC. A v0.7 UserOperation is sent in its **unpacked** form:

| Field | Type | Notes |
|---|---|---|
| `sender` | address | The Kernel smart account |
| `nonce` | hex quantity | EntryPoint nonce (key and sequence packed) |
| `factory`, `factoryData` | address, hex | Only when the account is not yet deployed |
| `callData` | hex | A Kernel `execute(bytes32,bytes)` call |
| `callGasLimit`, `verificationGasLimit`, `preVerificationGas` | hex quantity | |
| `maxFeePerGas`, `maxPriorityFeePerGas` | hex quantity | PEPU's base fee is about 12,500 gwei; this is normal |
| `paymaster`, `paymasterVerificationGasLimit`, `paymasterPostOpGasLimit`, `paymasterData` | | Only for sponsored operations; from the [paymaster](../paymaster/erc7677.md) |
| `signature` | hex | The account's signature (or a dummy of the right length when estimating) |

## Supported methods

| Method | Supported | Notes |
|---|---|---|
| `eth_chainId` | Yes | Returns `0x17dcd` (97741) |
| `eth_supportedEntryPoints` | Yes | v0.7 first, then v0.6 |
| `eth_estimateUserOperationGas` | Yes | Proven on mainnet |
| `eth_sendUserOperation` | Yes | Proven on mainnet; needs `safe-mode: false` (known Alto 0.0.21 bug) |
| `eth_getUserOperationByHash` | Yes | `null` if unknown |
| `eth_getUserOperationReceipt` | Yes | `null` until included |
| `pimlico_getUserOperationGasPrice` | Implemented in Alto 0.0.21 | Not exercised against the PEPU bundler during this documentation pass. `probeBundler` reports whether a given deployment answers it |
| `pimlico_getUserOperationStatus` | Implemented in Alto 0.0.21 | Same caveat |
| `zd_getUserOperationGasPrice` | Not an Alto method | `probeBundler` checks for it because ZeroDev's client prefers it; expect "method not found" |
| `debug_bundler_*` | Disabled | `enable-debug-endpoints` is `false` |

## eth_chainId

Request:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": [] }
```

Response (captured 2026-10-03):

```json
{ "jsonrpc": "2.0", "id": 1, "result": "0x17dcd" }
```

`0x17dcd` is 97741. Any other value means you are pointed at the wrong network.

## eth_supportedEntryPoints

Request:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_supportedEntryPoints", "params": [] }
```

Response (captured 2026-10-03):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
  ]
}
```

Use the first entry (EntryPoint v0.7) for Kernel v3.x. The addresses are documented in [EntryPoints and Kernel](../../contracts/entrypoints-and-kernel.md).

## eth_estimateUserOperationGas

Params: `[userOperation, entryPoint]`, optionally a third argument of state overrides. Pass a dummy-but-well-formed `signature` (the right length for your account) so signature validation does not fail the simulation. For a **sponsored** operation, attach the paymaster fields from `pm_getPaymasterStubData` first. Estimating without them makes EntryPoint demand the sender's own prefund and fail with `AA21 didn't pay prefund` for a zero-balance account.

Request (abridged):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_estimateUserOperationGas",
  "params": [
    {
      "sender": "0xA43CDA364c524551640206A5A22906dBD989F373",
      "nonce": "0x0",
      "factory": "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
      "factoryData": "0x…",
      "callData": "0x…",
      "callGasLimit": "0x0",
      "verificationGasLimit": "0x0",
      "preVerificationGas": "0x0",
      "maxFeePerGas": "0x…",
      "maxPriorityFeePerGas": "0x…",
      "signature": "0x…"
    },
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
  ]
}
```

Response (values from the 2026-09-24 run: an account-deploying operation):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "preVerificationGas": "0xc769",
    "verificationGasLimit": "0x51e44",
    "callGasLimit": "0x3fc3"
  }
}
```

When the request carried paymaster fields, the result also includes `paymasterVerificationGasLimit` and `paymasterPostOpGasLimit`. The deployed Kernel follow-up operation estimated `preVerificationGas` `0xbbd8` and `verificationGasLimit` `0x1573d`.

`preVerificationGas` is large because PEPU is a Nitro chain: it includes the L1 data fee component (`chain-type: arbitrum`).

## eth_sendUserOperation

Params: `[userOperation, entryPoint]`, with real gas limits and a real signature (and paymaster fields for a sponsored operation). Returns the **userOpHash** (not a transaction hash).

Request: same shape as above, with the estimated gas limits filled in.

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0xc20a1c642b0b61d4c545de2ec5d333b37440ff8a0b0ec9307b8e64cfe3c6e0f8"
}
```

(That hash is the first operation of the 2026-09-24 proof of life.) The operation is queued, bundled on the next bundling pass (about `block-time`, 5 seconds) and submitted by the executor. Poll for the receipt.

If the call fails with HTTP 500 and `Encoded error signature "0x99410554" not found on ABI`, `safe-mode` is on. See [Bundler Overview](overview.md#safe-mode-is-off-known-alto-0021-bug).

## eth_getUserOperationByHash

Params: `[userOpHash]`.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_getUserOperationByHash", "params": ["0xc20a1c642b0b61d4c545de2ec5d333b37440ff8a0b0ec9307b8e64cfe3c6e0f8"] }
```

Response when the operation is included:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "userOperation": { "sender": "0xA43CDA364c524551640206A5A22906dBD989F373", "…": "…" },
    "entryPoint": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    "blockNumber": "0xa08cc7",
    "blockHash": "0x…",
    "transactionHash": "0x8232872612eb500033faf8ef605f7c14f4fef556defdbb4d7c67c1731d0b00d3"
  }
}
```

`result` is `null` when the operation is unknown or not yet mined.

## eth_getUserOperationReceipt

Params: `[userOpHash]`. Returns `null` until the operation is included, so poll (every 2 to 5 seconds, with a timeout).

Response (abridged, same operation; `actualGasCost` is 7.725575 PEPU, `actualGasUsed` is 309,023):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "userOpHash": "0xc20a1c642b0b61d4c545de2ec5d333b37440ff8a0b0ec9307b8e64cfe3c6e0f8",
    "entryPoint": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    "sender": "0xA43CDA364c524551640206A5A22906dBD989F373",
    "nonce": "0x0",
    "actualGasCost": "0x6b36c187d8a37000",
    "actualGasUsed": "0x4b71f",
    "success": true,
    "logs": [],
    "receipt": { "transactionHash": "0x8232872612eb500033faf8ef605f7c14f4fef556defdbb4d7c67c1731d0b00d3", "blockNumber": "0xa08cc7", "status": "0x1" }
  }
}
```

`success: false` means the call inside the operation reverted (see `reason`) even though the transaction itself succeeded. For a sponsored operation the response includes `paymaster`. The SDK helpers `userOpEventFromReceipt` and `userOpEventsFromReceipt` (from `@pepu-chain/sdk/aa`) decode the `UserOperationEvent` from the transaction receipt.

## pimlico_getUserOperationGasPrice

Alto implements this method; it returns three tiers of fee suggestion. The SDK probe checks for it. Treat it as optional: if a deployment does not answer, read `eth_gasPrice`/fee history from the chain RPC instead.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "pimlico_getUserOperationGasPrice", "params": [] }
```

Response shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "slow":     { "maxFeePerGas": "0x…", "maxPriorityFeePerGas": "0x…" },
    "standard": { "maxFeePerGas": "0x…", "maxPriorityFeePerGas": "0x…" },
    "fast":     { "maxFeePerGas": "0x…", "maxPriorityFeePerGas": "0x…" }
  }
}
```

Not verified against the PEPU bundler: this shape comes from Alto 0.0.21's source, not a live call.

## Error codes

Errors follow ERC-7769 and use the standard JSON-RPC envelope `{ "error": { "code", "message", "data" } }`. Alto 0.0.21 defines:

| Code | Meaning | What to do |
|---|---|---|
| `-32601` | Method not found | You called a method this deployment does not serve (for example a `debug_` method) |
| `-32602` | Invalid fields | A field is missing, mistyped or the wrong width. Check the unpacked v0.7 shape above |
| `-32500` | Rejected in account validation (`validateUserOp`) | The sender or its validator rejected the operation. An `AAxx` code is in the message: `AA21` prefund not paid, `AA23` reverted, `AA25` invalid nonce, `AA33` paymaster reverted |
| `-32501` | Rejected by the paymaster | Sponsorship was refused or the paymaster data is invalid. `AA33`, `AA34` (bad signature) and `AA31` (paymaster deposit too low) all surface here or as `-32508` |
| `-32502` | Opcode validation | Banned opcode or storage access. Only raised with `safe-mode: true` |
| `-32503` | Expires shortly | The paymaster approval (`validUntil`) is about to lapse. Request fresh paymaster data and retry |
| `-32504` | Reputation | A throttled or banned entity |
| `-32505` | Insufficient stake | A staked entity is required |
| `-32506`, `-32507` | Unsupported aggregator, invalid signature | |
| `-32508` | Paymaster deposit too low | Fund the paymaster's EntryPoint deposit |
| `-32521` | Execution reverted | The operation's call failed in simulation |

Failures that are not JSON-RPC errors: an HTTP 500 with a raw message (the safe-mode bug above) and a browser `Failed to fetch` (CORS off, or the endpoint is down). The Privy-side symptom of a bundler error is usually opaque; call the bundler directly with `curl` to see the real message.

## Using the SDK instead

```ts
import { probeBundler } from "@pepu-chain/sdk/aa";
import { createPepuSponsoredClient, sendSponsored } from "@pepu-chain/sdk/aa/kernel";
```

`createPepuSponsoredClient` and `sendSponsored` build the Kernel account, estimate, request paymaster data and send, so you only deal with raw JSON-RPC when debugging. See [/aa](../../sdk/aa.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `AA21 didn't pay prefund` on estimate | Estimated without paymaster fields on a zero-balance sender | Attach stub paymaster fields first, or fund the sender |
| `AA33 reverted` on send | The paymaster rejected the operation: expired `validUntil`, or the bundler executor is not allowlisted (v2) | Re-request paymaster data; for v2 use the PEPU bundler |
| `AA25 invalid account nonce` | A pending operation from the same sender holds the nonce | Wait for the receipt, or use the next nonce |
| `null` receipt forever | The executor is out of PEPU, or the operation was dropped | Check executor balance and the bundler log. See [Operating the Bundler](operating.md) |
| 500 with `0x99410554` | `safe-mode` is on | Turn it off and restart |

## Related

- [Bundler Overview](overview.md)
- [Operating the Bundler](operating.md)
- [ERC-7677 Methods](../paymaster/erc7677.md)
- [Endpoints reference](../../reference/endpoints.md)
