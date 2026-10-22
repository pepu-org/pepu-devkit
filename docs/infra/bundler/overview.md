# Bundler Overview

The PEPU bundler is an ERC-4337 bundler for Pepe Unchained V2 mainnet (chain ID `97741`), hosted by PEPU at `https://bundler.pepeunchained.com` and also runnable on your own machine. It runs Pimlico's open-source [Alto](https://github.com/pimlicolabs/alto) (`@pimlico/alto@0.0.21`) and takes UserOperations from Kernel smart accounts, wraps them into `handleOps` transactions and submits them to the chain. Read this page to know what the bundler does, which EntryPoints it supports, how it is configured and what its limits are.

The hosted bundler at `https://bundler.pepeunchained.com` is the SDK default for `PEPU_BUNDLER_URL`. You can also run your own (see [Operating the Bundler](operating.md)); point your app at `http://localhost:4337` or your own URL.

## What it does

- Accepts the ERC-4337 JSON-RPC methods an app needs: estimate gas, send, look up by hash, get the receipt. See [Bundler JSON-RPC API](api.md).
- Simulates each UserOperation against the real EntryPoint, then bundles accepted operations and submits them from one **executor** EOA.
- The executor fronts gas for the whole bundle and is reimbursed by each operation's payer out of its EntryPoint deposit: the sender's own deposit, or the [paymaster](../paymaster/overview.md)'s when the operation is sponsored.
- **It is a bundler, not gas sponsorship.** On its own it never pays gas for anyone. Sponsorship comes from the paymaster contract and its policy service.

## What it is not

- It does not gossip to a public mempool. It receives operations directly from your app or from Privy's smart-wallet client.
- It does not hold user funds. The only key it holds is the executor key, which should carry a small float (see [Operating the Bundler](operating.md)).

## EntryPoints and chain type

| Setting | Value | Why |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | The version Kernel v3.x, the PEPU paymaster and Privy's smart-wallet integration target. |
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Also served. Deployed on mainnet. |
| Chain type | `arbitrum` | PEPU is an Arbitrum Orbit (Nitro) chain. This makes Alto price UserOperations for Nitro's two-part fee: L2 execution gas plus a separate L1 data fee. Do not remove it. |
| `arbitrum-base-fee-multiplier` | `150` (a 1.5x safety margin on the L2 base fee) | Default value; tune it for your load. |
| Chain ID | `97741` (`0x17dcd`) | Mainnet only. |
| Multicall3 | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | PEPU's own deployment, used by Alto for batched reads during simulation. See [The Multicall3 Trap](../../contracts/multicall3.md). |
| CREATE2 deployer | `0x4e59b44847b379578588920ca78fbf26c0b4956c` | Alto uses it to deploy its own simulation contracts the first time it runs against a chain (`deploy-simulations-contract: true`). |

`eth_supportedEntryPoints` returns both EntryPoints and `eth_chainId` returns `0x17dcd` (full responses in [Bundler JSON-RPC API](api.md)).

## Safe mode is off (known Alto 0.0.21 bug)

`safe-mode` is `false` in the committed configuration. With it on, `eth_sendUserOperation` fails for every operation, valid or not, with an HTTP 500 and the error `Encoded error signature "0x99410554" not found on ABI`. The selector is EntryPoint v0.7's own `DelegateAndRevert(bool,bytes)` error. Alto's Node-side decoder for its simulation contract has no error definitions in its ABI, so it throws on the wrapper that every simulation returns. The behavior is present in Alto `0.0.21`, the latest npm release.

What safe mode off means:

- Alto still validates signature, nonce, prefund and gas. What is skipped is the ERC-7562 storage-access and opcode tracer, which protects a **shared public mempool** from operations crafted to behave differently at inclusion time.
- That is acceptable only with the controls around it. This matters because the RPC is public, which is why the hosted deployment sits behind a reverse proxy (see below and [Operating the Bundler](operating.md)).
- The v2 paymaster contract depends on this setting: it gates payment on `tx.origin` being an allowlisted bundler, and `ORIGIN` is banned under ERC-7562, so a conformant public-mempool bundler would reject its operations. See [Paymaster v2 Spec Summary](../../contracts/paymaster-v2-spec.md).
- Re-test and re-enable safe mode when Alto publishes a release past `0.0.21`.

