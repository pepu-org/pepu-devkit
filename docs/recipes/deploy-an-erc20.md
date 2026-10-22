# Recipe: Deploy an ERC-20

A standard OpenZeppelin-based ERC-20, deployed and verified on Pepe Unchained V2 mainnet with Foundry.

This is the standard Foundry flow against PEPU mainnet. It uses the Foundry toolchain, so there is no SDK code to type-check; the SDK helps after deployment. If you haven't deployed anything here yet, do [Deploy & Verify a Contract](../contracts/deployment.md) first — this recipe assumes a working Foundry project and a funded development key.

## The contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MyToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("My Token", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}
```

Save as `src/MyToken.sol`.

## Install OpenZeppelin

```bash
forge install OpenZeppelin/openzeppelin-contracts
```

Add a remapping in `foundry.toml` if `forge install` didn't add one automatically:

```toml
remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]
```

## Deploy

Constructor takes the initial supply in the token's smallest unit (18 decimals is OpenZeppelin's ERC-20 default, so `1_000_000e18` for one million whole tokens):

```bash
forge create src/MyToken.sol:MyToken \
  --rpc-url pepu_mainnet \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --constructor-args 1000000000000000000000000
```

(That's `1,000,000 * 10^18` — one million tokens at 18 decimals.)

## Verify

Same Blockscout verification pattern as any other contract on this chain, with constructor args passed through so pepuscan can reproduce the exact deployed bytecode:

```bash
forge verify-contract \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --constructor-args $(cast abi-encode "constructor(uint256)" 1000000000000000000000000) \
  <DEPLOYED_ADDRESS> \
  src/MyToken.sol:MyToken
```

## Add it to the wallet the deploying key belongs to (optional, for testing)

Most wallets support `wallet_watchAsset` for this:

```ts
await window.ethereum.request({
  method: "wallet_watchAsset",
  params: {
    type: "ERC20",
    options: {
      address: "0xYourTokenAddress",
      symbol: "MTK",
      decimals: 18,
    },
  },
});
```

## Things this recipe deliberately does not cover

- **Listing on PepuSwap or any DEX** — that's a liquidity/business decision, not a deployment step, and out of scope for developer docs.
- **A canonical token list entry.** `@pepu-chain/sdk`'s token list (see [`@pepu-chain/sdk` Reference](../sdk/core.md#contract-and-dex-registries)) only includes addresses that clear a high independent-verification bar. Deploying your own token doesn't add it there automatically, and it shouldn't — that list is for chain-level infrastructure tokens, not every token anyone deploys.
- **Permit2.** The canonical Permit2 is deployed on PEPU (`getPermit2()`), so a freshly deployed ERC-20 can use signature-based approvals after one ordinary `approve(permit2, amount)`. See [Sign a Permit2 Permit](permit2-permit.md).


## After deployment, with the SDK

- Link the deployment: `txUrl(pepuMainnet, hash)` and `addressUrl(pepuMainnet, address)` ([Explorer Links](explorer-links.md)).
- Read it: [Read a Contract](read-a-contract.md), and gate content on it: [Gate Content by Token Balance](gate-content-by-token-balance.md).
- For gas the user does not pay, the contract must be on the paymaster allowlist: [Send a Sponsored Transaction](sponsored-send.md).
