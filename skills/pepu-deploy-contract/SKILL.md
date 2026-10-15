---
name: pepu-deploy-contract
description: Deploys and verifies a Solidity contract on Pepe Unchained (PEPU) V2 mainnet (chain 97741) using Foundry as the primary toolchain with Hardhat 3 documented as an alternative. Testnet (97740) is out of scope: no faucet, no indexed explorer, no deployed infrastructure. Covers foundry.toml RPC/verifier configuration, detecting whether the machine's forge binary is actually the foundry-zksync fork (wrong for an Arbitrum Orbit chain and must be caught before deploying), and verifying on pepuscan (Blockscout) or Conduit's hosted Sourcify. Use this skill whenever asked to deploy a contract to PEPU, verify an already-deployed PEPU contract, or set up a project's deploy tooling for PEPU.
---

# Deploy and verify a contract on PEPU

Deploy to **mainnet (97741)** directly, using a dedicated development key holding only a small amount
of PEPU. A deployment costs a fraction of a cent. **Testnet (97740) is out of scope for development**:
it has no public faucet, no indexed explorer (pepuscan covers mainnet only) and none of the chain's
infrastructure deployed. Do not send a user to testnet first; if they ask, say why.


## When to use

Deploying a contract to PEPU mainnet, verifying one on pepuscan, or setting up deploy tooling. For ERC-20 and ERC-721 specifics see `pepu-token-and-nft`; for the chain object and Multicall3 see `pepu-chain-setup`.

## Chain facts

Chain 97741, mainnet only, RPC and explorer (pepuscan, Blockscout) and every deployed address are in [reference/chain-facts.md](reference/chain-facts.md), generated from the SDK. Rules: [reference/rules.md](reference/rules.md).
Confirmed live: `cast chain-id --rpc-url <url>` returns `97741` with upstream Foundry.

Get PEPU for gas by buying it on an exchange or bridging from Ethereum L1 via pepubridge.com. You
cannot fund a user's wallet yourself; tell them so rather than implying a faucet exists.


## SDK functions to use

Deploy scripts and tests read the chain from the SDK; they never retype it:

```ts
import { pepuMainnet, resolvePepuEndpoints, getPublicClient, getPepuAddresses, explorerLinks } from "@pepu-chain/sdk";

const { rpcUrl } = resolvePepuEndpoints();                 // foundry --rpc-url, hardhat networks.pepu.url
const chainId = pepuMainnet.id;                            // 97741
const client = getPublicClient(pepuMainnet);
const code = await client.getCode({ address: "0x0000000000000000000000000000000000000000" }); // post-deploy sanity read
const link = explorerLinks({ address: "0x0000000000000000000000000000000000000000" }).address;
const multicall3 = getPepuAddresses().find((r) => r.key === "multicall3")?.address; // never the canonical 0xcA11...
console.log(rpcUrl, chainId, code, link, multicall3);
```

## MCP tools to call first

- `pepu_chain_info` for facts, `pepu_estimate_gas_cost` before deploying (a deploy costs a fraction of a cent).
- `pepu_verify_contract_guide`: the exact `forge verify-contract` or `hardhat verify` command for pepuscan.
- After deploying: `pepu_check_contract_deployed` (is there code at the address) and `pepu_verify_contract_status` (is it verified; format `detailed` returns the ABI).

## Steps

1. Confirm `forge` is upstream Foundry, not the zkSync fork (Step 0 below). Stop and tell the user if it is not.
2. Configure and deploy (Foundry path, or the Hardhat alternative) with a dedicated development key holding a little PEPU.
3. Verify on pepuscan with the Blockscout command, falling back to Sourcify.
4. Confirm with `pepu_verify_contract_status`, never just the CLI exit code.
5. Wire the address into the app through an env var or config, not a literal in several files.

## Step 0 — confirm your `forge` is upstream Foundry, not the zkSync fork

