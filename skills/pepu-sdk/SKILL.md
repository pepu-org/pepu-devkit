---
name: pepu-sdk
description: Cheat sheet for @pepu-chain/sdk, the PEPU dev kit's function library - the subpath map, "if you want X, import Y", which entries are server-only, client-only or ESM-only, and the rule against reimplementing what it ships. Covers chain and contracts (pepuMainnet, getPepuAddresses, pepuMulticall, permit2, explorerLinks, errors), /privy, /privy/react, /privy/wagmi, /privy/server, /session (+server, react, kernel), /aa (+kernel, react), /paymaster (+server), /combo (+react), /doctor. Use first whenever you are about to write PEPU infrastructure code by hand, need to pick the right import, or want to list what the SDK exports through the MCP tools pepu_sdk_exports and pepu_sdk_snippet.
---

# The PEPU SDK in one page

`@pepu-chain/sdk` is the single source of truth for chain facts and PEPU infrastructure code. Templates, the MCP server and these skills are built on it. **If a function below does what you were about to write, import it.**

## When to use

Before writing any PEPU chain config, wallet provisioning, session, sponsorship or paymaster code; when unsure which subpath exports something; when reviewing a diff for hand-rolled infrastructure.

## Chain facts

Generated from the SDK: [reference/chain-facts.md](reference/chain-facts.md). Rules and the "never hand-roll" table: [reference/rules.md](reference/rules.md). Chain 97741, mainnet only.

## SDK functions to use

Install: `pnpm add @pepu-chain/sdk viem`. Every peer is optional; install only what a subpath you import needs. Scaffolded apps get the SDK from `file:./vendor/pepu-sdk` until it is published to npm.

```ts
import { pepuMainnet, getPepuAddresses, pepuMulticall, explorerLinks, explainError } from "@pepu-chain/sdk";
import { PepuPrivyProvider, WalletGate } from "@pepu-chain/sdk/privy/react";
import { createEnsureWalletRoute, requireUser } from "@pepu-chain/sdk/privy/server";
import { createSessionRoutes, createSessionActionRoute } from "@pepu-chain/sdk/session/server";
import { useSponsoredSend } from "@pepu-chain/sdk/aa/react";
import { createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import { computeProjectId } from "@pepu-chain/sdk/paymaster";
import { checkPepuEnv } from "@pepu-chain/sdk/doctor";
```

### Subpath map

