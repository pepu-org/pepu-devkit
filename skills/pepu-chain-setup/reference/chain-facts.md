<!-- COPY of skills/_shared/chain-facts.md, synced by scripts/sync-skill-shared.mjs. Do not edit here: edit the source and re-run the script. -->

# PEPU chain facts

Pepe Unchained V2, **mainnet only**. The testnet (97740) is out of scope: do not target it, do not add it to a chain list.
Always prefer the live answer: call the MCP tool `pepu_chain_info`, or read these from the SDK
(`pepuMainnet`, `getPepuAddresses()`, `resolvePepuEndpoints()` from `@pepu-chain/sdk`).

## Network

| | |
|---|---|
| Chain ID | `97741` (`0x17dcd`) |
| Name | Pepe Unchained V2 |
| Native token | PEPU, 18 decimals (also pays gas) |
| Default RPC | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` (override with `PEPU_RPC_URL`) |
| Explorer | PepuScan: `https://pepuscan.com` (Blockscout), API `https://pepuscan.com/api` |
| Stack | Arbitrum Nitro (ArbOS 51) Orbit chain hosted by Conduit, settling to Ethereum L1 through AnyTrust |
| P256 precompile (RIP-7212) | live at `0x0000000000000000000000000000000000000100` (cheap passkey verification) |
| viem chain object | `pepuMainnet` from `@pepu-chain/sdk`. wagmi: `pepuWagmiConfig()` from `@pepu-chain/sdk/privy/wagmi` |

## Multicall3 is NOT at the canonical address

The canonical Multicall3 address `0xcA11bde05977b3631167028862bE2a173976CA11` has no code on PEPU and never will (its pre-signed
deploy transaction caps gas at 1M, Nitro needs about 14.3M). PEPU's Multicall3 is
`0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` (mainnet only, `pepuMainnet.contracts.multicall3`). Batched reads must go
through `pepuMulticall(client, calls)` from `@pepu-chain/sdk`, or a viem client whose chain is `pepuMainnet`. Never
paste the canonical address anywhere.

## Contracts (from `getPepuAddresses()`)

