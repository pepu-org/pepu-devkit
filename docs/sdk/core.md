# Core: @pepu-chain/sdk

The core entry of `@pepu-chain/sdk`: chain definitions, the contract and DEX registries, ABIs, gas helpers, explorer links, Multicall3 and Permit2 helpers, the error model, endpoint resolution, ERC-7677 request builders and the live sponsorship check. It extends viem and never wraps it. Read this page first, then the subpath page for the pillar you are building.

> Status: proven. Every registry address is checked on mainnet (`eth_getCode`) and the entry is covered by the SDK test suite. The sponsorship pieces (`checkSponsorship`, the ERC-7677 builders) are proven live on mainnet through the hosted bundler (`https://bundler.pepeunchained.com`) and the hosted paymaster service (`https://paymaster.pepeunchained.com`). The v2 paymaster is Proven on mainnet as a canary (deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches).

## Install and peer dependencies

```sh
npm install @pepu-chain/sdk viem
```

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk` |
| Runs in | Browser, Node, edge. No `react`, no Privy, no ZeroDev |
| Peer dependencies | `viem` `^2.0.0` only |
| Server or client | Client-safe |
| Chain | PEPU mainnet, chain ID `97741`. `pepuTestnet` (`97740`) exists as a definition only and is out of scope |

## Chains and clients

| Export | Signature | What it abstracts |
|---|---|---|
| `pepuMainnet` | viem `Chain` | Chain `97741`, RPC, PepuScan explorer, and `contracts.multicall3` set to PEPU's own address, so viem and wagmi batch correctly |
| `pepuTestnet`, `pepuChains` | viem `Chain`, array | Testnet definition, no explorer, no deployed contracts |
| `isPepuChain` | `(chainId: number) => chainId is 97741 \| 97740` | Narrowing guard |
| `PepuChain`, `PepuChainId` | types | Chain object and ID union |
| `getPublicClient` | `(chain: PepuChain, options?: { transport?: Transport }) => PublicClient<Transport, PepuChain>` | `createPublicClient` with the chain's own RPC |
| `toAddEthereumChainParameter` | `(chain: PepuChain) => AddEthereumChainParameter` | The `wallet_addEthereumChain` payload with correct hex chain ID |
| `switchOrAddPepuChain` | `(provider: EIP1193Provider, chain: PepuChain) => Promise<void>` | Switch, then add on error `4902` (viem's `switchChain` does not add) |

## Contract and DEX registries

| Export | Signature | Notes |
|---|---|---|
| `pepuContracts` | registry keyed by chain ID | Names: `create2Factory`, `multicall3`, `permit2`, `entryPoint06`, `entryPoint07`, `kernelFactory`, `kernelMetaFactory`, `ecdsaValidator`, `paymaster`, `kernelImplementation`, `kernelEcdsaSignerModule`, `kernelCallPolicyV004`, `kernelTimestampPolicy`, `tapScore`, `paymasterV1`, `paymasterV2` |
| `getContract` | `(chainId: number, name: PepuContractName) => ContractEntry \| undefined` | Pending entries have no `address` field |
| `listContracts` | `(chainId: number) => readonly ContractEntry[]` | Registry order |
| `isDeployed` | `(entry: ContractEntry \| undefined) => entry is DeployedContract` | Narrow before reading `.address` |
| `getPepuAddresses` | `(chainId?: number) => readonly PepuAddressRow[]` | Flat table for docs and UIs. Returns an **array of rows** (each has a `key`), not an object: use `.find((r) => r.key === "paymaster")`, or `getPepuAddressMap()` |
| `getPepuAddressMap` | `(chainId?: number) => Partial<Record<PepuContractName, PepuAddressRow>>` | The same rows keyed by contract name |
| `pepuSwapContracts`, `getPepuSwapContract`, `listPepuSwapContracts` | PepuSwap registry | `multicallNonCanonical` and `permit2NonCanonical` are PepuSwap's own deployments, not the chain's |
| `pepuTokenList` | Uniswap token-list schema | Four verified tokens: WPEPU (18 decimals), USDT (6), USDC (6) and WETH (18) |
| `createPepuscanClient` | `(chain) => PepuscanClient` | `getVerifiedAbi(address)` and `getTokenMetadata(address)`, both `null` when unknown |

`paymasterV2` and its alias `paymaster` are the v2 paymaster `PepuSponsoredPaymasterV7` at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`, deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. Keep deposits small. `paymasterV1` (`0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0`) is retired: its EntryPoint deposit was withdrawn (it was funded earlier), it cannot sponsor anything, and its registry entry carries `retired: true` (so do `getPepuAddresses()` rows). Never deposit to it. A `deployed` registry entry answers "does this contract exist", never "can my app get sponsored gas". Use `checkSponsorship` for that.

