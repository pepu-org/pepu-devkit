# EntryPoints and Kernel

The ERC-4337 contracts on PEPU mainnet: EntryPoint v0.6 and v0.7, the ZeroDev Kernel v3.1 account stack (factory, meta-factory, implementation, ECDSA validator and signer) and the session-key policies, with the ABIs the SDK ships. Read it to know which address does what and which versions to pin.

These contracts were deployed by ZeroDev's one-click Conduit Marketplace integration; mainnet only. `pnpm --filter @pepu-chain/sdk live-check` re-checks every address with `eth_getCode`. See [Infrastructure Map](../infra/overview.md).

## EntryPoints

| Version | Address | Bytes | Use |
|---|---|---|---|
| v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | 16035 | Kernel v3.x, the PEPU paymaster, Privy's smart-wallet integration. Use this one |
| v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | 23689 | Deployed and served by the bundler; nothing in the dev kit targets it |

Both are at the canonical addresses. The paymaster, the bundler and the policy service all use v0.7. The SDK ships `entryPointV07Abi` (from `@pepu-chain/sdk`); the paymaster deposit is read through it (`getPaymasterDeposit` in `@pepu-chain/sdk/aa`).

## Kernel account stack

| Component | Address | Role |
|---|---|---|
| Kernel v3 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | Creates accounts; `getAddress(...)` returns the counterfactual address, so never re-implement the CREATE2 hash |
| Kernel MetaFactory | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | Factory of factories |
| Kernel v3.1 implementation | `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` | What the factory's `implementation()` resolves to; accounts are proxies to it |
| Kernel ECDSA validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | Default root validator: one ECDSA key (for example a Privy embedded wallet) authorises the account |
| Kernel ECDSA signer module | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` | Signer used inside permission-validator session keys |

The SDK pins Kernel v3.1 (`KERNEL_VERSION` in `@pepu-chain/sdk/aa/kernel`). Accounts are deployed on the user's first UserOperation (the operation carries `factory` and `factoryData`), which is why a first transaction costs about 12 PEPU worst case against about 3 PEPU afterwards.

## Session-key policies

| Policy | Address | What it enforces |
|---|---|---|
| Call policy **v0.0.4** | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` | Only the listed targets and selectors, with a native value no larger than the limit (default 0) |
| Timestamp policy | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | The permission is invalid outside `validAfter` to `validUntil` |

**Why v0.0.4, not v0.0.5.** ZeroDev's call policy v0.0.5 is not deployed on PEPU. The SDK pins `CallPolicyVersion.V0_0_4` and exports the address as `CALL_POLICY_V0_0_4_ADDRESS` (and `TIMESTAMP_POLICY_ADDRESS`) from `@pepu-chain/sdk/session/kernel`. An out-of-scope UserOperation is rejected by the EntryPoint itself, whoever relays it. Do not configure a newer policy version or a client default that selects v0.0.5; it will point at an address with no code. See [Session Keys](../onboarding/session-keys.md).

## ABIs in the SDK

| Export | Covers |
|---|---|
| `entryPointV07Abi` | EntryPoint v0.7 |
| `kernelFactoryAbi`, `kernelEcdsaValidatorAbi` | Kernel factory and validator. `KERNEL_V3_1_IMPLEMENTATION_ADDRESS` and `ERC7579_MODULE_TYPE` are exported alongside |
| `multicall3Abi`, `permit2Abi` | The two infrastructure contracts, [Multicall3](multicall3.md) and [Permit2](permit2.md) |
| `pepuSponsoredPaymasterV2Abi` (from `/paymaster`) | The v2 paymaster |

Registry access: `getContract(97741, "entryPoint07")`, `getContract(97741, "kernelFactory")` and so on; `isDeployed` narrows the type so an undeployed entry can never be read as an address. Names: `entryPoint06`, `entryPoint07`, `kernelFactory`, `kernelMetaFactory`, `kernelImplementation`, `ecdsaValidator`, `kernelEcdsaSignerModule`, `kernelCallPolicyV004`, `kernelTimestampPolicy`.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Session key setup reverts or the policy has no code | A client defaulted to call policy v0.0.5 | Pin v0.0.4 |
| Counterfactual address differs from the deployed one | Different Kernel version, validator or index | Use the factory's `getAddress` with the SDK's pinned version |
| Operation rejected during account creation | Wrong factory or init data | Build the account with `toPepuKernelAccount` / `getKernelAddress` from `@pepu-chain/sdk/aa/kernel` |
| Bundler says EntryPoint unsupported | Sent v0.6 | Use v0.7 |

## Related

- [Address Map](address-map.md)
- [/aa](../sdk/aa.md), [/session/kernel](../sdk/session-kernel.md)
- [Smart Accounts](../onboarding/smart-accounts.md)
- [Bundler Overview](../infra/bundler/overview.md)
