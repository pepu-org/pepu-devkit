# Smart Accounts

Pepe Unchained V2 has an ERC-4337 foundation deployed on mainnet: both EntryPoint versions, a ZeroDev Kernel v3 smart-account factory, and a v2 sponsored paymaster contract (a canary). Smart accounts are possible here, and sponsorship is proven working on top of them through PEPU's hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`). Keep the two claims separate: an account existing is not the same as gas being sponsored for it.

Terms used on this page: [UserOperation](../reference/glossary.md), [bundler](../reference/glossary.md), [paymaster](../reference/glossary.md), [EntryPoint](../reference/glossary.md), [Kernel](../reference/glossary.md). All are defined in the [Glossary](../reference/glossary.md). Which smart-account setup to use: [Smart Account Paths](../concepts/smart-account-paths.md).

## What is live (mainnet only)

Deployed via ZeroDev's one-click Conduit Marketplace integration, plus a project-deployed paymaster:

| Contract | Address |
|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Kernel v3 account factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` |
| Kernel MetaFactory | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` |
| Kernel ECDSA validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` |
| Sponsored paymaster v2 (canary) | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` |
| Verifying paymaster v1 (retired) | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` |

Both EntryPoints are at their canonical addresses and the Kernel contracts are ZeroDev's standard v3 deployment. The v2 paymaster is this project's own contract, deployed on 2026-10-14 as a canary: internally reviewed 3x, external audit pending, funded in small tranches. The v1 paymaster was funded earlier and has since been withdrawn (its EntryPoint deposit is 0), so it cannot sponsor anything; never deposit to it. See [Deployed Contracts](../contracts/deployed-contracts.md) for the full table.

None of it is deployed on testnet. Testnet is out of scope for development; see [Network Reference](../get-started/network-reference.md#testnet-out-of-scope-today).

## What you can do today

- **Deploy and control a Kernel v3 smart account.** The factory and its ECDSA validator are live, so an account owned by an embedded wallet's key can be created at its counterfactual address and used. Without a paymaster it pays its own gas, exactly like an EOA.
- **Compute an account's address ahead of time**, from the factory's own on-chain `getAddress`, with [`@pepu-chain/sdk`](../sdk/aa.md) (`getKernelAccountAddress`) or the `pepu_smart_account_info` tool in the [MCP server](../agent-tooling/mcp-and-skills.md).
- **Inspect and verify the infrastructure.** The contracts are verified on pepuscan.

A smart account is a separate address from the embedded wallet that owns it. Read [The Two-Address Model](two-address-model.md) before you build UI around one.

## Sponsorship: proven and hosted

The full account of what is proven and what is missing is on [Sponsored Transactions](sponsored-transactions.md). The short version:

- **Proven:** a zero-balance Kernel smart account sent a transaction on mainnet and the paymaster paid for it, from a real Privy login, through the hosted [Alto](https://github.com/pimlicolabs/alto) bundler and ERC-7677 policy service (a project-sponsored operation from a fresh account holding 0 PEPU, paymaster paid 5.00 PEPU including account deployment).
- **Hosted URLs:** bundler `https://bundler.pepeunchained.com`, paymaster service `https://paymaster.pepeunchained.com`; the ERC-7677 URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`. SDKs built around "construct a UserOperation, hand it to a bundler client" (permissionless.js, ZeroDev, Pimlico) can point at the bundler. The chain's standard RPC endpoints do not implement the ERC-4337 bundler methods.
- **You must bring a project:** the free tier needs a verified Privy token from PEPU's own Privy app and is not available to third-party apps. Your app claims a project, sets targets and limits, deposits and gets a token. See [Sponsorship Tiers](sponsorship-tiers.md).

The v2 paymaster is a canary with the external audit pending: deposit small amounts.

## The manual path, and when it makes sense

`EntryPoint.handleOps()` is an ordinary public function. A determined developer can construct a UserOperation by hand, sign it with a Kernel account's owner key, and submit it in a plain transaction from any funded EOA, acting as a single-operation bundler. It is a valid use of the deployed contracts and exercises a Kernel account without a hosted bundler.

It is also low-level and easy to get wrong (UserOperation hashing, gas-limit packing and signature encoding must match the EntryPoint's expectations exactly), and the submitting EOA pays real gas, with no sponsorship shortcut. Treat it as a way to validate the infrastructure or build tooling on it, not a path for a typical app. For popup-free interaction, use [Session Keys](session-keys.md), which works on a plain embedded wallet.

## What remains

- The external audit of the v2 paymaster (the canary is internally reviewed 3x).

The contracts and the hosted services are live; the end-to-end flow has been proven.

## Related

- [Sponsored Transactions](sponsored-transactions.md)
- [The Two-Address Model](two-address-model.md)
- [Session Keys](session-keys.md)
- [Privy Setup](privy-setup.md)
- [Deployed Contracts](../contracts/deployed-contracts.md)
- [EntryPoints and Kernel](../contracts/entrypoints-and-kernel.md)
- [Sponsored Session](sponsored-session.md): Kernel session keys on this stack