Full addresses are in [Address Map](../contracts/address-map.md).

## ABIs

Hand-verified subsets, only functions confirmed live: `wpepuAbi`, `pepuSwapV3FactoryAbi`, `pepuSwapV3PoolAbi`, `pepuSwapRouterAbi`, `pepuSwapQuoterAbi`, `pepuSwapPositionManagerAbi`, `pepuSwapTickLensAbi`, `pepuSwapUniversalRouterAbi`, `pepuSwapPermit2Abi`, `pepuSwapMulticallAbi`, `multicall3Abi`, `permit2Abi`, `arbGasInfoAbi` (with `ARB_GAS_INFO_ADDRESS`), `entryPointV07Abi`, `kernelFactoryAbi` (with `KERNEL_V3_1_IMPLEMENTATION_ADDRESS`), `kernelEcdsaValidatorAbi` (with `ERC7579_MODULE_TYPE`), and viem's `erc20Abi` and `erc721Abi` re-exported so apps import every ABI from one place.

## Gas and fees

PEPU is an Arbitrum Nitro chain. The L2 base fee is about 12,500 gwei and PEPU is a low-value token, so Ethereum-style formatting misleads in both directions.

| Export | Signature |
|---|---|
| `getNitroFeeBreakdown` | `(client) => Promise<NitroFeeBreakdown>` live from the `ArbGasInfo` precompile |
| `explainDualFeeModel` | `() => DualFeeModelExplanation` |
| `estimateTransactionCost` | `(client, request) => Promise<TransactionCostEstimate>` with `gas`, `gasPriceWei`, `costWei`, `costFormatted` |
| `formatPepu` | `(wei: bigint, options?: FormatPepuOptions) => string` (`0.00000001 PEPU`, never `0 PEPU`) |
| `formatPepuGasPrice` | `(weiPerGas: bigint) => string` |
| `formatUnitsCompact` | `(value: bigint, decimals: number, maxFractionDigits = 4) => string` for any token |
| `maxSendableAmount` | `(options: MaxSendableAmountOptions) => Promise<MaxSendableAmountResult>` discriminated on `status`: `ok`, `zero-balance`, `insufficient-for-gas` |
| `DEFAULT_MAX_SEND_MARGIN_BPS` | `2000` (20 percent) |

`maxSendableAmount` is right for a UI that submits transactions itself. Privy's own transaction modal runs a separate, over-conservative balance check and can still refuse an amount this function sized correctly.

## Explorer links

| Export | Signature |
|---|---|
| `explorerUrl` | `(chain, type: "tx" \| "address" \| "token" \| "block", value: string \| number) => string` |
| `txUrl`, `addressUrl`, `tokenUrl`, `blockUrl` | shorthands |
| `explorerLinks` | `(o: { tx?, address?, sender?, token?, block? }, chain = pepuMainnet) => { tx?, address?, sender?, token?, block? }` |

`explorerUrl` throws for a chain with no explorer (`pepuTestnet`). pepuscan has no UserOperation pages, so a sponsored operation is linked by its bundle `tx` and its `sender`. Recipe: [Explorer Links](../recipes/explorer-links.md).

## Multicall3 and Permit2

| Export | Signature | Errors |
|---|---|---|
| `getMulticall3` | `(chainId = 97741) => DeployedContract` | `MULTICALL3_CANONICAL_ADDRESS` if the registry ever held the canonical address, `UNKNOWN` if not deployed on that chain |
| `assertNotCanonicalMulticall3` | `(address) => void` | `MULTICALL3_CANONICAL_ADDRESS` |
| `pepuMulticall` | `(client, calls, { allowFailure?, blockNumber? }) => Promise<MulticallReturnType>` | as `getMulticall3` |
| `encodeAggregate3`, `decodeAggregate3Result` | encode and decode `aggregate3` | none |
| `CANONICAL_MULTICALL3_ADDRESS` | `0xcA11bde05977b3631167028862bE2a173976CA11` | It has no code on PEPU. PEPU's is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` |
| `getPermit2`, `permit2Domain` | canonical Permit2 entry and its EIP-712 domain (`name: "Permit2"`, no version) | `UNKNOWN` if not deployed |
| `buildPermitSingleTypedData`, `buildPermitTransferFromTypedData` | typed data for viem `signTypedData` | none |
| `readPermit2Allowance` | `(client, { owner, token, spender }) => Promise<{ amount, expiration, nonce }>` | none |

