# Deploy & Verify a Contract

This page takes you from nothing to a deployed, verified contract on Pepe Unchained V2 **mainnet**. Foundry is the primary path below; a complete Hardhat path follows it for anyone who prefers that toolchain. Both are real, complete, and independently sufficient — pick one.

If you haven't already, skim [V1 vs V2](../get-started/v1-vs-v2.md) first: the chain ID and RPC URL below are for the current chain (V2). An older, dead chain shares the project name and gets confused with this one constantly.

**Looking for the fastest path to a running app instead of a bare contract?** See [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](../get-started/quickstart-app.md) — it scaffolds a Next.js app with sign-in and a wallet, no Solidity required. This page is for when you specifically want to write and deploy a contract.

## Why mainnet, not testnet

Testnet (chain `97740`) has no public faucet, no indexed explorer, and none of the infrastructure on this page deployed to it — see [Network Reference](../get-started/network-reference.md#testnet-out-of-scope-today). It is out of scope for development today. Mainnet is the actual "try it" chain: a deployment costs a fraction of a cent, so use a dedicated development key with minimal funds and deploy there directly. Everything below targets mainnet only.

## What you'll need

- A wallet with a private key you control (use a dedicated development key with minimal funds — never a key holding meaningful value).
- Either [Foundry](https://getfoundry.sh) or Node.js 18+ with a package manager, depending on which path you follow.
- A small amount of PEPU to pay gas (see "Get funds" below).

## Network parameters

| Parameter | Value |
|---|---|
| Chain ID | `97741` |
| RPC URL | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` |
| Currency | PEPU (18 decimals) |
| Explorer | `https://pepuscan.com` |

Full parameters, an "Add to Wallet" JSON snippet, and the complete deployed-contracts reference are on [Network Reference](../get-started/network-reference.md).

## Get funds

Buy PEPU on an exchange, or bridge existing PEPU from Ethereum L1 via [pepubridge.com](https://pepubridge.com). Gas on this chain is a fraction of a cent per transaction (see the gas note on [Network Reference](../get-started/network-reference.md)), so a very small amount funds a long testing session.

## The contract

Both paths below deploy the same minimal contract. Save it as `src/Counter.sol` (Foundry) or `contracts/Counter.sol` (Hardhat):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}
```

---

## Path 1: Foundry (primary)

### Install and confirm your toolchain

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

This has been verified working against Pepe Unchained mainnet on upstream Foundry `v1.5.1-stable`.

> **Check which `forge` you're running before you go further.** If [`foundry-zksync`](https://github.com/matter-labs/foundry-zksync) is installed on the same machine, the `forge` binary on your `PATH` may resolve to the zkSync fork instead of upstream Foundry. The zkSync fork compiles and deploys differently and is the wrong tool for an Arbitrum Orbit chain like this one. Run:
>
> ```bash
> forge --version
> ```
>
> The zkSync fork announces itself in the version string (it will mention `zksync`). If you see that, reinstall or switch to upstream Foundry via `foundryup` before continuing.

Confirm the RPC is reachable and returns the chain ID you expect:

```bash
cast chain-id --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz
# 97741
```

### Set up the project

```bash
forge init pepu-quickstart
cd pepu-quickstart
```

`forge init` scaffolds its own default `src/Counter.sol`. Replace it with the contract from [above](#the-contract) so the rest of this walkthrough matches exactly.

Add an RPC alias to `foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]

[rpc_endpoints]
pepu_mainnet = "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"
```

### Build

```bash
forge build
```

### Deploy

Set your development private key as an environment variable (never commit it):

```bash
export PRIVATE_KEY=0xyourdevelopmentprivatekey
```

```bash
forge create src/Counter.sol:Counter \
  --rpc-url pepu_mainnet \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Foundry estimates gas automatically — you don't need to override gas price to work around PEPU's ~12,500 gwei-equivalent base fee; that's a real, expected value, not something to fight (see [Troubleshooting](../troubleshooting.md)). Note the deployed contract address `forge create` prints — you'll need it to verify.

### Verify

Verify against pepuscan directly, using Foundry's Blockscout verifier:

```bash
forge verify-contract \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  <DEPLOYED_ADDRESS> \
  src/Counter.sol:Counter
```

This is Blockscout's own documented Foundry verification pattern (`--verifier blockscout` pointed at a self-hosted instance's `/api` path), confirmed working against pepuscan. Most self-hosted Blockscout instances, pepuscan included, don't require an API key for this.