**Do this before running any Foundry command.** `foundryup-zksync` (ZKsync's fork of Foundry)
installs to the same `~/.foundry` location as upstream Foundry and **overwrites the `forge`/`cast`
binaries already on PATH**. If a machine has ever run `foundryup-zksync`, `forge` may silently be
the zkSync fork — which compiles and behaves differently and will produce wrong results on an
Arbitrum Orbit chain like PEPU.

```bash
forge --version
```

If the output mentions **zksync** anywhere (case-insensitive), **stop and tell the user** rather
than proceeding — they need to either reinstall upstream Foundry (`foundryup`) or point you at a
specific upstream binary path. Do not guess a workaround or hardcode a specific install path in
scripts; just surface the finding and let the user resolve it, since the fix depends on their
machine's setup.

## Foundry path (primary)

### 1. Configure `foundry.toml`

```toml
[rpc_endpoints]
pepu_mainnet = "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"
```

Keep your deployer private key out of the repo — pass it via `--private-key $DEPLOYER_KEY` (env
var) or `--interactive`, never committed.

### 2. Deploy

```bash
forge create src/MyContract.sol:MyContract \
  --rpc-url pepu_mainnet \
  --private-key "$DEPLOYER_KEY" \
  --broadcast
```

Or, for a scripted multi-step deploy (`forge script`), point `--rpc-url` at `pepu_mainnet` the same
way. Foundry estimates gas automatically; you do not need to override gas price to work around PEPU's
~12,500 gwei-equivalent base fee — that's a real, expected value, not something to fight. If a deploy
fails on an out-of-gas-looking error, check the actual revert reason before assuming it's a gas-price
problem.

### 3. Verify on pepuscan (Blockscout)

```bash
forge verify-contract <address> src/MyContract.sol:MyContract \
  --chain-id 97741 \
  --verifier blockscout \
  --verifier-url https://pepuscan.com/api \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz
```

This exact invocation (explicit `--chain-id`, `--verifier-url` with no trailing slash, a literal
`--rpc-url`) is **confirmed working** against pepuscan, not just "should work per Blockscout's
generic docs." The `pepu_mainnet` alias from `foundry.toml` works equally well in place of the
literal RPC URL if you've configured `[rpc_endpoints]`. Most self-hosted Blockscout instances
(pepuscan included) don't require an API key for this; if verification is rejected for needing
one, that's a sign pepuscan has changed its config since this was confirmed — check
`forge verify-contract --help` and pepuscan's docs directly rather than guessing a key format.

If the Blockscout route doesn't pick up the verification for some reason, Conduit's Sourcify
instance (`--verifier sourcify --verifier-url https://contracts.conduit.xyz`) is the documented
fallback — Conduit's docs describe verification as running through their hosted
Sourcify with automatic per-chain support, no manual chain-metadata submission needed.

### 4. Confirm verification actually succeeded

Don't just trust the CLI's exit code — verification services occasionally accept a submission and
then fail asynchronously. Check directly:

```bash
curl -s "https://pepuscan.com/api/v2/smart-contracts/<address>" | grep -o '"is_verified":[a-z]*'
```

Or, if a PEPU MCP server is connected, call `pepu_verify_contract_status` with the address —
it also distinguishes "unverified contract" from "not a contract at all," which the raw API does
not.

## Hardhat path (alternative)

Foundry is primary for PEPU work, but Hardhat is a fully documented alternative — use it if the
project already standardized on Hardhat, or if Foundry genuinely isn't available on the machine.

Hardhat 3's recommended setup uses viem as the connection library (`npx hardhat --init`, choose
"A TypeScript Hardhat project using Node Test Runner and Viem" — this installs
`@nomicfoundation/hardhat-toolbox-viem`).

### 1. `hardhat.config.ts`

```ts
import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatVerify],
  networks: {
    pepuMainnet: {
      type: "http",
      chainType: "generic", // PEPU is Arbitrum Orbit — not "l1" or "op"; "generic" is the
                             // correct Hardhat 3 chainType for an EVM chain without dedicated support
      url: "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz",
      accounts: [configVariable("PEPU_DEPLOYER_KEY")],
      chainId: 97741,
    },
  },
  verify: {
    blockscout: {
      // Most self-hosted Blockscout instances, pepuscan included, don't require
      // an API key. Leave unset unless verification is rejected asking for one.
    },
  },
});
```

Set `PEPU_DEPLOYER_KEY` via `npx hardhat vars set PEPU_DEPLOYER_KEY` (or the equivalent env var) —
never commit it. `configVariable(...)` is Hardhat 3's mechanism for referencing a securely-stored
config value instead of hardcoding it.

### 2. Deploy and verify

```bash
npx hardhat run scripts/deploy.ts --network pepuMainnet
npx hardhat verify blockscout --network pepuMainnet <address> [constructor args...]
```

`deploy.ts` is ordinary Hardhat-3-with-viem deployment code (`hre.viem.deployContract(...)`) — the
PEPU-specific part is entirely in the `networks`/`verify` config above, not the deploy script
itself.

## Pitfalls and known gaps (be honest about these)

- **Testnet is out of scope.** Chain 97740 is real, but there is no faucet, no indexed explorer and
  no deployed infrastructure on it, so this skill does not cover it. Users need real (cheap) mainnet
  PEPU for any deployment.
- **Multicall3 is deployed on PEPU mainnet, but never at its canonical address** (a PEPU-specific
  deployment exists instead — see `pepu-chain-setup`). If the contract you're deploying, or a
  deploy script / test harness, hardcodes the canonical Multicall3 address for gas estimation or
  batched setup calls, it will silently call an empty address on this chain. See the
  `pepu-chain-setup` skill before you hit that confusing failure mid-deploy.
- **The mainnet Blockscout verification command above is confirmed working**, not just
  "should work per docs" — `forge verify-contract <addr> <path>:<name> --chain-id 97741 --verifier
  blockscout --verifier-url https://pepuscan.com/api --rpc-url <rpc>` has been run against a real
  deployment and pepuscan accepted it. The Hardhat verify path and the Sourcify fallback are still
  verified only against Foundry's/Hardhat's/Conduit's own documentation plus confirmed live RPC
  connectivity (`cast chain-id` returning the right chain ids) — still confirm with
  `pepu_verify_contract_status` or the `curl` check above rather than assuming success on
  those two paths.

## Verify

1. `pepu_check_contract_deployed` with the address returns deployed.
2. `pepu_verify_contract_status` returns verified (and the ABI, when you ask for `detailed`).
3. `explorerLinks({ address }).address` opens the verified source on pepuscan.

## Never hand-roll

Do not retype the chain id, RPC URL, explorer API URL or Multicall3 address in deploy scripts, and never use the canonical Multicall3 address. Read them from `pepuMainnet`, `resolvePepuEndpoints()`, `getPepuAddresses()`. Use `pepu_verify_contract_guide` instead of guessing verify flags. See [reference/rules.md](reference/rules.md).