See [The Multicall3 Trap](../contracts/multicall3.md) and [Permit2](../contracts/permit2.md). Recipes: [Batch Reads with Multicall3](../recipes/batch-reads-with-multicall3.md), [Sign a Permit2 Permit](../recipes/permit2-permit.md).

## Error model

Everything the SDK throws is a `PepuError` with a stable `code`, a one-sentence `hint`, a `docsUrl`, a `retryable` flag and an HTTP `status` for route handlers. Messages name environment variables, never their values.

| Export | Signature |
|---|---|
| `PepuError` and subclasses `PepuConfigError`, `PepuAuthError`, `PepuPolicyError`, `PepuSessionError`, `PepuBundlerError`, `PepuPaymasterError`, `PepuChainError` | `new PepuError(code, message?, { hint?, docsUrl?, retryable?, status?, details?, cause? })` |
| `explainError` | `(e: unknown) => ErrorExplanation` pure, never throws; also decodes raw revert data (`0x...`) |
| `toPepuError` | `(e: unknown, ctx?: { op: string }) => PepuError` |
| `toErrorBody`, `toErrorResponse` | `{ error: { code, message, hint } }` and a JSON `Response` with the catalog status |
| `getErrorEntry`, `errorDocsUrl`, `PEPU_ERROR_CATALOG`, `PEPU_ERRORS_DOCS_URL` | The catalog the MCP tool `pepu_explain_error` also reads |

The full code list is in [SDK Error Catalog](errors.md). Snippet: `docs/snippets/errors.ts`.

```ts
// The SDK error model. See docs/sdk/core.md and docs/sdk/errors.md
import { PepuError, explainError, toErrorResponse, toPepuError } from "@pepu-chain/sdk";

export async function handler(run: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await run());
  } catch (e) {
    // { error: { code, message, hint } } with the status from the catalog.
    return toErrorResponse(e);
  }
}

export function describe(e: unknown): string {
  if (e instanceof PepuError) return `${e.code}: ${e.hint}`;
  const explained = explainError(e);
  return `${explained.code}: ${explained.fix}`;
}

export function retryable(e: unknown): boolean {
  return toPepuError(e, { op: "send" }).retryable;
}
```

Source: `docs/snippets/errors.ts`, type-checked against the SDK.

## Endpoints

```ts
resolvePepuEndpoints(options?: { bundlerUrl?, paymasterUrl?, rpcUrl?, env? }): PepuEndpoints
// { rpcUrl: string; bundlerUrl: string | null; paymasterBaseUrl: string | null; paymasterUrl: string | null; source: "explicit" | "env" | "hosted-default" }
```

Precedence per value: explicit option, then env (the server name, then the `NEXT_PUBLIC_` name), then `PEPU_HOSTED`. Names are in `PEPU_ENV` (`PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`, `PEPU_RPC_URL`) and `PEPU_PUBLIC_ENV` (the `NEXT_PUBLIC_` variants). `PEPU_HOSTED` is the single swap point: `{ bundlerUrl: "https://bundler.pepeunchained.com", paymasterBaseUrl: "https://paymaster.pepeunchained.com", paymasterUrl: null }`. `isHostedSponsorshipLive()` is `true`. The ERC-7677 URL always embeds a project token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`), so there is no tokenless default and `paymasterUrl` stays `null` until you set `PEPU_PAYMASTER_URL` or pass an option. `paymasterBaseUrl` is the paymaster service base (REST API, probes, `/v2/free-tier`): the hosted base, unless `PEPU_PAYMASTER_URL` is set, in which case it is that URL with the `/v2/paymaster/<token>` tail stripped. For your own services (for example local development) point the variables at `http://localhost:4337` (bundler) and `http://localhost:8788` (paymaster). A malformed value throws `CONFIG_BAD_URL` naming the variable, never the value.

