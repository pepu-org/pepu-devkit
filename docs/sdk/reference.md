# `@pepu-chain/sdk` Reference

`@pepu-chain/sdk` supplies what viem does not know about Pepe Unchained V2 (chain 97741) and the infrastructure that makes the three pillars work: Google to wallet, session keys and sponsored transactions, plus their combination. It extends viem and never wraps or re-exports viem's own API. This page is the index: install, the subpath map, which subpath serves which pillar, peer dependencies and the server and client boundary. Each subpath has its own page.

> Status: version 0.2.2. All three pillars and the combination are proven on mainnet. The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`) are live and are the SDK defaults; sponsorship needs a project token in the ERC-7677 URL (`PEPU_PAYMASTER_URL` or `paymasterToken`). The v2 tiered paymaster is Proven on mainnet as a canary (deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches); the v1 paymaster is retired.

## Install

```sh
npm install @pepu-chain/sdk viem
```

`viem` (`^2.0.0`) is the only required peer dependency. Every other peer is optional and needed only by the subpaths that use it. The core entry never touches React, Privy or ZeroDev and runs in a plain Node script.

```ts
import { pepuMainnet, getPublicClient } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);
console.log(await client.getBlockNumber());
```

## Pillar-to-subpath decision table

| You want | Use | Page |
|---|---|---|
| Chain, contract registry, ABIs, gas, explorer links, Multicall3, Permit2, errors | `@pepu-chain/sdk` | [Core](core.md) |
| Google sign-in config, requirements table, dashboard check | `/privy` | [/privy](privy.md) |
| Provider, embedded-wallet hook, wallet gate (React, no wagmi) | `/privy/react` | [/privy/react](privy-react.md) |
| The same with wagmi | `/privy/wagmi` | [/privy/wagmi](privy-wagmi.md) |
| Ensure-wallet route, verify the Privy token | `/privy/server` | [/privy/server](privy-server.md) |
| Session keys, Privy mode (off-chain scope, user pays gas): routes, signer, hooks | `/session`, `/session/server`, `/session/react` | [/session](session.md) |
| Session keys, on-chain scope (Kernel permissions) | `/session/kernel` | [/session/kernel](session-kernel.md) |
| Sponsored transactions: bundler and paymaster clients, Kernel account, hooks | `/aa`, `/aa/kernel`, `/aa/react`, `/aa/react-direct` | [/aa](aa.md) |
| Paymaster REST client, v2 project helpers, denial mapping | `/paymaster`, `/paymaster/server` | [/paymaster](paymaster.md) |
| Google login plus on-chain session plus sponsored gas, ready-made routes and hook | `/combo`, `/combo/react` | [/combo](combo.md) |
| Project readiness checks, authorization key generator | `/doctor` | [/doctor](doctor.md) |
| Basic React hooks (balance, chain) | `/react` | [Core](core.md) |

The three pillars map to subpaths like this:

| Pillar | Client | Server |
|---|---|---|
| Google to wallet | `/privy/react` or `/privy/wagmi` | `/privy/server` |
| Session keys | `/session/react`, or `/session/kernel` with `/combo/react` | `/session/server`, or `/combo` |
| Sponsored transactions | `/aa/react`, `/aa/kernel` | `/aa`, `/paymaster` |
| All three | `/combo/react` | `/combo` |

Every export of every path is listed in the [Generated API Reference](api-reference.md). Error codes are in the [SDK Error Catalog](errors.md).

## Subpath map and peer dependencies

| Import path | Runs in | Required peers beyond `viem` |
|---|---|---|
| `@pepu-chain/sdk` | client or server | none |
| `/react` | client | `react` |
| `/privy` | client or server | none |
| `/privy/react` | client | `react`, `@privy-io/react-auth` |
| `/privy/wagmi` | client (ESM only) | `react`, `@privy-io/react-auth`, `@privy-io/wagmi`, `wagmi`, `@tanstack/react-query` |
| `/privy/server` | server only | `@privy-io/node` |
| `/session` | client or server | none |
| `/session/server` | server only | `@privy-io/node` |
| `/session/react` | client | `react`, `@privy-io/react-auth` |
| `/session/kernel` | mixed | `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator` |
| `/aa` | client or server | none |
| `/aa/kernel` | client or server | `@zerodev/sdk`, `@zerodev/ecdsa-validator` |
| `/aa/react` | client | `react`, `@privy-io/react-auth`, `permissionless` (no `@zerodev/*`) |
| `/aa/react-direct` | client | `react`, `@privy-io/react-auth`, `@zerodev/sdk`, `@zerodev/ecdsa-validator` |
| `/paymaster` | client or server | none |
| `/paymaster/server` | server only | none |
| `/combo` | server only | `@privy-io/node` and the three `@zerodev/*` packages |
| `/combo/react` | client | `react`, `@privy-io/react-auth` and the three `@zerodev/*` packages |
| `/server` | server only | none |
| `/doctor` | server or script | none |

Peer ranges: `viem ^2.0.0`, `react ^18 || ^19`, `@privy-io/react-auth ^3.44.0`, `@privy-io/node ^0.34.0`, `@privy-io/wagmi ^4.0.0`, `wagmi ^3.0.0`, `@tanstack/react-query ^5.0.0`, `@zerodev/sdk ^5.5.0`, `@zerodev/permissions ^5.6.0`, `@zerodev/ecdsa-validator ^5.4.0`. A test (`boundaries.test.ts`) enforces that each peer is imported only from its own subpaths, so a subpath you do not import never pulls its peers into your bundle.

## Install: peers per subpath

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

## Server and client boundary

Five entries are **server only**: `/privy/server`, `/session/server`, `/paymaster/server`, `/combo` and `/server`. Each calls `assertServerOnly()` at import and throws `CONFIG_SERVER_ONLY` if `window` exists, so a mistake in a client bundle fails loudly instead of shipping a module that sits next to secrets.

Rules that follow:

- The Privy app secret (`PRIVY_APP_SECRET`), the authorization key (`PRIVY_AUTHORIZATION_KEY`) and the paymaster claim attestation call exist only on the server and are never read from a `NEXT_PUBLIC_` variable.
- `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` are public by nature.
- `PEPU_PAYMASTER_URL` can embed a credential. Keep it server-side unless it holds a publishable client token (`ppt_`). A server key (`ppk_`) in a browser is refused with `CONFIG_SERVER_ONLY`.
- The Kernel session private key is created on the server (`generateSessionKey`) and never sent to the browser. The browser signs one owner message with `approveKernelSession` and sends back an approval that carries no secret.
- Never embed a private key in a browser bundle. Scripts read keys from the environment.

## Conventions

- Named exports only. There is no default export.
- Anything the SDK throws is a `PepuError` subclass with `code`, `hint`, `docsUrl`, `retryable` and `status`. See [Core](core.md#error-model).
- Mainnet only. `pepuTestnet` (97740) is a definition with no deployed contracts and is out of scope. Chain `3409` is the dead V1 chain.
- Hosted endpoint URLs live in one place, `src/endpoints.ts`. The hosted bundler and paymaster base are set there; the environment variables override them.

## Known gaps

- **The v2 paymaster is a canary.** It is deployed (`paymasterV2`, alias `paymaster`) but the external audit is pending, so deposit in small tranches. The combination (Google login + Kernel session key + sponsorship) is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster.
- **`v3Migrator` and `v3Staker` have verified addresses but no ABI** in the package.
- **The token list has two tokens**, WPEPU and USDT.
- **The deprecated `getSponsorshipStatus`** always reports unavailable. See [Migration Notes](migration.md).

## Related

- [Generated API Reference](api-reference.md)
- [SDK Error Catalog](errors.md)
- [Migration Notes](migration.md)
- [The Three Pillars and How They Combine](../get-started/pillars.md)
- [create-pepu-app CLI](../cli/create-pepu-app.md)
