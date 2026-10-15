# @pepu-chain/sdk

Chain definitions, contract/DEX registries, ABIs, gas utilities, explorer
helpers, an account-abstraction surface, and a canonical token list for
**Pepe Unchained V2** — an Arbitrum Orbit / Nitro chain (ArbOS 51) hosted by
Conduit.

This package *extends* [viem](https://viem.sh). It does not wrap or
re-export viem's own API — you still use `viem` directly for clients,
actions, encoding, etc. `@pepu-chain/sdk` only supplies the PEPU-specific facts
viem doesn't know: chain IDs, RPC URLs, which contracts actually exist on
this chain (with on-chain-verified addresses only), ABIs for those
contracts, a token list, and small helpers layered on top.

Everything in this package is independently verified against live PEPU
mainnet (`eth_getCode` plus a successful read call, at minimum) — see each
module's source comments for exactly how. Nothing here is a guessed or
copied-from-elsewhere address.

## Install

```sh
npm install @pepu-chain/sdk viem
# or
pnpm add @pepu-chain/sdk viem
```

`viem` is a peer dependency (`^2.0.0`) — this package does not bundle it, so
your app controls its own viem version. `react` is an **optional** peer
dependency, needed only if you import from `@pepu-chain/sdk/react` (see below);
the main `@pepu-chain/sdk` entry point never touches React and works in a plain
Node script.

### Install: peers per subpath

Every subpath also needs `viem`. The entries below need extra peers, and **the recommended path is the CLI: `create-pepu-app` scaffolds an app with every peer already in its `package.json`**, so you never run these by hand. If you install by hand and a peer is missing, importing the subpath throws `PEPU_MISSING_PEER` naming the subpath and the exact command (under Node; bundlers report their own "module not found"). Subpaths not listed here (`.`, `/privy`, `/session`, `/aa`, `/paymaster`, `/paymaster/server`, `/server`, `/doctor`) need only `viem`.

| Subpath | Required peers | Install |
|---|---|---|
| `@pepu-chain/sdk/react` | `react` | `npm i react` |
| `@pepu-chain/sdk/privy/react` | `react`, `@privy-io/react-auth` | `npm i react @privy-io/react-auth` |
| `@pepu-chain/sdk/privy/wagmi` | `react`, `@privy-io/react-auth`, `@privy-io/wagmi`, `wagmi`, `@tanstack/react-query` | `npm i react @privy-io/react-auth @privy-io/wagmi wagmi @tanstack/react-query` |
| `@pepu-chain/sdk/privy/server` | `@privy-io/node` | `npm i @privy-io/node` |
| `@pepu-chain/sdk/session/server` | `@privy-io/node` | `npm i @privy-io/node` |
| `@pepu-chain/sdk/session/react` | `react`, `@privy-io/react-auth` | `npm i react @privy-io/react-auth` |
| `@pepu-chain/sdk/session/kernel` | `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator` | `npm i @zerodev/sdk @zerodev/permissions @zerodev/ecdsa-validator` |
| `@pepu-chain/sdk/aa/kernel` | `@zerodev/sdk`, `@zerodev/ecdsa-validator` | `npm i @zerodev/sdk @zerodev/ecdsa-validator` |
| `@pepu-chain/sdk/aa/react` | `react`, `@privy-io/react-auth`, `permissionless` | `npm i react @privy-io/react-auth permissionless` |
| `@pepu-chain/sdk/aa/react-direct` | `react`, `@privy-io/react-auth`, `@zerodev/sdk`, `@zerodev/ecdsa-validator` | `npm i react @privy-io/react-auth @zerodev/sdk @zerodev/ecdsa-validator` |
| `@pepu-chain/sdk/combo` | `@privy-io/node`, `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator` | `npm i @privy-io/node @zerodev/sdk @zerodev/permissions @zerodev/ecdsa-validator` |
| `@pepu-chain/sdk/combo/react` | `react`, `@privy-io/react-auth`, `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator` | `npm i react @privy-io/react-auth @zerodev/sdk @zerodev/permissions @zerodev/ecdsa-validator` |

**Bundle** for the common pillars (Google login + session keys + sponsored gas), client and server together:

```sh
npm i viem react @privy-io/react-auth @privy-io/node @zerodev/sdk @zerodev/permissions @zerodev/ecdsa-validator permissionless
```

## Quickstart

```ts
import { pepuMainnet, getPublicClient, explorerUrl } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);

const blockNumber = await client.getBlockNumber();
console.log(`Latest block: ${blockNumber}`);

console.log(explorerUrl(pepuMainnet, "tx", "0x..."));
// -> https://pepuscan.com/tx/0x...
```

Using it with wagmi is the same as any other chain:

```ts
import { createConfig, http } from "wagmi";
import { pepuMainnet } from "@pepu-chain/sdk";

export const config = createConfig({
  chains: [pepuMainnet],
  transports: {
    [pepuMainnet.id]: http(),
  },
});
```

## Chain registry & wallet helpers

```ts
import {
  pepuMainnet,
  pepuTestnet,
  pepuChains,
  isPepuChain,
  toAddEthereumChainParameter,
  switchOrAddPepuChain,
} from "@pepu-chain/sdk";

isPepuChain(97741); // true
isPepuChain(1); // false — Ethereum mainnet

// Build the `wallet_addEthereumChain` parameter object by hand:
toAddEthereumChainParameter(pepuMainnet);
// -> { chainId: "0x17dcd", chainName: "Pepe Unchained V2", ... }

// Or let a connected EIP-1193 provider add it if needed, then switch:
await switchOrAddPepuChain(window.ethereum, pepuMainnet);
```

## Contract registry

```ts
import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";

const permit2 = getContract(pepuMainnet.id, "permit2");
if (isDeployed(permit2)) {
  console.log(permit2.address);
  // -> 0x000000000022D473030F116dDEE9F6B43aC78BA3 (canonical Permit2)
}

const multicall3 = getContract(pepuMainnet.id, "multicall3");
// PEPU-specific address, NOT the canonical one — see "Known gaps" below.
```

`pepuContracts[chainId]` tracks, per chain, whichever of these exist:
`create2Factory`, `multicall3`, `permit2`, `entryPoint06`, `entryPoint07`,
`kernelFactory`, `kernelMetaFactory`, `ecdsaValidator`, `paymaster`. Every
entry is either `{ status: "deployed", address, notes? }` or
`{ status: "pending", reason }` — there is no field to accidentally read an
address off a pending entry; TypeScript won't let you.

The `paymaster` entry (alias of `paymasterV2`) is the v2 paymaster
`PepuSponsoredPaymasterV7` at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`,
deployed as a canary: internally reviewed 3x, external audit pending, funded in
small tranches. `paymasterV1` is retired (`retired: true`; its EntryPoint
deposit was withdrawn, so it cannot sponsor anything, never deposit to it).
`status: "deployed"` answers "does this contract exist," not "can my app get
gas sponsored." For that second question call `checkSponsorship()` (a live
probe of the hosted bundler and paymaster service). The deprecated
`getSponsorshipStatus()` still always reports unavailable.

## PepuSwap (DEX) registry

PepuSwap is PEPU's flagship DEX, a Uniswap V3 fork. Its contracts are
tracked separately from `pepuContracts` (see `src/dex.ts` for why) because
they're one application's deployment, not chain infrastructure:

```ts
import { getPepuSwapContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";

const router = getPepuSwapContract(pepuMainnet.id, "swapRouter02");
if (isDeployed(router)) {
  console.log(router.address); // 0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb
}
```

Tracked names: `v3Factory`, `swapRouter02`, `universalRouter`,
`positionManager`, `quoterV2`, `tickLens`, `v3Migrator`, `v3Staker`,
`multicallNonCanonical`, `permit2NonCanonical`. The last two are PepuSwap's
own overrides of otherwise-standard infrastructure — **do not** confuse them
with `pepuContracts.multicall3` / `pepuContracts.permit2`:

- `multicallNonCanonical` (`0x927af2a6B76d2d8206d93004463F8C122701383B`) is
  Uniswap's `UniswapInterfaceMulticall`, not Multicall3. See
  `pepuSwapMulticallAbi`.
- `permit2NonCanonical` (`0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B`) is
  PepuSwap's own separate Permit2 deployment, predating (and not
  interoperable with) the canonical Permit2 now also live on PEPU as
  `pepuContracts.permit2`.

`v3Migrator` and `v3Staker` are verified (address + a live read) but ship
without a dedicated ABI in `./abi/` — pair them with Uniswap's public
`V3Migrator`/`V3Staker` ABIs if you need their full interface.

## ABIs

`@pepu-chain/sdk` ships hand-verified ABI subsets — not full contract interfaces,
just the functions actually confirmed live — for every deployed contract in
both registries: `wpepuAbi`, `pepuSwapV3FactoryAbi`, `pepuSwapV3PoolAbi`,
`pepuSwapRouterAbi`, `pepuSwapQuoterAbi`, `pepuSwapPositionManagerAbi`,
`pepuSwapTickLensAbi`, `pepuSwapUniversalRouterAbi`, `pepuSwapPermit2Abi`,
`pepuSwapMulticallAbi`, `arbGasInfoAbi` (+ `ARB_GAS_INFO_ADDRESS`),
`entryPointV07Abi`, `kernelFactoryAbi` (+
`KERNEL_V3_1_IMPLEMENTATION_ADDRESS`), `kernelEcdsaValidatorAbi` (+
`ERC7579_MODULE_TYPE`). See each file under `src/abi/` for exactly which
functions were verified and how.

```ts
import { createPublicClient, http } from "viem";
import { pepuMainnet, getPepuSwapContract, isDeployed, pepuSwapV3FactoryAbi } from "@pepu-chain/sdk";

const client = createPublicClient({ chain: pepuMainnet, transport: http() });
const factory = getPepuSwapContract(pepuMainnet.id, "v3Factory");

if (isDeployed(factory)) {
  const pool = await client.readContract({
    address: factory.address,
    abi: pepuSwapV3FactoryAbi,
    functionName: "getPool",
    args: [wpepuAddress, usdtAddress, 3000],
  });
}
```

## Gas & fees

PEPU's Nitro dual-fee model (L2 execution + L1 data-posting) is not what
most developers expect, and its ~12,500 gwei base fee looks alarming if you
only know Ethereum's range — but PEPU is a low-value token, so naive
formatting misleads in both directions. See `src/gas.ts`.

```ts
import {
  getNitroFeeBreakdown,
  explainDualFeeModel,
  estimateTransactionCost,
  formatPepu,
  formatPepuGasPrice,
  maxSendableAmount,
} from "@pepu-chain/sdk";

const breakdown = await getNitroFeeBreakdown(client);
// { l2PricePerGasWei, l1PricePerCalldataUnitWei, l1BaseFeeEstimateWei }

console.log(explainDualFeeModel().summary);

const estimate = await estimateTransactionCost(client, {
  to: "0x...",
  value: 1000000000000000000n,
});
console.log(estimate.costFormatted); // e.g. "0.0000105 PEPU"

formatPepu(10_000_000_000n); // "0.00000001 PEPU" — not "0 PEPU"
formatPepuGasPrice(12_500_000_000_000n);
// "12500 gwei/gas (PEPU's normal baseline is ~12,500 gwei — this is not a congestion spike; see explainDualFeeModel())"
```

### "Send max" — sizing a transfer against the sender's own balance

Naive `balance - gasLimit * gasPrice` arithmetic is wrong on an Arbitrum
Nitro chain in general (see the dual-fee model above), and doubly wrong if
you plug in a hand-picked `gasLimit` instead of a real `eth_estimateGas`
result. `maxSendableAmount` does this correctly — and safely — for a
native-currency "Max" button:

```ts
import { maxSendableAmount } from "@pepu-chain/sdk";

const result = await maxSendableAmount({
  client,
  from: "0xSender...",
  to: "0xRecipient...", // omit while the user hasn't typed one yet
  balanceWei: senderBalance, // e.g. from wagmi's useBalance / viem's getBalance
});

switch (result.status) {
  case "ok":
    // result.amountWei is safe to fill into an amount field.
    // result.estimate / result.marginWei / result.totalReservedWei explain why.
    break;
  case "zero-balance":
  case "insufficient-for-gas":
    // result.reason is a ready-to-render explanation — disable the button, don't guess.
    break;
}
```

It never reimplements Nitro's fee math — it estimates the real transfer
with `estimateTransactionCost` (so the chain's own `eth_estimateGas`
decides gas usage) and applies a documented safety margin
(`DEFAULT_MAX_SEND_MARGIN_BPS`, 20% by default) on top, to absorb base-fee
movement between estimating and submitting. Estimation failures propagate
as a rejected promise rather than a silent fallback guess — see
`src/gas.ts`'s doc comment on `maxSendableAmount` for the full reasoning,
including why it can't just estimate gas using the balance itself as the
candidate `value` (circular, and most RPCs would reject the simulation for
insufficient funds).

**Not currently used by `templates/consumer-app`.** That template's send
form removed its "Max" button — not because this helper is wrong, but
because Privy's transaction confirmation modal performs its own separate,
over-conservative pre-flight balance check before signing, and on PEPU it
has been observed to reject transfers this function sizes correctly (e.g.
refusing a 0.2625 PEPU transfer from a 0.7748 PEPU balance). Since that
modal has final say, a correct "Max" amount can still bounce there, so the
button was removed rather than ship a control that sometimes lies. Reach
for `maxSendableAmount` for any PEPU wallet UI that submits transactions
itself instead of routing through Privy's modal.

## Explorer helpers & pepuscan client

```ts
import {
  explorerUrl,
  txUrl,
  addressUrl,
  tokenUrl,
  blockUrl,
  createPepuscanClient,
} from "@pepu-chain/sdk";

txUrl(pepuMainnet, "0x...");
blockUrl(pepuMainnet, 12345);

const pepuscan = createPepuscanClient(pepuMainnet);
const abi = await pepuscan.getVerifiedAbi("0x..."); // null if unverified
const meta = await pepuscan.getTokenMetadata("0x..."); // null if not a known token
```

`createPepuscanClient` is deliberately narrow — verified-ABI and
token-metadata reads only. It does not re-wrap Blockscout's full API
(transaction history, logs, NFTs, etc.); use the Blockscout MCP server for
that.

## Account abstraction and gas sponsorship

The full ZeroDev Kernel v3 stack (EntryPoint v0.6/v0.7, Kernel
factory/meta-factory, ECDSA validator) is deployed and verified on mainnet.
PEPU hosts the bundler (`https://bundler.pepeunchained.com`, the default for
`PEPU_BUNDLER_URL`) and the paymaster service
(`https://paymaster.pepeunchained.com`, exposed as
`resolvePepuEndpoints().paymasterBaseUrl`). Sponsorship is **proven on
mainnet** through those URLs: a project-sponsored operation from a fresh
Kernel account holding 0 PEPU, paid for by the v2 paymaster (a canary:
internally reviewed 3x, external audit pending, funded in small tranches, so
deposit in small amounts).

The ERC-7677 paymaster URL always embeds a token
(`https://paymaster.pepeunchained.com/v2/paymaster/<token>`), so there is no
tokenless default (`PEPU_HOSTED.paymasterUrl` is `null`). An app brings a
project: claim it, deposit into it, and use its token. Build the URL with
`hostedErc7677Url(token)` (from `@pepu-chain/sdk/paymaster`) or pass
`paymasterToken` to `createPepuPaymasterClient` /
`createPepuSponsoredClient`. A project client token (`ppt_`) works only from
the project's allowed origins; a server key (`ppk_`) is secret and server
only. The per-user free tier (100 PEPU/day and 50 PEPU/hour, TapScore only for
now) needs a verified Privy token from PEPU's own Privy app, so third-party
apps use a project. See [/paymaster](../../docs/sdk/paymaster.md) and
[/aa](../../docs/sdk/aa.md). The Google login + Kernel session key +
sponsorship combination is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster.

```ts
import {
  getPepuKernelStack,
  getKernelAccountAddress,
  getSponsorshipStatus,
  pepuMainnet,
} from "@pepu-chain/sdk";

const stack = getPepuKernelStack(pepuMainnet.id); // undefined on testnet
if (stack) {
  // Build `data` (Kernel v3.1's initialize() calldata) with @zerodev/sdk —
  // this package does not fabricate that encoding. Then:
  const address = await getKernelAccountAddress(client, stack.kernelFactory, {
    data, // from @zerodev/sdk
    salt: "0x0",
  });
}

getSponsorshipStatus();
// Deprecated and always { available: false }. Use `await checkSponsorship()` for the live answer.
```

## Token list

```ts
import { pepuTokenList } from "@pepu-chain/sdk";

console.log(pepuTokenList.tokens.map((t) => t.symbol));
// -> ["WPEPU", "USDT", "USDC", "WETH"]
```

`pepuTokenList` conforms to the
[Uniswap Token List schema](https://github.com/Uniswap/token-lists). Every
token address is independently on-chain verified (see `src/tokens.ts`) —
none are copied from a third-party list without cross-checking.

## React hooks (`@pepu-chain/sdk/react`)

A separate subpath so the core package never needs React installed.

```ts
import { usePepuBalance, usePepuChain, useSponsorshipStatus } from "@pepu-chain/sdk/react";

function Balance({ client, address }) {
  const { data, isLoading, error, refetch } = usePepuBalance(client, { address });
  // ...
}

function ChainBadge({ chainId }) {
  const { chain, isPepuChain } = usePepuChain(chainId);
  // ...
}

function SponsorshipNotice() {
  const { available, reason } = useSponsorshipStatus();
  // `available` is always false today — see "Account abstraction" above.
}
```

Every hook takes its viem client (or nothing extra at all) as a parameter
rather than reaching for one via a context provider this package would have
to define — use whatever client your app already has.

## Privy, session-signer and paymaster helpers

Three small additions so apps stop re-implementing the same Privy and ERC-7677 plumbing. None of them depends on a Privy package, and none of them implies sponsorship is available to an app.

| Import | Export | Description |
|---|---|---|
| `@pepu-chain/sdk/privy` (client-safe) | `createPepuPrivyConfig(options?)` | The `config` for `<PrivyProvider>`: `defaultChain` and `supportedChains` set to PEPU mainnet only, `embeddedWallets.ethereum.createOnLogin` (default `"off"`), and Coinbase Wallet pinned to `eoaOnly` |
| `@pepu-chain/sdk/server` (server-only) | `buildSessionPolicy({ contractAddress, functions, expiresAtUnixSeconds, name? })` | The scoped Privy policy for a session signer: one `ALLOW` rule per function, each pinning contract, function, zero value and expiry, on `eth_signTransaction`. Throws rather than build an unscoped policy |
| | `PRIVY_POLICY_NAME_MAX_LENGTH` (`49`), `assertWithinPolicyNameLimit(value, field)` | Privy rejects policy and rule names of 50 characters or more; the guard fails loudly at build time |
| | `signAndBroadcast({ client, from, to, data \| abi + functionName, chainId, sign })` | Resolves nonce, gas (+20%) and gas price against PEPU's RPC, hands the unsigned legacy transaction to your `sign` callback (Privy `eth_signTransaction`), broadcasts, returns the hash |
| | `broadcastSignedTransaction(client, signed)` | Broadcast a raw signed transaction (hex or `{ signed_transaction }`) and return the hash |
| `@pepu-chain/sdk` | `buildPaymasterContext(entries?)`, `buildPaymasterStubDataRequest(options)`, `buildPaymasterDataRequest(options)` | ERC-7677 request builders defaulting to chain 97741 and EntryPoint v0.7 |
| | `Erc7677UserOperation`, `PaymasterStubDataRequest`, `PaymasterDataRequest`, `PaymasterStubDataResult`, `PaymasterDataResult`, `PaymasterRpcResponse`, `PaymasterRpcError`, `PaymasterContext` | ERC-7677 request and response types |

```tsx
// Client: app/providers.tsx
import { createPepuPrivyConfig } from "@pepu-chain/sdk/privy";

const privyConfig = createPepuPrivyConfig({ loginMethods: ["email", "google", "wallet"] });
```

```ts
// Server: an authenticated route, never client code
import { buildSessionPolicy, signAndBroadcast } from "@pepu-chain/sdk/server";

const policy = buildSessionPolicy({
  contractAddress,
  functions: [tapAbiFragment],
  expiresAtUnixSeconds: Math.floor(Date.now() / 1000) + 15 * 60,
});

const hash = await signAndBroadcast({
  client: publicClient,
  from: wallet.address,
  to: contractAddress,
  data,
  chainId: 97741,
  sign: (transaction) =>
    privy.wallets().ethereum().signTransaction(wallet.id, {
      params: { transaction },
      authorization_context: { authorization_private_keys: [privyAuthorizationKey] },
    }),
});
```

The session policy is enforced by Privy's backend engine, not on-chain, and the user still pays gas. See [Session Keys](https://guide.pepeunchained.com/onboarding/session-keys) and [Sign with Privy, Broadcast Yourself](https://guide.pepeunchained.com/recipes/sign-with-privy-broadcast-yourself).

## Additions for app templates

All additive; nothing here changes an existing signature.

| Import | Export | What it does |
|---|---|---|
| `@pepu-chain/sdk` | `formatUnitsCompact(value, decimals, maxFractionDigits = 4)` | Short decimal string for any token's decimals (truncates, trims zeros). `formatPepu` is the 18-decimals PEPU one |
| `@pepu-chain/sdk` | `erc20Abi`, `erc721Abi` | viem's standard ABIs, re-exported from the abi module so apps import every ABI from one place |
| `/privy/react` | `<WalletGate loading error stalled>` | Render props for all three states: `loading` (node), `error(e, retry)`, `stalled(address, reload)`. Use it directly with your own markup |
| `/session/react` | `useSessionStatus().loading` | `true` until the first status response lands, so the consent screen does not flash on reload |
| `/combo/react` | `useSponsoredSession().statusLoading` | Same for the combo flow. `phase` stays `ready` while it is `true` |
| `/combo`, `/combo/react` | `SponsoredActResult` (type) | Response body of the combo `act` route. `useSponsoredSession<undefined, SponsoredActResult>()` |
| `/combo` | `resolveSessionMinutes` | Same session-length rule the routes use (`SESSION_DURATION_MINUTES`, default 15, clamped 1..1440) |
| `/aa/react` | `usePepuSmartAccount()` | Falls back to `useSmartWallets().getClientForChain({ id: 97741 })` while `client` is unset. Never loads `@zerodev/*`; needs `permissionless` |
| `/aa/react-direct` | `useDirectSponsoredSend`, `useDirectSmartAccount` | The direct transport (your own bundler and paymaster) split out of `/aa/react` so that entry never references ZeroDev. Needs `@zerodev/sdk` and `@zerodev/ecdsa-validator` |
| `/session/server`, `/combo` | `createSessionRoutes`, `createSessionActionRoute`, `createSponsoredSessionRoutes` | An empty or undefined contract address (an unset env variable) no longer throws at module load: every route answers `CONFIG_MISSING_ENV` as JSON at request time. Name the variable with `contractAddressEnv` (`targetEnv` in the combo scope). A non-empty malformed address still throws at creation |
| `/session`, `/session/kernel` | `describeKernelSessionScope`, `isCallInScope`, `parseApproval`, `checkApproval`, scope types | Pure helpers in `session/scope.ts`. Import them from `/session` to avoid the `@zerodev/*` peers; `/session/kernel` re-exports them |
| `/aa`, `/aa/kernel` | `encodeKernelExecute(calls)` | Pure ERC-7579 `execute` callData for a Kernel v3 UserOperation (single mode for one call, batch for several), no live account needed |
| `/aa`, `/aa/kernel` | `userOpEventsFromReceipt(receipt)` | Every `UserOperationEvent` in a receipt, without knowing the sender. `userOpEventFromReceipt` finds one sender's |

```tsx
<WalletGate
  loading={<Spinner />}
  error={(e, retry) => <button onClick={retry}>{e.message}</button>}
  stalled={(address, reload) => <button onClick={reload}>Reload ({address})</button>}
>
  <App />
</WalletGate>
```

## Public API

Named exports only — there is no default export, in either entry point.

### `@pepu-chain/sdk`

| Export | Kind | Description |
| --- | --- | --- |
| `pepuMainnet` / `pepuTestnet` | value | viem `Chain` objects for `97741` / `97740` |
| `pepuChains` | value | `[pepuMainnet, pepuTestnet]` |
| `PepuChain` / `PepuChainId` | type | Chain object / id union |
| `isPepuChain(chainId)` | function | Type guard: is this one of PEPU's chain ids? |
| `toAddEthereumChainParameter(chain)` | function | Build a `wallet_addEthereumChain` parameter object |
| `switchOrAddPepuChain(provider, chain)` | function | Switch an EIP-1193 provider to `chain`, adding it first if needed |
| `pepuContracts` | value | Chain-infrastructure contract registry, keyed by chain id |
| `getContract` / `listContracts` / `isDeployed` | function | Registry lookup / list / type-narrow |
| `PepuContractName` / `ContractEntry` / `DeployedContract` / `PendingContract` / `PepuContractRegistry` | type | Registry shapes |
| `pepuSwapContracts` | value | PepuSwap (DEX) contract registry, keyed by chain id |
| `getPepuSwapContract` / `listPepuSwapContracts` | function | PepuSwap registry lookup / list |
| `PepuSwapContractName` | type | Union of PepuSwap registry keys |
| `wpepuAbi`, `pepuSwapV3FactoryAbi`, `pepuSwapV3PoolAbi`, `pepuSwapRouterAbi`, `pepuSwapQuoterAbi`, `pepuSwapPositionManagerAbi`, `pepuSwapTickLensAbi`, `pepuSwapUniversalRouterAbi`, `pepuSwapPermit2Abi`, `pepuSwapMulticallAbi` | value | Verified PepuSwap/WPEPU ABI subsets |
| `arbGasInfoAbi` / `ARB_GAS_INFO_ADDRESS` | value | Arbitrum `ArbGasInfo` precompile ABI/address |
| `entryPointV07Abi` | value | ERC-4337 EntryPoint v0.7 deposit/nonce ABI subset |
| `kernelFactoryAbi` / `KERNEL_V3_1_IMPLEMENTATION_ADDRESS` | value | Kernel v3 factory ABI / verified implementation address |
| `kernelEcdsaValidatorAbi` / `ERC7579_MODULE_TYPE` | value | Kernel ECDSA validator ABI / ERC-7579 module type ids |
| `pepuTokenList` | value | Uniswap-schema token list |
| `PepuTokenList` / `PepuTokenInfo` | type | Token list shapes |
| `getPublicClient(chain, options?)` | function | Configured viem `PublicClient` |
| `explorerUrl(chain, type, value)` / `txUrl` / `addressUrl` / `tokenUrl` / `blockUrl` | function | Build Blockscout URLs |
| `ExplorerResourceType` | type | `"tx" \| "address" \| "token" \| "block"` |
| `createPepuscanClient(chain)` | function | Minimal pepuscan (Blockscout) client — verified-ABI + token-metadata reads |
| `PepuscanClient` / `PepuscanTokenMetadata` | type | pepuscan client shapes |
| `getNitroFeeBreakdown(client)` | function | Live L2/L1 fee components from `ArbGasInfo` |
| `explainDualFeeModel()` | function | Plain-English explanation of Nitro's dual-fee model |
| `estimateTransactionCost(client, request)` | function | Estimate a transaction's PEPU cost |
| `formatPepu(wei, options?)` / `formatPepuGasPrice(weiPerGas)` | function | PEPU-appropriate amount/gas-price formatting |
| `maxSendableAmount(options)` | function | Largest amount sendable from a balance after gas + safety margin |
| `DEFAULT_MAX_SEND_MARGIN_BPS` | value | Default safety margin `maxSendableAmount` applies (2000 = 20%) |
| `NitroFeeBreakdown` / `DualFeeModelExplanation` / `TransactionCostEstimate` / `FormatPepuOptions` / `MaxSendableAmountOptions` / `MaxSendableAmountResult` | type | Gas module shapes |
| `getPepuKernelStack(chainId)` | function | The 5 AA contracts, grouped, `undefined` unless all deployed |
| `getKernelAccountAddress(client, factory, args)` | function | Thin pass-through to the Kernel factory's `getAddress` |
| `getSponsorshipStatus(options?)` | function | Always-honest gas-sponsorship availability check |
| `PepuKernelStack` / `SponsorshipStatus` / `GetSponsorshipStatusOptions` | type | AA module shapes |
| `buildPaymasterContext(entries?)` / `buildPaymasterStubDataRequest(options)` / `buildPaymasterDataRequest(options)` | function | ERC-7677 context and JSON-RPC request builders (chain 97741, EntryPoint v0.7 by default) |
| `Erc7677UserOperation` / `PaymasterStubDataRequest` / `PaymasterDataRequest` / `PaymasterStubDataResult` / `PaymasterDataResult` / `PaymasterRpcResponse` / `PaymasterRpcError` / `PaymasterRpcParams` / `PaymasterContext` / `BuildPaymasterRequestOptions` | type | ERC-7677 types |

### `@pepu-chain/sdk/react` (requires `react` installed)

| Export | Kind | Description |
| --- | --- | --- |
| `usePepuBalance(client, options)` | hook | Read (and optionally poll) a native or ERC-20 balance |
| `usePepuChain(chainId)` | hook | Resolve a raw chain id to its `PepuChain`, if it's one of PEPU's |
| `useSponsorshipStatus(options?)` | hook | React wrapper around `getSponsorshipStatus` |
| `UsePepuBalanceOptions` / `UsePepuBalanceResult` / `UsePepuChainResult` | type | Hook option/result shapes |

### `@pepu-chain/sdk/privy` (client-safe, no Privy dependency)

| Export | Kind | Description |
| --- | --- | --- |
| `createPepuPrivyConfig(options?)` | function | `<PrivyProvider>` config: PEPU mainnet only, `createOnLogin` (default `"off"`), Coinbase `eoaOnly` |
| `PepuPrivyClientConfig` / `CreatePepuPrivyConfigOptions` / `PrivyLoginMethod` / `EmbeddedWalletCreateOnLogin` | type | Config shapes |

### `@pepu-chain/sdk/server` (server-only: keep out of client bundles)

| Export | Kind | Description |
| --- | --- | --- |
| `buildSessionPolicy(params)` | function | Scoped Privy session-signer policy (contract, function(s), zero value, expiry); refuses an unscoped policy |
| `PRIVY_POLICY_NAME_MAX_LENGTH` / `assertWithinPolicyNameLimit(value, field)` | value / function | Privy name limit (49) and its guard |
| `signAndBroadcast(params)` | function | Resolve fields, sign via your `sign` callback, broadcast, return the hash |
| `broadcastSignedTransaction(client, signed)` | function | Broadcast a raw signed transaction, return the hash |
| `withGasLimitBuffer(gas)` | function | Gas estimate plus 20% |
| `SessionPolicy` / `SessionPolicyRule` / `SessionPolicyCondition` / `BuildSessionPolicyParams` / `PrivyUnsignedTransaction` / `SignedTransactionLike` / `BroadcastClient` / `SignAndBroadcastClient` / `SignAndBroadcastParams` | type | Server helper shapes |

## Known gaps

Deliberate omissions, not oversights — each is tracked so it can be filled
in later without a breaking change.

- **Sponsorship needs a project.** The hosted bundler and paymaster service are
  live and the v2 paymaster is a canary (external audit pending), but every
  ERC-7677 URL embeds a project token and there is no tokenless default.
  `getSponsorshipStatus()` / `useSponsorshipStatus()` are deprecated and
  always report `available: false`; use `checkSponsorship()` /
  `usePepuSponsorship()` for the live answer.
- **Testnet (97740) is out of scope.** No faucet exists to fund
  verification there, so every `pepuContracts` entry beyond
  `create2Factory` stays `status: "pending"`, there's no PepuSwap
  deployment, no Blockscout explorer, and no verified token addresses.
  Don't "fix" this by copying mainnet's entries onto testnet.
- **`multicall3` and the DEX's `multicallNonCanonical`/`permit2NonCanonical`
  are deliberately not at their "canonical" addresses.** See the Contract
  registry and PepuSwap sections above — this is a real, verified fact
  about this chain, not a placeholder.
- **`v3Migrator` and `v3Staker` have verified addresses but no dedicated
  ABI** in `./abi/` — only enough getters were checked to confirm the
  address, not their full interface.
- **Kernel account creation (`initialize()` calldata encoding) is not
  implemented here.** No account has ever been created through PEPU's
  Kernel factory, so there was nothing on-chain to check a hand-rolled
  encoding against — use `@zerodev/sdk` to build that payload, then pass it
  to `getKernelAccountAddress`.
- **The token list has four tokens (WPEPU, USDT, USDC and WETH on mainnet).** Every
  entry is independently on-chain verified; no other token address cleared
  that bar at the time this package was written.

## Development

See [AGENTS.md](./AGENTS.md) for how to build, test, and extend this
package.
