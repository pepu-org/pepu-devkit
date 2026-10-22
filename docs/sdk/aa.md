# /aa

`@pepu-chain/sdk/aa` is the sponsored-transactions layer: ERC-4337 bundler and ERC-7677 paymaster clients for PEPU, endpoint probes, UserOperation failure mapping, and receipt decoding. This page covers four entries that belong together: `/aa` (viem account abstraction only), `/aa/kernel` (ZeroDev Kernel account and sponsored client), `/aa/react` (hooks for Privy Smart Wallets) and `/aa/react-direct` (hooks for your own bundler and paymaster).

A zero-balance Kernel smart account can transact with gas paid by a paymaster. The hosted bundler is the SDK default for `PEPU_BUNDLER_URL`. The ERC-7677 paymaster URL always embeds a project token, so there is no tokenless default: set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>` or pass `paymasterToken`. Local development defaults (`http://localhost:4337`, `http://localhost:8788`) are for people running their own services. The v1 paymaster is retired (see [Address Map](../contracts/address-map.md)).

Which entry to use depends on who builds the Kernel account: `/aa/react` is Path 2 (Privy Smart Wallets), `/aa/kernel` and `/aa/react-direct` are Path 1 (ZeroDev-native). See [Smart Account Paths](../concepts/smart-account-paths.md).

## Import, peers and boundary

