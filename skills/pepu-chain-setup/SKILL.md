---
name: pepu-chain-setup
description: Configures viem, wagmi, Hardhat and Foundry correctly for Pepe Unchained (PEPU) V2 mainnet (chain 97741; Arbitrum Orbit/Nitro; testnet is out of scope) using @pepu-chain/sdk instead of a hand-written chain object - pepuMainnet, getPublicClient, pepuWagmiConfig, pepuMulticall, getPepuAddresses, getPermit2 and buildPermitSingleTypedData, explorerLinks, estimateTransactionCost, formatPepu. Carries the chain facts and the traps - Multicall3 lives at a PEPU-specific address (never the canonical 0xcA11...), the gas price looks huge in gwei, eth_getLogs is capped at 2,000 blocks, no WebSocket RPC. Use when adding PEPU to any project, setting up a client or wallet, reading contracts in batches, signing a Permit2 permit, or debugging silent multicall failures.
---

# PEPU chain setup (use the SDK, do not hand-write the chain)

Pepe Unchained V2 is an Arbitrum Orbit / Nitro chain. It behaves like any EVM chain for most purposes and has a few sharp edges that silently break generic tooling.
`@pepu-chain/sdk` already encodes every one of them.

## When to use

- Adding PEPU to a new or existing project: a viem client, a wagmi config, a Hardhat or Foundry network.
- Batching reads (Multicall3), Permit2, explorer links, gas display.
- A batched read fails with "contract not deployed" or returns garbage.

If chain id `3409` appears, stop: that is the legacy V1 chain (OP Stack), unrelated to everything here. Confirm which chain the user means.

## Chain facts

Generated from the SDK registry, never hand-copied: [reference/chain-facts.md](reference/chain-facts.md) (network, RPC, explorer, every deployed contract, the Multicall3 trap, gas, sponsorship endpoints).
Rules for working with the SDK: [reference/rules.md](reference/rules.md). Third-party and L1 addresses (PepuSwap, tokens, bridge): [reference/ecosystem-addresses.md](reference/ecosystem-addresses.md).
Summary: chain `97741`, mainnet only, native PEPU (18 decimals), pepuscan.com explorer, **Multicall3 at the PEPU address `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, not the canonical `0xcA11bde05977b3631167028862bE2a173976CA11`**.

## SDK functions to use

```ts
import {
  pepuMainnet, getPublicClient, pepuMulticall, getPepuAddresses, getContract, isDeployed,
  getPermit2, permit2Domain, buildPermitSingleTypedData, readPermit2Allowance,
  explorerLinks, estimateTransactionCost, formatPepu, resolvePepuEndpoints, switchOrAddPepuChain,
} from "@pepu-chain/sdk";
import { pepuWagmiConfig } from "@pepu-chain/sdk/privy/wagmi"; // wagmi config (ESM only)
```

## MCP tools to call first

- `pepu_chain_info`: verified network facts, every registry address, deployed-or-not.
- `pepu_health_check`: RPC and pepuscan reachability.
- `pepu_check_contract_deployed` (by name or address): a live `eth_getCode` check that surfaces the PEPU replacement when a canonical address is empty.
- `pepu_gas_price`, `pepu_estimate_gas_cost` for cost questions. `pepu_known_gotchas` for the full trap list.
- `pepu_sdk_snippet` with `task: "multicall-read"` or `"permit2-permit"`.

## Steps

### 1. A client

```ts
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";

export const publicClient = getPublicClient(pepuMainnet); // default RPC; PEPU_RPC_URL aware through resolvePepuEndpoints()
```

Use a different RPC (an authenticated provider) with `getPublicClient(pepuMainnet, { transport: http(url) })`. `resolvePepuEndpoints()` returns `rpcUrl`, `bundlerUrl`, `paymasterUrl` from options, env, then defaults.

### 2. wagmi

```tsx
import { pepuWagmiConfig } from "@pepu-chain/sdk/privy/wagmi";

export const config = pepuWagmiConfig(); // PEPU mainnet; the chain object carries the PEPU Multicall3
```

With Privy login use `PepuPrivyWagmiProvider` instead (`pepu-onboarding-privy`). If you must build a wagmi config without the SDK entry, pass `pepuMainnet` as the chain and keep its `contracts.multicall3`; never overwrite it.

### 3. Batched reads (never the canonical Multicall3)

```ts
import { erc20Abi } from "viem";
import { getPublicClient, pepuMainnet, pepuMulticall, pepuTokenList } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);
const wpepu = pepuTokenList.tokens.find((t) => t.symbol === "WPEPU"); // never hardcode the address
if (!wpepu) throw new Error("WPEPU is not in the SDK token list");
const token = wpepu.address;

