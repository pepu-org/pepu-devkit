# AGENTS.md — @pepu-chain/sdk

Instructions for a coding agent working inside `packages/sdk/`. This
package is the foundation every other PEPU deliverable (`@pepu-chain/mcp`,
templates, docs examples) imports, so treat its public API as load-bearing:
changes here ripple outward.

## What this package is

A small, tree-shakeable TypeScript package that extends
[viem](https://viem.sh) with Pepe Unchained V2-specific facts. Four entry
points (core, `/react`, `/privy`, `/server`):

- `@pepu-chain/sdk` (`src/index.ts`) — chain-agnostic-of-React core. Must remain
  importable from a plain Node script with no `react` installed.
- `@pepu-chain/sdk/react` (`src/react/index.ts`) — optional React hooks built on
  the core. The **only** place in this package allowed to `import` from
  `"react"`.

### Core modules (`src/index.ts` re-exports all of these)

- `src/chains.ts` — `pepuMainnet` / `pepuTestnet` viem `Chain` objects,
  `pepuChains`, `isPepuChain`.
- `src/contracts.ts` — a typed registry of *chain-infrastructure* contract
  addresses per chain id (CREATE2 deployer, Multicall3, Permit2, the ZeroDev
  Kernel v3 AA stack), with an explicit deployed/pending status per entry.
- `src/dex.ts` — a separate typed registry for *PepuSwap's* (the DEX
  application's) own contracts. Kept apart from `contracts.ts` deliberately
  — see that file's module doc comment for why chain infra and one dapp's
  deployment shouldn't share a registry.
- `src/abi/*.ts` — one file per verified contract/precompile, each ABI a
  hand-verified subset (only functions actually confirmed live), not a full
  copied interface. `src/abi/index.ts` re-exports all of them.
- `src/tokens.ts` — a Uniswap Token List-schema-conformant token list.
- `src/client.ts` — `getPublicClient(chain)`, a thin wrapper around
  `createPublicClient`.
- `src/explorer.ts` — `explorerUrl` + named shorthands (`txUrl`,
  `addressUrl`, `tokenUrl`, `blockUrl`) for Blockscout links.
- `src/pepuscan.ts` — `createPepuscanClient`, a deliberately narrow
  Blockscout REST client (verified-ABI + token-metadata reads only — not a
  general Blockscout wrapper; that's `@pepu-chain/mcp`'s job).
- `src/wallet.ts` — `toAddEthereumChainParameter` / `switchOrAddPepuChain`,
  EIP-1193/EIP-3085/EIP-3326 wallet-chain-management helpers.
- `src/gas.ts` — `getNitroFeeBreakdown`, `explainDualFeeModel`,
  `estimateTransactionCost`, `formatPepu`, `formatPepuGasPrice`,
  `maxSendableAmount` (+ `DEFAULT_MAX_SEND_MARGIN_BPS`). PEPU's
  Nitro dual-fee model and low token value both make naive
  Ethereum-style gas formatting misleading — see the module doc comments.
  `maxSendableAmount` is the "how much can I send and still cover gas"
  calculation every native-transfer "Max" button on PEPU needs; it builds
  on `estimateTransactionCost` rather than reimplementing gas math, so it
  stays correct automatically if this chain's fee model ever changes.
  `templates/consumer-app` does **not** call it: Privy's transaction modal
  runs its own separate, over-conservative balance check ahead of signing
  and has been observed rejecting transfers this function sizes correctly,
  so that template dropped its "Max" button rather than wire up a helper
  whose answer Privy's modal can override anyway. Don't read that as this
  helper being unused elsewhere or safe to delete — see the "NOT WIRED
  INTO" note on its doc comment in `src/gas.ts` before touching either
  side of that decision.
- `src/aa.ts` — `getPepuKernelStack`, `getKernelAccountAddress`,
  `getSponsorshipStatus`. Contracts/ABIs only, **no sponsorship** — see
  "Gas sponsorship" below.

- `src/erc7677.ts` — ERC-7677 request/response types and
  `buildPaymasterContext` / `buildPaymasterStubDataRequest` /
  `buildPaymasterDataRequest`. Pure, client-safe, re-exported from core.

### Subpath entry points

- `@pepu-chain/sdk/privy` (`src/privy.ts`) — `createPepuPrivyConfig`. Client-safe,
  no Privy dependency (structural types only). Mainnet only, Coinbase `eoaOnly`.
- `@pepu-chain/sdk/server` (`src/server.ts`) — **server-only**:
  `buildSessionPolicy` (ported from `templates/game-app/lib/session-policy.ts`;
  must stay scoped, so it throws on no functions / bad address / no expiry),
  `PRIVY_POLICY_NAME_MAX_LENGTH` (49) + `assertWithinPolicyNameLimit`,
  `signAndBroadcast`, `broadcastSignedTransaction`, `withGasLimitBuffer`. No
  other module in `src/` may import `./server` (`test/server.test.ts` enforces
  it), and it is not re-exported from `src/index.ts`, so client bundles that
  import the core never pull it in. Privy's policy name limit: 50+ characters
  is rejected, so the maximum is 49 (the published spec's `maxLength: 50` is
  off by one against the live validator).

### React subpath (`src/react/index.ts` re-exports all of these)

- `src/react/usePepuBalance.ts`, `usePepuChain.ts`, `useSponsorshipStatus.ts`.

### Template-driven additions (additive)

`formatUnitsCompact` (`src/gas.ts`), `erc20Abi`/`erc721Abi` (re-exported from viem in `src/abi/index.ts`: the one deliberate exception to the "never re-export viem names" rule below, so templates import ABIs from one place), `WalletGate` `loading`/`error`/`stalled` render props, `useSessionStatus().loading`, `useSponsoredSession().statusLoading`, `SponsoredActResult` (`src/combo/types.ts`), `resolveSessionMinutes` from `/combo`, the `getClientForChain` fallback in `usePepuSmartAccount`, `encodeKernelExecute` and `userOpEventsFromReceipt` (`src/aa/calls.ts`), and the pure Kernel session helpers in `src/session/scope.ts` (re-exported by `/session` and `/session/kernel`; keep it free of `@zerodev/*`). The session and combo route factories validate lazily: an empty contract address yields a `CONFIG_MISSING_ENV` JSON response per request, never a throw at module load, but a non-empty malformed scope still throws at creation. Keep both behaviours when editing them.

### The two index files decide what's public

If it isn't exported from `src/index.ts` (or, for the React hooks,
`src/react/index.ts`), it isn't part of the API.

