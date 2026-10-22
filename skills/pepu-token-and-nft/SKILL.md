---
name: pepu-token-and-nft
description: Deploys and interacts with an ERC-20 token or ERC-721 NFT collection on Pepe Unchained (PEPU) V2 (mainnet chain 97741; testnet is out of scope), using OpenZeppelin contracts, Foundry or Hardhat for deploy/verify, and viem/wagmi or the pepu MCP server for reads and writes. Also covers what "getting listed" actually means on PEPU today — the distinct, third-party-controlled PepuSwap token list versus this devkit's own @pepu-chain/sdk token list — since neither is automatic just from deploying. Use this skill whenever asked to create a token or NFT collection on PEPU, add a token to a dapp's token list, or interact with an existing ERC-20/721 contract on this chain.
---

# Deploy and use an ERC-20 or ERC-721 on PEPU

Follow `pepu-deploy-contract` for the toolchain setup (Foundry primary, mainnet only, the zkSync
`forge` trap) and `pepu-chain-setup` for chain facts — this skill only adds what's specific to
tokens and NFTs: which contracts to start from, and what "getting listed" actually requires.

## When to use

Creating an ERC-20 or ERC-721 on PEPU, adding a token to a dapp, reading balances in batches, or interacting with an existing token. Toolchain: `pepu-deploy-contract`. Chain object and Multicall3: `pepu-chain-setup`.

## Chain facts