## The paymaster bundler allowlist

The v2 paymaster only pays out to allowlisted bundler executor addresses. A third-party bundler would see operations that pass simulation but fail at inclusion. In practice: sponsored operations must go through the PEPU bundler (or one whose executor has been added to the paymaster's allowlist). v1 does not have this restriction. See [PepuSponsoredPaymasterV7 Contract](../paymaster/contracts.md).

## CORS and the proxy policy

Browsers call the bundler directly (Privy's smart-wallet client sends `eth_estimateUserOperationGas` from the user's browser), so CORS has to work.

- `enable-cors` is `true`. In Alto 0.0.21 that is a boolean that **reflects any `Origin`** and answers `OPTIONS` preflights; it cannot be turned into an allowlist.
- CORS is not an access boundary. A script or `curl` can call the endpoint regardless. What actually gates cost is EntryPoint validation (signature, nonce, prefund) and, for sponsored operations, the paymaster's policy.
- For a hosted deployment, put a reverse proxy in front that terminates TLS and rate-limits; the PEPU-hosted endpoint is served through one. Plan for the endpoint URL to be treated as semi-public.

## Rate limits

Alto has no built-in per-client limits. Any limits on the hosted endpoint are applied at the proxy and are not a contract; do not hammer the endpoint.

## Health probe

Use the SDK probe or the MCP tool rather than hand-rolled calls:

```ts
import { probeBundler } from "@pepu-chain/sdk/aa";

const result = await probeBundler(process.env.PEPU_BUNDLER_URL ?? "http://localhost:4337");
console.log(result.ok, result.chainId, result.entryPoints, result.supportedMethods);
```

`probeBundler` calls `eth_chainId`, `eth_supportedEntryPoints` and a capability check for `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `pimlico_getUserOperationGasPrice` and `zd_getUserOperationGasPrice`. A method counts as supported if it answers with anything other than "method not found". Nothing is sent on chain. `ok` is true only when the chain ID is `97741` and EntryPoint v0.7 is listed. It never throws for network trouble; it returns `ok: false` with a `BUNDLER_UNREACHABLE` error. The MCP equivalent is the `pepu_bundler_health` tool, and `pepu_sponsorship_status` checks bundler and paymaster together.

## Configuration summary

The committed file is `services/bundler/alto.config.json`; secrets live only in `.env`.

| Key | Value |
|---|---|
| `entrypoints` | v0.7 and v0.6 |
| `chain-type` | `arbitrum` |
| `safe-mode` | `false` (see above) |
| `enable-cors` | `true` (reflect any origin) |
| `enable-debug-endpoints` | `false` (the `debug_bundler_*` methods are not served) |
| `dangerous-skip-user-operation-validation` | `false` |
| `legacy-transactions` | `false` (EIP-1559) |
| `is-gas-free-chain` | `false` |
| `eip-7702-support` | `true` |
| `refilling-wallets` | `false` (no utility wallet) |
| `port` | `4337` |
| `block-time` | `5000` ms |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `eth_sendUserOperation` returns HTTP 500 mentioning `0x99410554` | `safe-mode` is on | Set `safe-mode` to `false` and restart. Alto reads its config once at startup. |
| Browser shows `Failed to fetch` on the first call, `curl` works | CORS disabled, so the `OPTIONS` preflight got a 404 | Set `enable-cors` to `true` and restart. |
| Estimation works, sending never lands | The executor EOA has no PEPU. Estimation does not need funds, sending does | Top up the executor. See [Operating the Bundler](operating.md). |
| `probeBundler` returns `ok: false` with the wrong chain | The URL points at a different network | Use a mainnet (`97741`) bundler. |
| Config change has no effect | Alto does not hot reload | Restart the process. |

## Related

- [Bundler JSON-RPC API](api.md)
- [Operating the Bundler](operating.md)
- [Paymaster Overview](../paymaster/overview.md)
- [Infrastructure Map](../overview.md)
- [Smart Accounts](../../onboarding/smart-accounts.md)
