# Security Reviews

How each PEPU contract was reviewed, which contracts are upstream code, and how to report a vulnerability.

## Contracts

| Contract | Address | Provenance | Reviews and tests |
|---|---|---|---|
| Paymaster v2 `PepuSponsoredPaymasterV7` | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | Authored by PEPU. Source in `services/paymaster/contracts` | Three internal reviews (below). 195 Foundry tests (unit, fuzz, six invariants, a harness on the real EntryPoint v0.7 sources, reentrancy and cross-language vectors) and 328 policy-service tests |
| Paymaster v1 `PepuVerifyingPaymasterV7` | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | Authored by PEPU; a fork of Pimlico's singleton paymaster with ERC-20 mode removed. Retired: its EntryPoint deposit was withdrawn and it cannot sponsor anything | 18 Foundry tests |
| Multicall3 | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | Built from canonical `mds1/multicall3` source with canonical settings; source verified on pepuscan | Upstream code, no PEPU changes |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Exact upstream creation bytecode, deployed at the canonical address | Upstream code, no PEPU changes |
| EntryPoint v0.6 and v0.7, Kernel v3.1, validator, signer, call and timestamp policies | See [Address Map](address-map.md) | ZeroDev deployments through Conduit Marketplace | ZeroDev's own audits apply to the upstream code. Call policy v0.0.4 is used because v0.0.5 is not deployed on PEPU |
| TapScore | `0x261eA5971B93237a56990206A46Bc80318e4d078` | Demo contract used by the templates | For demonstration only; do not use it to hold value |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | Standard deterministic deployer | Widely used upstream |

"Source verified" means the source is published on pepuscan or reproducible from the repository. `pnpm --filter @pepu-chain/sdk live-check` confirms that bytecode exists at each registry address.

## Internal reviews of the v2 paymaster

The review reports are in `services/paymaster/audits/`. Each file begins with a table of findings and their resolution.

| Report | Scope |
|---|---|
| `2026-10-internal-review.md` | Commit `dafc259`: the contract, its EntryPoint interaction, the deploy script and the signing service. Includes a harness built on the real EntryPoint v0.7 sources. |
| `2026-10-delta-review.md` | The deposit-only and attested-claim changes (`f55527f..c354508`). |
| `2026-10-review-3.md` | Commit `4882bd3`, reviewed along three axes: economics and accounting; access control and governance; ERC-4337 conformance and the signer service. All on the real EntryPoint v0.7. |

The reviews follow the [pashov](https://github.com/pashov/skills) `solidity-auditor` methodology. They are internal and do not replace an independent audit.

## Design notes

- The v2 contract is immutable and holds project deposits. Deposits are one-way and cannot be withdrawn, so deposit only what your project needs.
- The `tx.origin` bundler gate in v2 requires a self-run bundler with safe mode off. The hosted bundler is configured accordingly.
- The contract size margin is 854 bytes at 8,000 optimizer runs. Any change to the contract needs a size re-check.
- The harness uses vendored EntryPoint sources on a local EVM. The 18,000-gas post-op floor is a design value, not a measurement from the PEPU chain's gas schedule.

## Report a vulnerability

Do not open a public issue for a vulnerability. Follow [SECURITY.md](../../SECURITY.md): email contact@pepeunchained.com with a description, reproduction steps, the affected package or file and whether it touches deployed contracts. The policy covers this repository's code (the paymaster contracts and services live here too; if in doubt, send it). It does not cover the chain, Conduit, pepuscan or third-party contracts such as Kernel.

## Related

- [Paymaster v2 Spec Summary](paymaster-v2-spec.md)
- [PepuSponsoredPaymasterV7 Contract](../infra/paymaster/contracts.md)
- [Address Map](address-map.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
