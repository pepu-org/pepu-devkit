# Address Map

Every contract address in the SDK registry for Pepe Unchained V2 mainnet (chain `97741`), with a source and a do-not-substitute note for each. Use this as the one table to copy from. In code, read the registry instead of pasting: `getContract`, `listContracts`, `getPepuAddresses` (an array of rows; `getPepuAddressMap` returns the same rows keyed by name) and `isDeployed` from `@pepu-chain/sdk`.

Mainnet only; the testnet (97740) is not supported. `pnpm --filter @pepu-chain/sdk live-check` re-checks every address below with `eth_getCode`. The v1 paymaster is retired.

## Verify an address

1. Run `pnpm --filter @pepu-chain/sdk live-check` from the repository root. It calls `eth_getCode` on each registry address and prints the byte count; it also confirms the canonical Multicall3 address has no code.
2. By hand, `cast code <address> --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`, or the MCP tool `pepu_check_contract_deployed`.
3. Deployed code does not by itself confirm behavior; see the notes for each entry.

## Core infrastructure

| Name | Address | Bytes | Source | Notes |
|---|---|---|---|---|
| CREATE2 deterministic deployer (`create2Factory`) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | 69 | Canonical Nick's-method deployer | Used to deploy Multicall3 and Permit2. See [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md) |
| Multicall3 (`multicall3`) | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | 3808 | PEPU-specific deployment from `mds1/multicall3` source via CREATE2, zero salt | **Not the canonical address.** `0xcA11bde05977b3631167028862bE2a173976CA11` has no code here and never can. See [The Multicall3 Trap](multicall3.md) |
| Permit2 (`permit2`) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9152 | Canonical Uniswap Permit2, deployed by PEPU via CREATE2 | Canonical address. Not PepuSwap's copy. See [Permit2](permit2.md) |

## ERC-4337 and Kernel (ZeroDev Conduit Marketplace integration)

| Name | Address | Bytes | Source | Notes |
|---|---|---|---|---|
| EntryPoint v0.6 (`entryPoint06`) | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | 23689 | ZeroDev, at the canonical v0.6 address | Served by the bundler; not used by Kernel v3.1 |
| EntryPoint v0.7 (`entryPoint07`) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | 16035 | ZeroDev, at the canonical v0.7 address | The version Kernel v3.x, the paymaster and Privy target |
| Kernel v3 factory (`kernelFactory`) | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | 989 | ZeroDev | Account factory; `getAddress` gives the counterfactual address |
| Kernel MetaFactory (`kernelMetaFactory`) | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | 1871 | ZeroDev | |
| Kernel v3.1 implementation (`kernelImplementation`) | `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` | 22784 | ZeroDev | What `kernelFactory.implementation()` resolves to; same address ZeroDev uses on every chain with this version |
| Kernel ECDSA validator (`ecdsaValidator`) | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | 1819 | ZeroDev | Default validator: an ECDSA key (for example a Privy embedded wallet) authorises the account |
| Kernel ECDSA signer module (`kernelEcdsaSignerModule`) | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` | 1609 | ZeroDev | Signer in permission-validator session keys |
| Call policy v0.0.4 (`kernelCallPolicyV004`) | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` | 6539 | ZeroDev | Scopes a session key to targets and selectors. **Use v0.0.4, not v0.0.5**: v0.0.5 is not deployed on PEPU, so the SDK pins `CallPolicyVersion.V0_0_4` |
| Timestamp policy (`kernelTimestampPolicy`) | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | 1441 | ZeroDev | Bounds a session key to a validity window |

## Paymaster and demo

| Name | Address | Bytes | Source | Notes |
|---|---|---|---|---|
| Paymaster v2 (`paymaster` and `paymasterV2`, same contract) | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | 23722 | This project: `PepuSponsoredPaymasterV7` | **Deployed** (about block 10537341). Owner and manager are separate addresses (`0x5966…4A1` and `0x063A…aBb0`). Free pool seeded with 300 PEPU. Deposits are one-way, so deposit only what your project needs. See [Paymaster Overview](../infra/paymaster/overview.md) |
| Paymaster v1 (`paymasterV1`) | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | 8842 | This project: `PepuVerifyingPaymasterV7` | **Retired.** Its EntryPoint deposit has been withdrawn (0), so it cannot sponsor anything. The bytecode still exists. Never deposit to it |
| TapScore (`tapScore`) | `0x261eA5971B93237a56990206A46Bc80318e4d078` | 587 | This project: demo contract | `tap()` with no arguments, non-payable. Used by the `game-app` and `sponsored-demo` templates |

## PepuSwap (third party)

PepuSwap is not in `pepuContracts`; it has its own registry (`getPepuSwapContract`, `listPepuSwapContracts`). Its addresses, including the **non-canonical** multicall and Permit2 that must not replace the ones above, are on [PepuSwap Addresses](pepuswap.md).

## Canonical versus PEPU-specific

| Contract | Canonical address used on PEPU? |
|---|---|
| CREATE2 deployer | Yes |
| Permit2 | Yes |
| EntryPoint v0.6 and v0.7 | Yes |
| Multicall3 | **No.** PEPU-specific at `0x9CE19273…01bd` |
| Kernel contracts | ZeroDev's standard addresses for these versions (no canonical-address trick; use the registry) |
| Paymaster, TapScore | Project-specific |

## Do-not-substitute checklist

- Never use `0xcA11bde05977b3631167028862bE2a173976CA11` as Multicall3 on PEPU. `assertNotCanonicalMulticall3` throws `MULTICALL3_CANONICAL_ADDRESS`.
- Never use PepuSwap's `0xB461…8b4B` as Permit2 or its `0x927a…383B` as Multicall3.
- Never use call policy v0.0.5.

## Related

- [Deployed Contracts Reference](deployed-contracts.md)
- [EntryPoints and Kernel](entrypoints-and-kernel.md)
- [Infrastructure Map](../infra/overview.md)
- [Network Reference](../get-started/network-reference.md)