| Registry key | Contract | Status | Address | Note |
|---|---|---|---|---|
| `create2Factory` | CREATE2 Deterministic Deployer | deployed | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | Standard Nick's-method deterministic deployer. |
| `multicall3` | Multicall3 | deployed | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | PEPU-specific deployment. NOT at the canonical Multicall3 address, which is unreachable on this Nitro chain (the canonical pre-signed CREATE tx carries a 1,000,000 gas limit; this bytecode needs ~14.3M). Deployed from canonical mds1/multicall3 source (solc 0.8.12, optimizer 10,000,000 runs) via the CREATE2 deterministic deployer with a zero salt, so the same source reproduces this address on any chain that has that deployer. Verified on pepuscan. viem/wagmi multicall confirmed working against it. |
| `permit2` | Permit2 | deployed | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Deployed at the canonical Permit2 address via the CREATE2 deterministic deployer, same as on every other chain that has it. Verified live 2026-09-24 via eth_getCode (9,152 bytes, matching Permit2's known bytecode size) plus a successful DOMAIN_SEPARATOR() eth_call. This is the canonical Permit2 — do not confuse it with PepuSwap's own separate Permit2 deployment at pepuSwapContracts.permit2NonCanonical in ./dex.js, which predates this one and is not interchangeable with it. |
| `entryPoint06` | ERC-4337 EntryPoint v0.6 | deployed | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). At the canonical v0.6 address. |
| `entryPoint07` | ERC-4337 EntryPoint v0.7 | deployed | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). At the canonical v0.7 address; getNonce/balanceOf confirmed live. |
| `kernelFactory` | Kernel v3 Account Factory | deployed | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). |
| `kernelMetaFactory` | Kernel MetaFactory | deployed | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). |
| `ecdsaValidator` | Kernel ECDSA Validator | deployed | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). |
| `paymaster` | Sponsored Paymaster v2 (PepuSponsoredPaymasterV7, alias of paymasterV2) | deployed | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | Alias of `paymasterV2`: the tiered PepuSponsoredPaymasterV7 canary (0xdb28...C30D), deployed around block 10537341 and funded in small tranches. Internally reviewed 3x, external audit pending. Owner 0x5966dFaB11c8AEe767e0739083417D02f4a634A1, manager 0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0. The free pool was seeded with 300 PEPU; free-tier destinations are TapScore only for now. It sponsors only through the hosted policy service (paymaster.pepeunchained.com) with the hosted bundler (bundler.pepeunchained.com). The v1 paymaster is retired (see `paymasterV1`). |
| `kernelImplementation` | Kernel v3.1 Implementation | deployed | `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). Kernel v3.1 implementation that kernelFactory.implementation() resolves to; same address ZeroDev uses on every chain with this version. |
| `kernelEcdsaSignerModule` | Kernel ECDSA Signer (permission signer module) | deployed | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). Used as the signer in permission-validator session keys. |
| `kernelCallPolicyV004` | ZeroDev Call Policy v0.0.4 | deployed | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). Scopes a session key to specific targets and selectors. |
| `kernelTimestampPolicy` | ZeroDev Timestamp Policy | deployed | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | Deployed by ZeroDev's one-click Conduit Marketplace integration (mainnet only — not present on testnet). Bounds a session key to a validity window. |
| `tapScore` | TapScore | deployed | `0x261eA5971B93237a56990206A46Bc80318e4d078` | TapScore demo contract used by the game-app template. Verified via eth_getCode. |
| `paymasterV1` | Verifying Paymaster v1 (PepuVerifyingPaymasterV7) - RETIRED | deployed | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | RETIRED. The project's first verifying paymaster (PepuVerifyingPaymasterV7). Its EntryPoint deposit was withdrawn (deposit is 0), so it cannot sponsor anything. The contract still has bytecode; do not deposit to it or route new work to it. Superseded by `paymasterV2`. A real sponsored operation ran through the hosted URLs on v1 before retirement (tx 0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f). |
| `paymasterV2` | Sponsored Paymaster v2 (PepuSponsoredPaymasterV7), canary | deployed | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | PepuSponsoredPaymasterV7 (v2), deployed on PEPU mainnet as a canary around block 10537341: internally reviewed 3x, external audit pending, funded in small tranches. Owner 0x5966dFaB11c8AEe767e0739083417D02f4a634A1, manager 0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0. Free pool seeded with 300 PEPU; free-tier destinations are TapScore only for now. Free tier per user is 100 PEPU/day and 50 PEPU/hour, enforced by the policy service; beyond that a dApp deposits into its own project. Record: services/paymaster/contracts/deployed-address-v2.txt. |

`paymaster` is an alias of `paymasterV2`: the tiered PepuSponsoredPaymasterV7, deployed as a **canary** (internally reviewed 3 times, external audit pending, funded in small tranches). `paymasterV1` is **retired**: its deposit is 0 and it cannot sponsor anything, so never deposit to it or route work to it.

## Gas, in one paragraph

Nitro charges a dual fee: an L2 execution component and an L1 data-posting component, folded into one gas price. The base
fee is high in gwei terms (about 12,500 gwei) but a plain transfer still costs a small fraction of a cent. A high gas price is not an error.
Privy's own pre-flight balance check is over-conservative at this base fee and can refuse a send the wallet can afford, so the
PEPU templates have no "Max" button. For other wallet UIs size a max send with `maxSendableAmount()` and show costs with
`estimateTransactionCost()` and `formatPepu()` from `@pepu-chain/sdk`. Gas is never "free" unless a paymaster
actually paid it (see `pepu_sponsorship_status`).

## Account abstraction and sponsorship endpoints

- EntryPoint v0.7 (`entryPoint07`) and the Kernel v3.1 stack are deployed (table above). Use `getPepuKernelStack(97741)`.
- Bundler and paymaster are configured by URL: `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` (server) or
  `NEXT_PUBLIC_PEPU_BUNDLER_URL` / `NEXT_PUBLIC_PEPU_PAYMASTER_URL` (browser). Resolution order:
  explicit option, env, hosted default.
- Hosted PEPU endpoints: **live**. The bundler is `https://bundler.pepeunchained.com` (the SDK default for `PEPU_BUNDLER_URL`). The paymaster service is `https://paymaster.pepeunchained.com` (the SDK default base for `createPaymasterApi`, probes and the doctor). The ERC-7677 URL always embeds a token, `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, so set `PEPU_PAYMASTER_URL` to it (or build it with `buildErc7677Url` / `hostedErc7677Url`). A project client token (`ppt_`) works only from the project's allowed origins (otherwise `project_origin_not_allowed`), server code uses the project server key (`ppk_`), and the free tier needs a verified Privy access token from PEPU's own Privy app in the ERC-7677 context (100 PEPU/day and 50 PEPU/hour per user, TapScore only for now). Local development defaults used by the PEPU services are `http://localhost:4337` (bundler) and `http://localhost:8788` (paymaster).
- Never hard-code "sponsorship works" or "sponsorship does not work". Run `pepu_sponsorship_status` (or `checkSponsorship()` from
  `@pepu-chain/sdk`) and report what it says.
- A paymaster URL embeds a credential: treat it as a secret and keep it server-side.

## Where to look things up

| Need | Use |
|---|---|
| Any address | `getPepuAddresses()` or `getContract(name, chainId)` (SDK), `pepu_chain_info` (MCP) |
| Does this address have code | `pepu_check_contract_deployed` |
| Explorer link | `explorerLinks({ tx, address, token, block })` |
| A failure | `explainError(e)` (SDK), `pepu_explain_error` (MCP) |
