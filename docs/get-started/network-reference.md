# Network Reference

Copy-pasteable network parameters for Pepe Unchained V2. If you landed here from a search engine or an AI assistant and haven't confirmed you're looking at V2 (not the dead V1 chain, ID `3409`), read [V1 vs V2](v1-vs-v2.md) first.

## Mainnet

Build here. Every guide in this docs set targets mainnet by default — see "Testnet: out of scope today" below for why.

| Parameter | Value |
|---|---|
| Chain ID | `97741` (`0x17dcd`) |
| Network name | Pepe Unchained V2 |
| RPC URL | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` |
| Currency symbol | PEPU (18 decimals) |
| Block explorer | `https://pepuscan.com` (Blockscout, fully indexed) |
| Contract verification | `https://pepuscan.com/api` (Blockscout verifier — see [Deploy & Verify a Contract](../contracts/deployment.md)) |

### Authenticated RPC

The RPC URL above is public and rate-limited, and gates `debug_*`/`trace_*` methods (`-32401`). Conduit also issues an **authenticated RPC URL** in the form `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/<API_KEY>` for anyone with a Conduit API key. The authenticated endpoint exposes `debug_traceCall` and `eth_simulateV1` in addition to standard JSON-RPC — useful for local simulation, safer contract-verification tooling, and anything that needs to trace a call before submitting it. There is no public self-serve signup for a key documented here; if you need one, ask whoever operates your Conduit relationship.

## Testnet: out of scope today

Testnet (chain `97740`) is a real, live chain, but there is nothing to build against on it today:

| Parameter | Value |
|---|---|
| Chain ID | `97740` (`0x17dcc`) |
| Network name | Pepe Unchained V2 Testnet |
| RPC URL | `https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` |
| Currency symbol | PEPU (18 decimals) |
| Block explorer | **None indexed.** `explorer-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` is Conduit's default, non-Blockscout UI, which self-reports no indexer — it can show a single block or transaction by hash and nothing else. No `pepuscan.com`-equivalent Blockscout instance is registered for chain `97740` (confirmed against Blockscout's own public chain registry). |
| Faucet | **None exists.** There is no documented, self-serve way to obtain testnet PEPU. |
| Contracts | **None of the infrastructure on this page is deployed on testnet** — no Multicall3, no Permit2, no ERC-4337 EntryPoint, no Kernel smart-account factory. Everything below this section is mainnet-only unless stated otherwise. |

**Route everyone to mainnet.** With no faucet, no indexed explorer, and no deployed infrastructure, testnet cannot support a real development workflow today — and it doesn't need to: a transaction on PEPU mainnet costs a fraction of a cent. Every quickstart, recipe, and template in this docs set defaults to mainnet for exactly this reason. If testnet gains a faucet and an indexed explorer later, this page will say so plainly — until then, don't spend time trying to make testnet work.

## Sponsorship endpoints

Gas sponsorship needs a bundler and a paymaster. PEPU hosts both, and the SDK uses them by default.

| Service | Variable (override) | Local development default | Hosted (default) |
|---|---|---|---|
| Bundler (ERC-4337, EntryPoint v0.7) | `PEPU_BUNDLER_URL` | `http://localhost:4337` | `https://bundler.pepeunchained.com` |
| Paymaster (ERC-7677) | `PEPU_PAYMASTER_URL` | `http://localhost:8788/paymaster/<your-app-key>` | `https://paymaster.pepeunchained.com`; ERC-7677 URL `https://paymaster.pepeunchained.com/v2/paymaster/<token>` (always embeds a token) |

See [Endpoints](../reference/endpoints.md) and [Infrastructure Map](../infra/overview.md).

## Add to your wallet

Paste this into a `wallet_addEthereumChain` call, or enter the fields manually under your wallet's "Add Network" screen.

```json
{
  "chainId": "0x17dcd",
  "chainName": "Pepe Unchained V2",
  "nativeCurrency": { "name": "Pepe Unchained", "symbol": "PEPU", "decimals": 18 },
  "rpcUrls": ["https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"],
  "blockExplorerUrls": ["https://pepuscan.com"]
}
```

There is no reason to add testnet to a wallet today — see "Testnet: out of scope today" above.

## Which standard contracts are deployed

**Multicall3 and the ERC-4337/smart-account stack are live on mainnet**, but at addresses and with caveats that still trip up tooling built for a "default" EVM chain. Read this table before you hardcode anything.

The full table, with deployment notes, verification links, and the reasoning behind each gap, lives on [Deployed Contracts Reference](../contracts/deployed-contracts.md). Summary:

| Contract | Canonical address (other chains) | On Pepe Unchained V2 mainnet |
|---|---|---|
| CREATE2 deterministic deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | **Deployed**, at the canonical address. This is what makes everything else on this table possible. |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | **Deployed — but NOT at the canonical address.** See [The Multicall3 Trap](../contracts/multicall3.md) before you wire this up; the canonical address is permanently unreachable on this chain and PEPU's deployment lives somewhere else. |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | **Deployed**, at the canonical address. |
| ERC-4337 EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | **Deployed**, at the canonical address. |
| ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **Deployed**, at the canonical address. |
| Kernel v3 account factory + MetaFactory + ECDSA validator | (ZeroDev, versioned) | **Deployed.** See [Smart Accounts](../onboarding/smart-accounts.md) and the full reference table for addresses. |
| Sponsored paymaster v2 | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (project-specific, not canonical) | **Deployed.** Sponsorship is available through the hosted endpoints. The v1 paymaster `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` is retired and cannot sponsor. |

**A deployed EntryPoint is not gas sponsorship, and gas sponsorship needs a bundler and a paymaster service on top.** A zero-balance smart account can transact with the paymaster above paying, through PEPU's hosted bundler and ERC-7677 policy service. An app uses those by default and overrides them with `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL`; see [Endpoints](../reference/endpoints.md). See [Sponsored Transactions](../onboarding/sponsored-transactions.md), [Smart Accounts](../onboarding/smart-accounts.md) and [Social Login & Embedded Wallets](../onboarding/privy-embedded-wallets.md) for what that does and doesn't unlock today.

A practical consequence of the gaps that remain: some ecosystem dApps on Pepe Unchained (for example, the native DEX) use their **own non-canonical** Multicall/Permit2 addresses, sized for their own needs — these are not general-purpose substitutes. Don't assume any Multicall or Permit2 address you find referenced by an app on this chain is the canonical one, or compatible with the standard ABI; check it against the [Deployed Contracts Reference](../contracts/deployed-contracts.md), or read it directly from that app's own deployment config.

## A note on gas

The native gas token is PEPU, priced far below ETH, so gwei-denominated gas prices here are not comparable to Ethereum mainnet or most L2s. Expect a base fee around **12,500 gwei-equivalent** — this is a low-value-token artifact, not a sign the chain is expensive or congested, and not a misconfigured RPC. A simple transfer still costs a fraction of a cent in practice. Don't set gas price limits in your tooling based on habits formed on ETH-denominated chains, and don't "fix" the number by hardcoding a lower gas price — your transactions will just get stuck. See [Troubleshooting](../troubleshooting.md) if this is the reason you landed here.