Don't just trust the CLI's exit code — confirm the verification actually landed:

```bash
curl -s "https://pepuscan.com/api/v2/smart-contracts/<DEPLOYED_ADDRESS>" | grep -o '"is_verified":[a-z]*'
```

If you have the `pepu` MCP server connected, `pepu_verify_contract_status` does this same check and also distinguishes "unverified contract" from "not a contract at all" — see [Agent Tooling](../agent-tooling/mcp-and-skills.md).

Conduit's Sourcify-compatible service (`--verifier sourcify --verifier-url https://contracts.conduit.xyz`) is a documented fallback if the Blockscout route doesn't pick up the verification for some reason — but Blockscout against pepuscan is the confirmed, primary path.

### View it

Open `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`. You should see the contract, its verified source, and a "Read/Write Contract" tab once pepuscan.com picks up the verification.

---

## Path 2: Hardhat (alternative)

Foundry is primary for PEPU work, but Hardhat is a fully documented alternative — use it if the project already standardized on Hardhat, or if Foundry genuinely isn't available on the machine.

### Install

```bash
mkdir pepu-quickstart && cd pepu-quickstart
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox dotenv
npx hardhat init
```

Choose "Create a TypeScript project" (or JavaScript, adjusting file extensions below) when prompted.

### Configure

Create a `.env` file:

```
DEPLOYER_PRIVATE_KEY=0xyourdevelopmentprivatekey
```

Replace `hardhat.config.ts` with:

```ts
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    pepuMainnet: {
      url: "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz",
      chainId: 97741,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://contracts.conduit.xyz",
    browserUrl: "https://pepuscan.com",
  },
};

export default config;
```

The `sourcify` block is the fastest way to get one-command verification working on Hardhat 2 + `hardhat-toolbox` today (it runs against Conduit's Sourcify-compatible service). If your project has moved to **Hardhat 3**, its newer `@nomicfoundation/hardhat-verify` plugin has first-class Blockscout support instead — configure a `verify.blockscout` block and run `npx hardhat verify blockscout --network pepuMainnet <address>` for the same pepuscan-verified result the Foundry path above gets directly. Either produces a verified contract on pepuscan; they're two different plugins' paths to it, not competing sources of truth.

### Write the contract and compile

Save the contract from [above](#the-contract) as `contracts/Counter.sol`, then:

```bash
npx hardhat compile
```

### Deploy

Create `scripts/deploy.ts`:

```ts
import { ethers } from "hardhat";

async function main() {
  const Counter = await ethers.getContractFactory("Counter");
  const counter = await Counter.deploy();
  await counter.waitForDeployment();
  console.log("Counter deployed to:", await counter.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```bash
npx hardhat run scripts/deploy.ts --network pepuMainnet
```

### Verify

With the `sourcify` block above in place, Hardhat's standard verify command runs against Conduit's Sourcify-compatible service:

```bash
npx hardhat verify --network pepuMainnet <DEPLOYED_ADDRESS>
```

### View it

Same as the Foundry path: `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`.

---

## Next steps

- [Address Map](address-map.md) and [Deployed Contracts Reference](deployed-contracts.md) — the full table of what's live on this chain, with verification links.
- [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md): deploy to a predictable address through the live deployer, as Multicall3 and Permit2 were.
- [The Multicall3 Trap](multicall3.md) — Multicall3 is deployed here now, but not at the address your tooling probably assumes.
- [`@pepu-chain/sdk` Reference](../sdk/reference.md) — import chain definitions and the contract registry instead of hand-rolling them.
- [Recipes](../recipes/read-a-contract.md) — short, copy-pasteable patterns for reading and writing contracts once one is deployed.
- [Social Login & Embedded Wallets (Privy)](../onboarding/privy-embedded-wallets.md) — wiring up user-facing wallets instead of a raw private key.

