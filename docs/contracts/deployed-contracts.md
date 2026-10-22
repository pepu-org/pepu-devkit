# Deployed Contracts Reference

The complete, current answer to "does standard contract X exist on Pepe Unchained V2, and where." Every address below is on **mainnet (chain `97741`)** unless stated otherwise — see [Network Reference](../get-started/network-reference.md#testnet-out-of-scope-today) for why testnet isn't covered here.

Check this page, not a canonical-address list you already have memorized, before hardcoding anything for PEPU. Multicall3 is live at an unusual address, and read the notes, not just the address column.

## Core infrastructure

| Contract | Address | Deployment | Notes |
|---|---|---|---|
| CREATE2 deterministic deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | **Deployed**, canonical address | Standard "Nick's method" deterministic deployer. Multicall3 and Permit2 were deployed through it. See [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md). |
| Multicall3 | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | **Deployed — NOT at the canonical address** | Read [The Multicall3 Trap](multicall3.md) before using this. The canonical address (`0xcA11bde05977b3631167028862bE2a173976CA11`) is structurally unreachable on this chain. This deployment was built from canonical `mds1/multicall3` source (solc `0.8.12`, optimizer `10,000,000` runs), deployed via the CREATE2 deterministic deployer above with a zero salt, and verified on pepuscan. Deployed in block 10521048. |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical) | **Deployed**, canonical address | Deployed via ordinary CREATE2 at the canonical address (9,152 bytes of bytecode). Deployment details: [Permit2](permit2.md) and `contracts/permit2/`. |

## ERC-4337 / smart accounts (mainnet only)

Deployed by ZeroDev's one-click Conduit Marketplace integration, plus the project-deployed paymaster. The complete table with byte counts and sources is the [Address Map](address-map.md); the roles are explained on [EntryPoints and Kernel](entrypoints-and-kernel.md).

| Contract | Address | Deployment | Notes |
|---|---|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | **Deployed**, canonical address | |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **Deployed**, canonical address | The version Kernel v3.x, the paymaster, the bundler and Privy target |
| Kernel v3 account factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | **Deployed** | The smart-account factory Privy lists as a selectable option |
| Kernel MetaFactory | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | **Deployed** | |
| Kernel v3.1 implementation | `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` | **Deployed** | What the factory resolves to |
| Kernel ECDSA validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | **Deployed** | Default root validator |
| Kernel ECDSA signer module | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` | **Deployed** | Signer in session-key permissions |
| Call policy v0.0.4 | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` | **Deployed** | Pinned; v0.0.5 is not deployed on PEPU |
| Timestamp policy | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | **Deployed** | Session-key validity window |
| Paymaster v2 (`PepuSponsoredPaymasterV7`) | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | **Deployed** | This project's own contract. In the registry as `paymaster` and `paymasterV2`. Free pool seeded with 300 PEPU. Deposits are one-way, so deposit only what your project needs. See [Paymaster v2 Spec Summary](paymaster-v2-spec.md) |
| Paymaster v1 (`PepuVerifyingPaymasterV7`) | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | **Retired** | Its EntryPoint deposit has been withdrawn (0), so it cannot sponsor anything. The bytecode still exists. Never deposit to it. In the registry as `paymasterV1` with `retired: true` |

**Hosting.** The bundler is at `https://bundler.pepeunchained.com` (`PEPU_BUNDLER_URL`) and the paymaster policy service at `https://paymaster.pepeunchained.com`; the ERC-7677 URL always embeds a token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`). A Kernel account holding 0 PEPU can transact through both, with the v2 paymaster paying the gas. See [Infrastructure Map](../infra/overview.md) and [Sponsored Transactions](../onboarding/sponsored-transactions.md).

## Demo / reference contracts

| Contract | Address | What it's for |
|---|---|---|
| TapScore | `0x261eA5971B93237a56990206A46Bc80318e4d078` | Minimal gameplay contract (`tap()`, no args, non-payable) used by the `game-app` template to demonstrate a scoped session signer calling one function repeatedly with no wallet popups, and by the `sponsored-demo` template as its sponsored call. Source verified on pepuscan. See [Session Keys](../onboarding/session-keys.md) and [Sponsored Transactions](../onboarding/sponsored-transactions.md). |

## Non-canonical addresses used by ecosystem apps — don't reuse these as generic infrastructure

Some first-party PEPU apps deployed their own small, purpose-built contracts that are easy to mistake for general infrastructure because of their name. They are **not** Multicall3- or Permit2-compatible and are not a substitute for the canonical registry above — they're sized for one app's own needs.

| Contract | Address | Belongs to | Why it's not a substitute |
|---|---|---|---|
| PepuSwap "multicall" | `0x927af2a6B76d2d8206d93004463F8C122701383B` | PepuSwap (the native DEX, a Uniswap V3 fork) | A small, non-canonical router-adjacent contract, not Multicall3-compatible. Don't wire it into a generic multicall config. |
| PepuSwap Permit2 | `0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B` | PepuSwap | PepuSwap's own Permit2 deployment, not the canonical Permit2. If a library assumes canonical Permit2 (most `permit2-sdk`-style tooling does), pointing it at this address will not behave the same way. |

## Tokens

| Token | Address | Chain | Notes |
|---|---|---|---|
| WPEPU (Wrapped Pepe Unchained) | `0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8` | Mainnet | Matches the `WETH9` source on Blockscout. See [`@pepu-chain/sdk`'s token list](../sdk/core.md#contract-and-dex-registries) — deliberately minimal. |
| USDT (Tether USD) | `0x06f69A40C33C5A4Cd038BBE1DA689D4D636Ec448` | Mainnet | 6 decimals. The non-WPEPU side of PepuSwap's WPEPU/USDT pool. Do not format it with 18 decimals. |
| USDC (USD Coin) | `0x20fB684Bfc1aBAaD3AceC5712f2Aa30bd494dF74` | Mainnet | 6 decimals. One of the tokens PepuSwap trades. `name()`, `symbol()` and `decimals()` return "USD Coin", "USDC" and 6. Do not format it with 18 decimals. |
| WETH (Wrapped Ether) | `0x7CCC51754216C04D4Bb1210630cCA16e5430Aa70` | Mainnet | 18 decimals. One of the tokens PepuSwap trades. `name()`, `symbol()` and `decimals()` return "Wrapped Ether", "WETH" and 18. |

To re-check every registry entry on chain, run `pnpm --filter @pepu-chain/sdk live-check`.

## Where this table comes from

Every address above is also encoded in [`@pepu-chain/sdk`'s contract registry](../sdk/core.md#contract-and-dex-registries) (`getContract`, `listContracts`, `isDeployed`), which is the machine-readable version of this page — use it in code instead of copy-pasting addresses out of Markdown. A registry entry that is not deployed has no `.address` field, so code that reads the registry cannot treat an undeployed contract as real.

If you find infrastructure not listed here on PEPU, check it directly (`eth_getCode`, or `pepu_verify_contract_status` if you have the [PEPU MCP server](../agent-tooling/mcp-and-skills.md) connected) before relying on it.