It is **not** a wrapper around viem — never re-export or shadow viem's own
names (`createPublicClient`, `http`, `Address`, etc.) from this package's
public API. Consumers install `viem` themselves (it's a peer dependency)
and use it directly alongside `@pepu-chain/sdk`.

## Build, test, typecheck

Run from `packages/sdk/` (or `pnpm --filter @pepu-chain/sdk <script>` from the
repo root):

```sh
pnpm install     # from the repo root — this is a pnpm workspace
pnpm build       # tsup -> dist/{index,react,privy,server}.{js,cjs,d.ts,d.cts}
pnpm typecheck   # tsc --noEmit, strict mode
pnpm test        # vitest run
```

All three must pass before you're done. `pnpm build` produces four entry
points (`index`, `react`, `privy`, `server`), each as ESM + CJS + type declarations, via
`tsup.config.ts`. `viem` and `react` are both marked `external` in that
config — neither must ever end up bundled into `dist/`. After changing
`src/react/**` or anything it depends on, spot-check that `dist/index.js`
and `dist/index.cjs` contain zero occurrences of the string `"react"` — if
they do, something outside `src/react/` started importing it.

Windows note: `tsup`/`esbuild` need their postinstall script to run. If
`pnpm install` reports `[ERR_PNPM_IGNORED_BUILDS]`, run
`pnpm approve-builds` (or set `allowBuilds: { esbuild: true }` in the root
`pnpm-workspace.yaml`) and reinstall — otherwise the `esbuild` binary is
missing and `pnpm build` / `pnpm test` will fail.

If you add a module that uses a Node/web global not otherwise referenced in
this package (e.g. `fetch`, as `src/pepuscan.ts` does), make sure
`@types/node` is a devDependency — tsup's isolated per-entry-point `.d.ts`
build does not reliably pick up ambient globals the way a normal `tsc`
run does, and will fail with `Cannot find name 'fetch'` (or similar) even
when plain `tsc --noEmit` passes.

## React stays optional

`react` is a `peerDependencies` entry with `peerDependenciesMeta.react.optional
= true`, and lives on its own `./react` subpath / `dist/react.*` build
output. Rules for keeping this true:

1. Nothing under `src/` outside `src/react/` may import `"react"`, directly
   or transitively. `test/no-react-in-core.test.ts` enforces this two ways:
   a static scan of `src/` for a `react` import, and a `vi.mock("react", ()
   => { throw })` guard around importing `src/index.ts` — if core ever
   pulls react in, that test fails with a real error, not just a lint
   warning.
2. `src/react/**` hooks take whatever client/data they need as parameters
   (see `usePepuBalance`'s `client: PublicClient<...>` argument) rather than
   this package shipping its own context provider — that would be a second,
   competing way to obtain a client, and it's unnecessary.
3. When testing a hook, put `// @vitest-environment jsdom` as the first line
   of the test file (per-file override — the package's default Vitest
   environment stays `"node"` for every other test) and use
   `@testing-library/react`'s `renderHook`/`act`/`waitFor`/`cleanup`. Mock
   the viem client via `createPublicClient({ chain, transport: custom({
   request: async (...) => ... }, { retryCount: 0 }) })` — set
   `retryCount: 0` for any mock that's meant to simulate a failing call, or
   viem's default retry/backoff will make the test race (and likely miss)
   `waitFor`'s default timeout instead of failing fast.

## Tests must not touch the network

Every test in `test/` runs offline. When adding tests:

- For chain definitions: assert plain fields (`id`, `name`,
  `nativeCurrency`, `rpcUrls`, `blockExplorers`) — don't call
  `getBlockNumber()` or anything that performs `fetch`.
- For `getPublicClient`: inspect `client.transport.type` and
  `client.transport.url` (viem flattens the transport's `config`/`value`
  onto `client.transport` — see `clients/createClient.ts` in viem's
  source if this ever needs re-verifying against a new viem version).
  Never call a method on the returned client.
- For anything that calls `client.readContract` / `estimateGas` /
  `getBalance` (`gas.ts`, `aa.ts`, the React hooks): build the client with
  viem's `custom` transport and a hand-written `request` handler that
  decodes the call (`decodeFunctionData`) and returns a hand-encoded
  response (`encodeFunctionResult`) — see `test/gas.test.ts` / `test/aa.test.ts`
  / `test/react/usePepuBalance.test.ts` for the pattern. Never point a test
  client at a real RPC URL.
- For `pepuscan.ts`: stub `globalThis.fetch` with `vi.spyOn` (see
  `test/pepuscan.test.ts`) — never let a real `fetch` happen.
- For the token list: validate structurally against the vendored schema
  in `test/fixtures/uniswap-tokenlist.schema.json` using `ajv`. Don't
  fetch the schema from the network at test time — if Uniswap revises
  their schema, re-vendor the file deliberately (copy it from
  `node_modules/@uniswap/token-lists/src/tokenlist.schema.json` after a
  temporary local install, or from
  https://github.com/Uniswap/token-lists) and note why in the commit.

## Gas sponsorship

Sponsorship uses the hosted bundler (`https://bundler.pepeunchained.com`)
and paymaster service (`https://paymaster.pepeunchained.com`). Deposits to the
v2 paymaster are one-way. The v1 paymaster is retired (`retired: true`).

- The ERC-7677 URL always embeds a token, so `PEPU_HOSTED.paymasterUrl` stays
  `null`. Do not invent a tokenless default. `paymasterBaseUrl` is the service
  base; `hostedErc7677Url(token)` and `buildErc7677Url` build the full URL.
- `checkSponsorship()` / `usePepuSponsorship()` are the live answer. The
  deprecated `getSponsorshipStatus()` (core) and `useSponsorshipStatus()`
  (React) must keep returning `available: false`; their `bundlerUrl` option
  must never flip `available` to `true`.
- `createSponsoredSessionRoutes` forwards the request's Privy token to the
  paymaster by default (`forwardPrivyToken`); keep that opt-out.

## Hard rules for this package specifically

1. **Never invent a contract or token address.** If you don't have a
   verified address (`eth_getCode` returning non-empty bytecode, **plus** a
   successful read call against a real function on that contract), the
   entry either doesn't exist yet or goes into `pepuContracts` /
   `pepuSwapContracts` with `status: "pending"` and a `reason` — never a
   `status: "deployed"` entry with a guessed/placeholder address. Same for
   the token list and every ABI file: don't ship an ABI function that
   wasn't independently confirmed to exist (a `view`/`pure` function should
   be called; a state-mutating one can be `eth_call`-simulated instead of
   sent, as several ABI files here already do — see their doc comments for
   the pattern).
2. **Never set a "canonical"/well-known address on this chain unless
   you've confirmed it has code deployed on *this specific chain*.** PEPU
   is a running cautionary example: Multicall3, PepuSwap's Multicall, and
   PepuSwap's Permit2 are all deliberately *not* at their canonical
   addresses (see `src/chains.ts`, `src/contracts.ts`, and `src/dex.ts` for
   the specifics). The canonical Permit2 address, by contrast, genuinely
   *is* now live on PEPU (`pepuContracts.permit2`) — verify per-case, don't
   pattern-match from one contract to another.
3. **Don't assume the two chains are symmetric.** Mainnet has the full
   contract/DEX/AA stack verified; testnet (97740) is out of scope (no
   faucet exists to fund verification there) and stays `status: "pending"`
   across the board, with no PepuSwap entries and no token list entries.
   Don't "fix" this by copying mainnet's entries onto testnet.
4. **Keep the public API small.** Before adding a new named export to
   `src/index.ts` or `src/react/index.ts`, ask whether it belongs in this
   package at all versus a template, a doc, or `@pepu-chain/mcp`. This package is
   chain facts + thin viem/React helpers, not a general PEPU toolkit — see
   `src/pepuscan.ts`'s doc comment for a concrete example of a deliberately
   narrow scope cut.
5. **Adding a new contract to a registry is additive, not breaking:** add a
   new literal to `PepuContractName` (`src/contracts.ts`) or
   `PepuSwapContractName` (`src/dex.ts`), add a corresponding entry to
   *every* chain's registry object in that file (even if it's
   `status: "pending"`), and add a test. Don't change the shape of existing
   entries.
6. **Adding a new token is additive too:** append to `pepuTokenList.tokens`
   and bump `version.minor` (or `version.patch` for metadata-only fixes)
   per the Token List spec's own versioning rules — don't bump
   `version.major` unless you're removing a token or changing an existing
   token's address.
7. **No default exports, anywhere in `src/`.** Match the existing
   `export { ... }` / `export type { ... }` style in `src/index.ts` and
   `src/react/index.ts`.
8. **`react` stays optional and confined to `src/react/`.** See "React
   stays optional" above before touching anything that could pull it into
   the core import graph.
9. **Never ship anything implying gas sponsorship works.** See "Gas
   sponsorship" above.

## Scope boundary

This package only touches `packages/sdk/`. If a change here seems to
require editing `packages/mcp`, `docs/`, `skills/`, `services/` (the
bundler/paymaster being built separately), or the repo-root `package.json`
/ `pnpm-workspace.yaml`, stop and flag it instead of editing those directly
— other work happens there in parallel.