const [name, supply] = await pepuMulticall(
  client,
  [
    { address: token, abi: erc20Abi, functionName: "name" },
    { address: token, abi: erc20Abi, functionName: "totalSupply" },
  ],
  { allowFailure: false },
);
```

`pepuMulticall(client, calls, { allowFailure?, blockNumber? })` resolves the right Multicall3 for the client's chain through the registry. A viem client built on `pepuMainnet` also batches correctly (`client.multicall`), because the chain object carries the PEPU address.
For a single read through MCP use `pepu_read_contract`.

### 4. Addresses, from the registry

```ts
import { getPepuAddresses, getContract, isDeployed } from "@pepu-chain/sdk";

const rows = getPepuAddresses();                       // [{ key, name, status, address?, note }]
const entryPoint = getContract(97741, "entryPoint07");
if (isDeployed(entryPoint)) console.log(entryPoint.address);
```

Never paste an address from memory or from this skill into code. Read it from the registry so a change flows through.

### 5. Permit2 (canonical, deployed)

```ts
import { buildPermitSingleTypedData, readPermit2Allowance, getPermit2 } from "@pepu-chain/sdk";
import type { Address } from "viem";

declare const token: Address, spender: Address, owner: Address;
const typedData = buildPermitSingleTypedData({
  token, amount: 1_000_000n, expiration: Math.floor(Date.now() / 1000) + 3600,
  nonce: 0, spender, sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 900),
});
// const signature = await walletClient.signTypedData(typedData);
const allowance = await readPermit2Allowance(publicClient, { owner, token, spender });
console.log(getPermit2().address, allowance.nonce);
```

PepuSwap has its own separate, non-canonical Permit2; do not mix them.

### 6. Explorer links and gas display

```ts
import { explorerLinks, estimateTransactionCost, formatPepu, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import type { Address } from "viem";

declare const to: Address, account: Address;
const publicClient = getPublicClient(pepuMainnet);

const { tx } = explorerLinks({ tx: "0x..." });                                   // https://pepuscan.com/tx/0x...
const cost = await estimateTransactionCost(publicClient, { to, value: 1n, account }); // { gas, gasPriceWei, costWei, costFormatted }
console.log(formatPepu(cost.costWei));                                            // up to 8 decimals, never collapses to "0"
```

### 7. Hardhat and Foundry

Hardhat network entry: `url` from `resolvePepuEndpoints().rpcUrl`, `chainId: 97741`. Foundry: `--rpc-url` the same URL, `--chain-id 97741`. Deployment and verification: `pepu-deploy-contract`.
Add the chain to a user's wallet with `switchOrAddPepuChain(provider, pepuMainnet)` (or `toAddEthereumChainParameter(pepuMainnet)`).

## Verify

1. `pepu_check_contract_deployed` for the Multicall3 you use returns deployed at `0x9CE1...01bd`.
2. A `pepuMulticall` read returns real values (not an error, not zeros).
3. `pepu_health_check` is green; `explorerLinks({ tx }).tx` opens on pepuscan.
4. `npm run typecheck`.

## Pitfalls

- **Multicall3 trap.** The canonical address has no code here and never will (its pre-signed deploy caps gas at 1M, Nitro needs about 14.3M). A chain config that defaults to it fails with "contract not deployed" and no mention of Multicall3, or silently falls back to unbatched calls if it is absent. Re-check after every viem, wagmi or chain-package upgrade. PepuSwap's own small multicall at a different address is not Multicall3-compatible.
- **The gas price looks enormous in gwei** (about 12,500 gwei). That is normal here: a fixed L1 data cost spread over a low-value token. Do not hardcode a lower price, transactions stick.
- **`eth_getLogs` is capped at a 2,000-block range** on the public RPC (`-32602` beyond it): paginate.
- **The public RPC rate-limits** (`-32017`) and gates `debug_*` and `trace_*` behind a Conduit API key (`-32401`). Use a key for anything beyond light local work.
- **No WebSocket RPC.** Do not build `eth_subscribe` flows.
- **Two explorers.** pepuscan.com is Blockscout with an indexer (addresses, tokens, verification). The Conduit default explorer has no indexer: single blocks and transactions only.
- **Testnet.** Do not target 97740: it has no Blockscout, no EntryPoint, no Multicall3.
- **P256 precompile** at `0x100` is live (RIP-7212): passkey signature verification is cheap on-chain.
- Any other error text: `pepu_explain_error` (SDK `explainError`).

## Never hand-roll

Do not write a `defineChain` for PEPU, a Multicall3 address, a Permit2 domain, an explorer URL template, a gas formatter, or an address table. Use `pepuMainnet`, `pepuMulticall`, `getPermit2`, `explorerLinks`, `formatPepu`, `getPepuAddresses`.
See [reference/rules.md](reference/rules.md).