| Subpath | Runs on | Peers | What it gives you |
|---|---|---|---|
| `@pepu-chain/sdk` | anywhere | viem | `pepuMainnet`, `getPublicClient`, `getPepuAddresses`/`getContract`/`isDeployed`, `pepuMulticall`/`encodeAggregate3`, `getPermit2`/`permit2Domain`/`buildPermitSingleTypedData`/`readPermit2Allowance`, `explorerLinks`, `explainError`/`toPepuError`/`toErrorResponse`/`PepuError`, `resolvePepuEndpoints`/`PEPU_ENV`/`PEPU_HOSTED`, ERC-7677 builders, `checkSponsorship`, gas helpers (`estimateTransactionCost`, `maxSendableAmount`, `formatPepu`), `pepuTokenList`, PepuSwap addresses and ABIs |
| `/privy` | anywhere | none | `createPepuPrivyConfig`, `PRIVY_ENV`, `PEPU_PRIVY_REQUIREMENTS`, `checkPrivyDashboardConfig`, `privyDashboardChecker` |
| `/privy/react` | browser | react, `@privy-io/react-auth` | `PepuPrivyProvider`, `WalletGate`, `useEmbeddedWallet`, `useEnsureWallet`, `usePepuAuthFetch`, `usePinEmbeddedWallet`, `composeProviders` |
| `/privy/wagmi` | browser, **ESM only** | + `@privy-io/wagmi`, wagmi, react-query | `pepuWagmiConfig`, `PepuPrivyWagmiProvider`, `useActiveWalletPin` |
| `/privy/server` | **server only** | `@privy-io/node` | `createPrivyServer`, `readPrivyServerEnv`, `requireUser`, `verifyRequestUser`, `createEnsureWalletRoute`, `findEmbeddedEthereumWallet`, `findDelegatedEthereumWallet` |
| `/session` | anywhere | viem | Privy-mode policy: `buildSessionPolicy`, `describeSessionScope`, `SESSION_TRUST_NOTICE`, `signAndBroadcast` |
| `/session/server` | **server only** | `@privy-io/node` | `createSessionRoutes`, `createSessionActionRoute`, `privySessionSigner` |
| `/session/react` | browser | react, `@privy-io/react-auth` | `useSessionGrant`, `useSessionStatus`, `useSessionAct`, `useSessionRevoke` |
| `/session/kernel` | anywhere | `@zerodev/*` | on-chain sessions: `buildKernelSessionPolicies`, `describeKernelSessionScope`, `approveKernelSession`, `loadKernelSessionAccount`, `generateSessionKey`, `createMemoryStore` |
| `/aa` | anywhere | viem | `probeBundler`, `probePaymaster`, `checkSponsorship`, `describeUserOpFailure`, `createPepuBundlerClient`, `createPepuPaymasterClient`, `getPaymasterDeposit`, `getPepuKernelStack` |
| `/aa/kernel` | anywhere | `@zerodev/*` | `toPepuKernelAccount`, `getKernelAddress`, `createPepuSponsoredClient`, `sendSponsored` |
| `/aa/react` | browser | react, Privy | `useSponsoredSend`, `usePepuSmartAccount`, `usePepuSponsorship` |
| `/paymaster` | anywhere | viem | v1 and v2 REST (`createPaymasterApi`), `computeProjectId`, `readProject`, `configureProject`, `depositFor`, `encode*`, `mapPaymasterReason` |
| `/paymaster/server` | **server only** | none | `requestClaimAttestation` (sends your Privy app secret to PEPU's service) |
| `/combo` | **server only** | `@privy-io/node`, `@zerodev/*` | `createSponsoredSessionRoutes`, `createMemoryStore` |
| `/combo/react` | browser | react, Privy, `@zerodev/*` | `useSponsoredSession`, `grantKernelSession` |
| `/doctor` | node | none | `runDoctor`, `checkPepuEnv`, `TEMPLATE_REQUIREMENTS`, `checkChainRpc`, `checkSponsorshipEndpoints`, `generatePrivyAuthorizationKey` |

Server entries throw when imported in a browser bundle (`assertServerOnly`). `/server` is a legacy barrel of the pure session helpers; new code imports `/session`.

### If you want X, import Y

| Want | Import | Skill |
|---|---|---|
| a PEPU chain object, client, explorer link | `pepuMainnet`, `getPublicClient`, `explorerLinks` from `@pepu-chain/sdk` | `pepu-chain-setup` |
| batched reads | `pepuMulticall` from `@pepu-chain/sdk` | `pepu-chain-setup` |
| Google login and a wallet | `PepuPrivyWagmiProvider` or `PepuPrivyProvider`, `WalletGate`, `createEnsureWalletRoute`, `requireUser` | `pepu-onboarding-privy` |
| popup-free actions, user pays gas | `createSessionRoutes`, `createSessionActionRoute`, `useSessionGrant`, `useSessionAct` | `pepu-session-keys` |
| gasless sends | `useSponsoredSend`, `sendSponsored`, `createPepuSponsoredClient`, `checkSponsorship` | `pepu-sponsored-transactions` |
| login plus session plus gasless | `createSponsoredSessionRoutes`, `useSponsoredSession` | `pepu-sponsored-session` |
| v2 project funding (deployed canary, audit pending) | `computeProjectId`, `configureProject`, `depositFor`, `requestClaimAttestation` | `pepu-paymaster-projects` |
| explain a failure | `explainError`, `describeUserOpFailure`, `toErrorResponse` | `pepu-debug-transaction` |
| check an env file | `checkPepuEnv`, `runDoctor` from `/doctor` | `pepu-build-dapp` |
| an authorization key pair | `generatePrivyAuthorizationKey` from `/doctor` | `pepu-session-keys` |

## MCP tools to call first

- `pepu_sdk_exports` with `subpath` (for example `session` or `@pepu-chain/sdk/aa`), optional `search` and `kind`: the real export list with one-line summaries. Use it instead of guessing a name.
- `pepu_sdk_snippet` with `task` (omit to list): canonical, import-checked code for `privy-provider`, `ensure-wallet-route`, `wagmi-privy`, `grant-session`, `session-routes`, `session-action-route`, `kernel-session-policy`, `sponsored-send`, `sponsored-send-server`, `check-sponsorship`, `sponsored-session`, `sponsored-session-client`, `multicall-read`, `permit2-permit`, `v2-deposit`.
- The resource `pepu://sdk/exports` is the same export list; `pepu_get_docs` searches the docs.

## Steps

1. Say what you need in one line ("provision a wallet after login"). Look it up in the table above, then confirm with `pepu_sdk_exports`.
2. Fetch the canonical snippet with `pepu_sdk_snippet` if one exists; otherwise read the export's summary.
3. Import from the exact subpath. Mind server-only and ESM-only.
4. Write only the glue the SDK does not provide (your contract ABI, your UI). Keep that glue small.
5. If the SDK lacks a function, say so, write the smallest local code and mark it `// TODO(sdk): ...`.

## Verify

1. `npm run typecheck`: a wrong subpath or symbol fails here.
2. In this repo `node scripts/check-plugin.mjs` checks every symbol named in the skills against the built SDK.
3. `grep -rn "defineChain\|0xcA11bde0\|new PrivyClient\|eth_sendTransaction" src app lib` finds hand-rolled leftovers.

## Pitfalls

- Importing `/privy/server`, `/session/server`, `/combo` or `/paymaster/server` from a client component fails at import time. Keep them in route handlers and server modules.
- `/privy/wagmi` has no CommonJS build.
- A server entry's peers (`@privy-io/node`, `@zerodev/*`) are optional peers: install them or the import fails.
- `@pepu-chain/sdk/server` is a compatibility barrel; do not add new imports from it.
- Type-only names (interfaces) have no runtime export: use `import type`.

## Never hand-roll

This whole skill is the answer to "what should I not write myself". The detailed table is in [reference/rules.md](reference/rules.md): chain objects, addresses, Multicall3, Permit2, Privy config, wallet creation, token verification, session policies and routes, authorization keys, Kernel accounts, sponsored sends, probes, error mapping, project ids, env checks, gas maths.