Helpers: `paymasterBaseOf(url)` strips a trailing `/v2/paymaster/<token>` (or `/paymaster/<token>`) and slashes, leaving the service base. `hostedErc7677Url(token)` (from `@pepu-chain/sdk/paymaster`) returns `<hosted base>/v2/paymaster/<token>`; pass a project client token (`ppt_`). `hostedFreeTierUrl()` returns the public `GET` free-tier state route, `https://paymaster.pepeunchained.com/v2/free-tier`. `buildErc7677Url({ baseUrl, token, version })` builds the URL against any base. `requirePaymasterUrl(explicit?, token?)` (from `/aa`) resolves the complete ERC-7677 URL in the order explicit URL, `PEPU_PAYMASTER_URL`, then `token` built against the paymaster base, and otherwise throws `CONFIG_MISSING_ENV`.

A paymaster URL can embed a credential. Treat `PEPU_PAYMASTER_URL` as a secret and never expose it with a `NEXT_PUBLIC_` name unless it holds a publishable client token (`ppt_`).

## Sponsorship status and ERC-7677 builders

| Export | Signature | Notes |
|---|---|---|
| `checkSponsorship` | `(options?: CheckSponsorshipOptions) => Promise<SponsorshipReport>` | Probes the bundler and paymaster live. Never throws for an unreachable service. Fields: `available`, `transport`, `bundler`, `paymaster`, `reason`, `fixes` |
| `getSponsorshipStatus` | `(options?) => SponsorshipStatus` | Deprecated. Always `{ available: false }`. See [Migration Notes](migration.md) |
| `getPepuKernelStack` | `(chainId: number) => PepuKernelStack \| undefined` | The five Kernel contracts, `undefined` unless all are deployed |
| `getKernelAccountAddress` | `(client, factory, { data, salt }) => Promise<Address>` | Pass-through to the factory's `getAddress`. Build `data` with `@zerodev/sdk` or use `toPepuKernelAccount` |
| `buildPaymasterContext` | `(entries?) => PaymasterContext` | For example `{ privyAccessToken }` |
| `buildPaymasterStubDataRequest`, `buildPaymasterDataRequest` | `(options: BuildPaymasterRequestOptions) => request` | ERC-7677 JSON-RPC bodies for chain 97741 and EntryPoint v0.7 |

`checkSponsorship` is also exported from `/aa`. The page [/aa](aa.md) has the sponsored-send flow. Snippet: `docs/snippets/check-sponsorship.ts`.

```ts
// Live sponsorship status and the endpoint resolver. See docs/sdk/core.md and docs/sdk/aa.md
import { PEPU_ENV, checkSponsorship, getPublicClient, pepuMainnet, resolvePepuEndpoints } from "@pepu-chain/sdk";

export async function report(): Promise<void> {
  const { bundlerUrl, paymasterBaseUrl, paymasterUrl, source } = resolvePepuEndpoints();
  // The hosted bundler and paymaster service are the defaults. paymasterUrl (the complete ERC-7677 URL)
  // stays null until you set PEPU_PAYMASTER_URL, because that URL embeds a project token
  // (names only below: values can embed credentials).
  console.log(PEPU_ENV.bundlerUrl, bundlerUrl !== null, paymasterBaseUrl !== null, PEPU_ENV.paymasterUrl, paymasterUrl !== null, source);

  const s = await checkSponsorship({ publicClient: getPublicClient(pepuMainnet) });
  console.log(s.available, s.reason);
  for (const fix of s.fixes) console.log(`- ${fix}`);
}
```

Source: `docs/snippets/check-sponsorship.ts`, type-checked against the SDK.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `explorerUrl: no block explorer is configured` | You passed `pepuTestnet` | Use `pepuMainnet`. Testnet has no explorer |
| `TS2339: Property 'address' does not exist on type 'ContractEntry'` | You skipped `isDeployed` | Narrow with `isDeployed(entry)` first |
| Multicall returns empty data | A hand-written chain definition uses the canonical Multicall3 | Use `pepuMainnet` or `pepuMulticall` |
| `CONFIG_BAD_URL` | A set `PEPU_*_URL` is not an `http(s)` URL | Fix the variable the message names |
| `checkSponsorship` says no URL is configured | A variable was cleared, or the paymaster has no token | The hosted bundler and paymaster service are the defaults. Set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>` (or pass a token), or point both variables at your own services |

## Related

- [SDK Overview and Reference](reference.md)
- [Network Reference](../get-started/network-reference.md)
- [Address Map](../contracts/address-map.md)