| Entry | Server or client | Peer dependencies |
|---|---|---|
| `@pepu-chain/sdk/aa` | Client-safe, isomorphic | `viem` |
| `@pepu-chain/sdk/aa/kernel` | Client-safe, but the owner key must stay where the owner is | `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator`, `viem` |
| `@pepu-chain/sdk/aa/react` | Client only | `react`, `@privy-io/react-auth`, `permissionless` (required by Privy's smart-wallets module). Never needs `@zerodev/*` |
| `@pepu-chain/sdk/aa/react-direct` | Client only | `react`, `@privy-io/react-auth`, `@zerodev/sdk`, `@zerodev/ecdsa-validator`, `viem` |

EntryPoint v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`, `ENTRY_POINT_V07`) is the only version PEPU's bundler and paymaster speak. A bundler URL embeds nothing secret; a paymaster URL can embed a credential, so keep it server-side unless it holds a publishable client token.

## Exports: `/aa`

| Export | Signature | What it abstracts |
|---|---|---|
| `ENTRY_POINT_V07` | `{ address, version: "0.7" }` | |
| `createPepuBundlerClient` | `(o: { bundlerUrl?; account: SmartAccount; paymaster?; paymasterContext?; publicClient? }) => BundlerClient` | A viem bundler client with the Alto-compatible fee estimator pre-wired |
| `createPepuPaymasterClient` | `(o?: { paymasterUrl?; paymasterToken?; context?: PaymasterContext }) => PaymasterClient` | A viem ERC-7677 paymaster client. With `paymasterToken` (a project token) the URL is built against the paymaster base (the hosted service by default); an explicit `paymasterUrl` or `PEPU_PAYMASTER_URL` wins. The context (for example the user's Privy access token) goes into every `pm_getPaymasterStubData` and `pm_getPaymasterData` call |
| `estimatePepuUserOpFees` | `(publicClient) => Promise<{ maxFeePerGas; maxPriorityFeePerGas }>` | The chain's `estimateFeesPerGas` with `maxFeePerGas` times 1.2. Alto does not implement ZeroDev's `zd_getUserOperationGasPrice`, so ZeroDev's default estimator fails |
| `probeBundler` | `(url?: string | null, o?: { fetch?; timeoutMs? }) => Promise<BundlerProbeResult>` | Defaults to the hosted bundler. Chain ID, supported entry points, which JSON-RPC methods exist, latency |
| `probePaymaster` | `(url?: string | null, o?) => Promise<PaymasterProbeResult>` | Defaults to the hosted service base. Checks `/health`, `/v2/free-tier` and the v2 ERC-7677 route `/v2/paymaster/<token>` (a placeholder token when you pass only the base). A structured JSON-RPC error such as invalid params or an unknown credential counts as responding (`erc7677: "needs-credential"`); only network errors, non-JSON answers and 5xx are `"not-responding"`. Read-only |
| `getPaymasterDeposit` | `(client, paymasterAddress?) => Promise<bigint>` | The paymaster's EntryPoint deposit; defaults to PEPU's deployed paymaster |
| `checkSponsorship` | `(options?) => Promise<SponsorshipReport>` | Live status: `available`, `transport` (`direct` or `none`), `reason`, `fixes`. Never throws for an unreachable service |
| `describeUserOpFailure` | `(e: unknown) => PepuBundlerError \| PepuPaymasterError` | Walks the `cause` chain, maps `AA10` to `AA9x` to a fix, maps paymaster reason codes through the catalog, redacts tokens and URL credentials |
| `redactSecrets` | `(text: string) => string` | Strips `/paymaster/<token>` paths, bearer tokens, API keys, JWTs and URL credentials |
| `encodeKernelExecute` | `(calls: readonly Call[]) => Hex` | ERC-7579 `execute` callData: single mode for one call, batch mode for several. Pure |
| `normalizeCalls` | `(calls: readonly Call[]) => EncodedCall[]` | Encodes `abi`/`functionName`/`args` into `data` |
| `userOpEventsFromReceipt`, `userOpEventFromReceipt` | `(receipt) => UserOpEvent[]`, `(receipt, sender) => {...} \| null` | Who paid and how much, from the `UserOperationEvent` in a bundle receipt |
| `getPepuKernelStack`, `getKernelAccountAddress`, `getSponsorshipStatus` | see [Core](core.md) | `getSponsorshipStatus` is deprecated |
| Types | `Call`, `SponsoredResult`, `EncodedCall`, `UserOpEvent`, `SponsorshipReport`, `CheckSponsorshipOptions`, `BundlerProbeResult`, `PaymasterProbeResult`, `ProbeOptions`, `FetchLike` | |

Probing the hosted services, with the strict-mode types: `docs/snippets/probe-health.ts`, type-checked against the SDK.

`Call` is `{ to; value?; data?; abi?; functionName?; args? }`: give raw `data`, or `abi` plus `functionName`. `SponsoredResult` is `{ userOpHash: Hex | null; transactionHash; success; paymaster: Address | null; actualGasCostWei; explorerUrl }`. `userOpHash` is `null` through Privy Smart Wallets, which expose only the bundle transaction.

## Exports: `/aa/kernel`

| Export | Signature | What it abstracts |
|---|---|---|
| `toPepuKernelAccount` | `(p: { publicClient; owner: KernelOwner; index?: bigint; plugins?: { regular?: object } }) => Promise<KernelSmartAccount>` | A Kernel v3.1 account owned by `owner` (ECDSA root validator). The address depends only on owner and `index`. `plugins.regular` adds a permission validator, which is how [/session/kernel](session-kernel.md) builds on it |
| `getKernelAddress` | `(publicClient, owner: Address) => Promise<Address>` | The counterfactual address with no signature |
| `createPepuSponsoredClient` | `(p: { account; bundlerUrl?; paymasterUrl?; paymasterToken?; paymasterContext?; publicClient? }) => KernelAccountClient` | A Kernel client that sends through the bundler (hosted by default) with gas paid by your paymaster. `paymasterToken` builds the hosted ERC-7677 URL for a project token |
| `sendSponsored` | `(p: { client; calls: Call[]; timeoutMs? }) => Promise<SendSponsoredResult>` | Encode, send one UserOperation, wait for the receipt, report who paid. Failures go through `describeUserOpFailure`. Result: `userOpHash`, `transactionHash`, `success`, `paymaster`, `actualGasCostWei`, `explorerUrl` |
| `KERNEL_VERSION`, `encodeKernelExecute`, `KernelOwner`, `KernelSmartAccount`, `KernelAccountClient`, `Call` | | `KernelOwner` is a viem local account, a Privy signer or a wallet client |

```ts
// Pillar 3: a sponsored transaction from a script (direct transport).
// Needs a bundler and a paymaster: set PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL
// (the bundler defaults to https://bundler.pepeunchained.com; the ERC-7677 URL is https://paymaster.pepeunchained.com/v2/paymaster/<token>).
// Local dev defaults are http://localhost:4337 and http://localhost:8788 for your own services.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { buildPaymasterContext, checkSponsorship, explorerLinks, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "@pepu-chain/sdk/aa/kernel";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);

// SCRIPT ONLY: the owner key stays in your environment.
const owner = privateKeyToAccount(process.env["OWNER_PRIVATE_KEY"] as Hex);

export async function sponsoredTap(privyAccessToken?: string) {
  // 1. Is sponsorship reachable? Never throws for an unreachable service.
  const status = await checkSponsorship({ publicClient });
  if (!status.available) throw new Error(`${status.reason} ${status.fixes.join(" ")}`);

  // 2. The Kernel smart account that sends and holds assets. The owner EOA only signs.
  const account = await toPepuKernelAccount({ publicClient, owner });

  // 3. A client that sends through your bundler and has gas paid by your paymaster.
  const client = createPepuSponsoredClient({
    account,
    // The v2 free tier wants the user's Privy access token (from PEPU's own Privy app).
    ...(privyAccessToken ? { paymasterContext: buildPaymasterContext({ privyAccessToken }) } : {}),
  });

  // 4. One UserOperation: encode, send, wait for the receipt, report who paid.
  const result = await sendSponsored({
    client,
    calls: [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  });

  return { ...result, links: explorerLinks({ tx: result.transactionHash, sender: account.address }) };
}
```

Source: `docs/snippets/sponsored-send.ts`, type-checked against the SDK.

## Exports: `/aa/react`

| Export | Signature | What it abstracts |
|---|---|---|
| `usePepuSmartAccount` | `() => { owner?: Address; smartAccount?: Address; ready: boolean }` | The two-address model made explicit: `owner` is the embedded wallet that signs, `smartAccount` is the Kernel account that sends and holds assets |
| `useSponsoredSend` | `(o?: { transport?: "privy-smart-wallets" }) => { send(calls: Call[]): Promise<SponsoredResult>; status; result?; error?: PepuError }` | Send with sponsored gas through Privy's smart-wallet client, using the bundler and paymaster URLs from the Privy dashboard. One send at a time. `status`: `idle`, `signing`, `submitting`, `confirmed`, `error`. For your own bundler and paymaster, use `useDirectSponsoredSend` from `/aa/react-direct` |
| `usePepuSponsorship` | `(o?: { pollMs?; bundlerUrl?; paymasterUrl? }) => SponsorshipReport & { loading: boolean }` | Polled `checkSponsorship`. The live replacement for `useSponsorshipStatus` |

```tsx
// Pillar 3, client: send with gas sponsored from a component.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { usePepuSmartAccount, usePepuSponsorship, useSponsoredSend } from "@pepu-chain/sdk/aa/react";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export function SponsoredTap() {
  const { smartAccount } = usePepuSmartAccount();
  // "privy-smart-wallets" uses the bundler and paymaster URLs from the Privy dashboard.
  // For your own bundler and paymaster, use useDirectSponsoredSend from "@pepu-chain/sdk/aa/react-direct".
  const { send, status, result, error } = useSponsoredSend({ transport: "privy-smart-wallets" });
  const sponsorship = usePepuSponsorship({ pollMs: 0 });

  return (
    <div>
      <p>Smart account: {smartAccount}</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }])}
      >
        Tap, no gas
      </button>
      {status === "confirmed" && result ? <a href={result.explorerUrl}>Paid by {result.paymaster}</a> : null}
      {error ? (
        <p>
          {error.code}: {error.hint}
        </p>
      ) : null}
      {!sponsorship.loading && !sponsorship.available ? <p>{sponsorship.reason}</p> : null}
    </div>
  );
}
```

Source: `docs/snippets/sponsored-send-react.tsx`, type-checked against the SDK.

## Errors

| Code | Where |
|---|---|
| `CONFIG_MISSING_ENV` | No bundler or paymaster URL is configured (`createPepuBundlerClient`, `createPepuPaymasterClient`, probes). The message names the variable |
| `CONFIG_BAD_URL` | A configured URL is not `http(s)` |
| `BUNDLER_UNREACHABLE` | The bundler probe or send could not reach the bundler |
| `PAYMASTER_UNREACHABLE` | The paymaster probe or API call could not reach the paymaster service (network error, DNS, timeout) |
| `PAYMASTER_API_ERROR` | The paymaster host answered but its `/v2/paymaster/<token>` route did not speak ERC-7677 JSON-RPC (probe), or a REST route failed |
| `BUNDLER_AA_FAILED` | An `AAxx` failure from the EntryPoint, mapped by `describeUserOpFailure` |
| `PAYMASTER_DENIED`, `PAYMASTER_NO_BALANCE`, `PAYMASTER_CAP`, and the other `PAYMASTER_*` codes | The paymaster refused. See [SDK Error Catalog](errors.md) |
| `POLICY_UNSCOPED` | `normalizeCalls` or `encodeKernelExecute` got an empty list or an ambiguous call |
| `WALLET_NOT_PROVISIONED` | `useSponsoredSend` ran before the embedded wallet existed |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `checkSponsorship` says no URL is configured | The paymaster has no tokenless URL, or an env var was cleared | Set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>` (or pass `paymasterToken`); the bundler defaults to the hosted one |
| `zd_getUserOperationGasPrice` not found | ZeroDev's default fee estimator against Alto | Use `createPepuSponsoredClient` or `estimatePepuUserOpFees` |
| `PAYMASTER_NO_BALANCE` | The paymaster's EntryPoint deposit is empty | Deposit PEPU to it; `checkSponsorship({ publicClient })` reports `depositWei` |
| Smart account address differs from the wallet address | They are two addresses by design | See [The Two-Address Model](../onboarding/two-address-model.md) |

## Related

- [Smart Account Paths: which one to use](../concepts/smart-account-paths.md)
- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [Send a Sponsored Transaction](../recipes/sponsored-send.md)
- [/paymaster](paymaster.md), [/combo](combo.md)
- [Smart Accounts](../onboarding/smart-accounts.md)
