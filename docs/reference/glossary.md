# Glossary

Terms used across the PEPU docs, alphabetical.

> Status: reference.

| Term | Meaning |
|---|---|
| Alto | The open-source ERC-4337 bundler PEPU hosts at `bundler.pepeunchained.com`, configured with `--chain-type arbitrum`. |
| Approval | The owner's enable signature plus policy parameters for a Kernel session. Holds no secret. |
| Authorization key | A P-256 key whose public half is registered in Privy; the server signs signing requests with the private half. See [Authorization Keys](../privy/authorization-keys.md). |
| Bundler | A service that accepts UserOperations and submits them through the EntryPoint. |
| Call policy | A ZeroDev policy contract limiting a session to listed targets, selectors and value. PEPU has v0.0.4. |
| Chain ID | `97741` for mainnet. `3409` is the dead V1 chain. |
| Client token | A project's publishable paymaster credential (`ppt_`). Works only from the project's allowed origins. Used in the Privy Smart Wallets dashboard URL. See [Credential Matrix](../infra/paymaster/auth.md). |
| Combination | Google login plus one on-chain session plus sponsorship. See [End to End](../onboarding/google-session-sponsored.md). |
| Embedded wallet | The EOA Privy creates for a user at login. |
| EntryPoint | The ERC-4337 singleton. v0.7 is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. |
| `eoaOnly` | The Coinbase Wallet preference that avoids Coinbase Smart Wallet, which does not support chain 97741. |
| ERC-4337 | Account abstraction through UserOperations, bundlers and paymasters. |
| ERC-7677 | The paymaster JSON-RPC interface: `pm_getPaymasterStubData`, `pm_getPaymasterData`. |
| Free tier | v2: 100 PEPU per Privy user per day and 50 PEPU per hour, funded by the chain, for PEPU's own Privy app only. Deployed as a canary. |
| Kernel | ZeroDev's smart account. PEPU uses v3.1. |
| Key quorum | A group of authorization keys Privy accepts as a signer; its id is `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. |
| Multicall3 | Batch-read contract. PEPU's is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, not the canonical address. See [The Multicall3 Trap](../contracts/multicall3.md). |
| Owner | The embedded wallet that controls a Kernel account. Also, the owner of a v2 paymaster project. |
| Paymaster | A contract plus policy service that pays UserOperation gas. v2 (canary) is `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`; v1 `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` is retired. |
| Permission id | The id the chain derives for a session key plus policies; the server compares it with the approval. |
| Permit2 | Uniswap's token approval contract, at the canonical address on PEPU. |
| Policy (Privy) | A Privy rule set attached to a session signer; names at most 49 characters. |
| Policy service | The off-chain ERC-7677 service deciding sponsorship. |
| Privy Smart Wallets | Privy's dashboard feature that builds and manages a Kernel account for the embedded wallet and sends from the browser. Path 2. Needs the Smart Wallets dashboard setting. |
| Project (v2) | A paymaster budget keyed by `keccak256(bytes(appId))`. |
| Server key | A project's secret paymaster credential (`ppk_`), for backends, scripts and the session routes. Never in a browser. |
| Session key | A key allowed to act within limits without a popup. Privy mode or Kernel mode. |
| Session signer | Privy's delegated-actions mechanism on an embedded wallet. |
| SessionStore | The SDK interface storing Kernel session records. `createMemoryStore()` is dev-grade. |
| Smart account | A contract account. Here, a Kernel account with a different address from its owner. See [Two-Address Model](../onboarding/two-address-model.md). |
| Smart account paths | Path 0 plain embedded wallet, Path 1 ZeroDev-native (the SDK builds the Kernel account), Path 2 Privy Smart Wallets (Privy builds it). See [Smart Account Paths](../concepts/smart-account-paths.md). |
| TEE execution | Privy's `user-controlled-server-wallets-only` mode, reassembling keys in an enclave. |
| Timestamp policy | A ZeroDev policy limiting a permission to a validity window. |
| UserOperation | The ERC-4337 transaction-like object a smart account sends. |
| WalletGate | SDK component that renders children once the embedded wallet exists, provisioning it first. |

## Related

- [FAQ](faq.md)
- [The Three Pillars](../get-started/pillars.md)
- [Smart Account Paths](../concepts/smart-account-paths.md)