Chain 97741, mainnet only; WPEPU, the registry and every deployed address are in [reference/chain-facts.md](reference/chain-facts.md) (generated from the SDK). Rules: [reference/rules.md](reference/rules.md).
Token addresses come from `pepuTokenList` (this SDK's verified list) or the PepuSwap list, never from memory.

## SDK functions to use

```ts
import { erc20Abi } from "viem";
import { getPublicClient, pepuMainnet, pepuMulticall, pepuTokenList, wpepuAbi, explorerLinks, formatPepu } from "@pepu-chain/sdk";
import type { Address } from "viem";

const client = getPublicClient(pepuMainnet);
const known = pepuTokenList.tokens.filter((t) => t.chainId === pepuMainnet.id);   // verified entries only

// batch token metadata and a balance through PEPU's Multicall3 (never the canonical one)
declare const token: Address, holder: Address;
const [symbol, decimals, balance] = await pepuMulticall(
  client,
  [
    { address: token, abi: erc20Abi, functionName: "symbol" },
    { address: token, abi: erc20Abi, functionName: "decimals" },
    { address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
  ],
  { allowFailure: false },
);
console.log(known.length, symbol, decimals, balance, wpepuAbi.length, explorerLinks({ token }).token, formatPepu(0n));
```

## MCP tools to call first

`pepu_get_token_info` (name, symbol, decimals, supply, holders, cross-checked live), `pepu_read_contract`, `pepu_verify_contract_guide`, `pepu_verify_contract_status`, `pepu_check_contract_deployed`, `pepu_search`.

## Steps

1. Start from OpenZeppelin (below), deploy with `pepu-deploy-contract`, verify with the constructor arguments.
2. Confirm with `pepu_verify_contract_status` and `pepu_get_token_info`.
3. Read with `pepuMulticall` or `pepu_read_contract`; write from a frontend with `useWriteContract` (`pepu-build-dapp`).
4. Decide about listing (last section): neither list is automatic.

## Contracts to start from

Use OpenZeppelin's audited implementations rather than writing ERC-20/721 logic from scratch —
nothing about PEPU changes that general advice. See `reference/example-tokens.md` for a minimal,
complete ERC-20 and ERC-721 contract using them, ready to adapt.

```bash
# Foundry
forge install OpenZeppelin/openzeppelin-contracts

# Hardhat
npm install @openzeppelin/contracts
```

## Deploy (mainnet — testnet is out of scope)

```bash
forge create src/MyToken.sol:MyToken \
  --rpc-url pepu_mainnet \
  --private-key "$DEPLOYER_KEY" \
  --broadcast \
  --constructor-args "My Token" "MTK" 1000000000000000000000000
```

Constructor args above are an example for the ERC-20 in `reference/example-tokens.md` (name,
symbol, initial supply in wei-equivalent units — adjust for your token's `decimals()`). An ERC-721
typically only needs name and symbol; per-token minting happens after deploy via a separate
`mint`/`safeMint` call, not the constructor.

Use a dedicated development key with a small amount of PEPU; a deploy costs a fraction of a cent.
See `pepu-deploy-contract` for why testnet (no faucet, no explorer) is not part of the workflow.

## Verify the deployment

```bash
forge verify-contract <address> src/MyToken.sol:MyToken \
  --chain-id 97741 \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz \
  --constructor-args $(cast abi-encode "constructor(string,string,uint256)" "My Token" "MTK" 1000000000000000000000000)
```

This is the same confirmed-working Blockscout verification command as `pepu-deploy-contract`, with
`--constructor-args` added (ABI-encoded, via `cast abi-encode`) since verification needs to
reproduce the exact deployed bytecode including constructor arguments. If the Blockscout route
doesn't take, use the Sourcify fallback from `pepu-deploy-contract`.

**Verifying an ERC-20/721 unlocks more than source-code display.** Once verified, pepuscan
(Blockscout) automatically detects standard interfaces (`symbol()`/`decimals()`/`totalSupply()` for
ERC-20; `supportsInterface` for ERC-721/1155) and adds the token/NFT-specific tabs — holders, an
NFT gallery, transfer history — without any extra step on your part. An unverified contract only
shows as a generic address with raw transactions.

## Reading and writing

**Reads**, without a private key — via the pepu MCP server if connected:

```
pepu_read_contract with { "address": "<token>", "abi": [{"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}]}], "functionName": "balanceOf", "args": ["<holder>"] }
```

Or `pepu_verify_contract_status` first (response format `detailed`) if you don't already have
the ABI — it returns the full ABI for a verified contract.

**Writes** (transfer, approve, mint) from a frontend: `wagmi`'s `useWriteContract`, exactly like
any other contract call on PEPU — see `pepu-build-dapp` Step 3. These cost real PEPU gas unless a paymaster pays: run
`pepu_sponsorship_status` and, only if it says available, see `pepu-sponsored-transactions`. Otherwise do not build a
"free mint" flow: the mint transaction itself costs gas even if your contract charges no separate price for the NFT.

## Getting listed — two separate, both non-automatic, lists

Deploying a token does not make it appear in any wallet's or DEX's token picker. Two lists exist
for PEPU, controlled by different parties, and neither happens automatically:

1. **PepuSwap's own token list** (PEPU's main DEX), at
   `https://raw.githubusercontent.com/0sum-io/tokens/refs/heads/main/pepu-mainnet2.json`, maintained
   by 0sum.io. This is the practical list to get onto if you want your token visible in PepuSwap's
   own swap UI — that's a PR against their repository, a process this skill doesn't control and
   can't submit on your behalf.
2. **This devkit's own `@pepu-chain/sdk` token list** (`packages/sdk/src/tokens.ts`), which follows the
   Uniswap Token List schema (`chainId`, `address`, `name`, `symbol`, `decimals`, optional `logoURI`/
   `tags`) and is deliberately minimal today — only tokens independently verified against multiple
   sources are included. Adding an entry here is a contribution to this devkit's own SDK package,
   not something a scaffolded app does at runtime; if you're extending `@pepu-chain/sdk` itself (not this
   skill's normal scope — that package is out of bounds for this skill, see its own `AGENTS.md`),
   match the existing `PepuTokenInfo` shape exactly and only add addresses you've independently
   verified the same way the existing entries were (cross-checked via `eth_getCode` and a
   Blockscout verified-source match), not as a placeholder.

**Don't confuse either of these with "being on pepuscan."** Verification (above) makes a contract
*legible* on the block explorer; it does not add it to any token list. A token can be fully verified
and still invisible to a swap UI that reads from a curated list rather than the chain directly.

## Pitfalls

- **Batched reads on PEPU use PEPU's Multicall3.** Never paste the canonical address; use `pepuMulticall`.
- **Writes cost real PEPU gas** unless a paymaster pays (`pepu-sponsored-transactions`, live-checked with `pepu_sponsorship_status`). Do not label a mint "free" on a guess.
- **Verification is not listing.** A verified token is still invisible to a swap UI that reads a curated list.
- **ERC-20 decimals are not always 18** (USDT and USDC are 6): read `decimals()`, do not assume.
- **A wrong address in a token list is worse than none.** Verify with `pepu_check_contract_deployed` and `pepu_get_token_info`.

## Never hand-roll

Do not hand-write a token list, a multicall address, an ABI for WPEPU, or explorer URLs. Use `pepuTokenList`, `pepuMulticall`, `wpepuAbi`, `explorerLinks`, and the tools above. See [reference/rules.md](reference/rules.md).
