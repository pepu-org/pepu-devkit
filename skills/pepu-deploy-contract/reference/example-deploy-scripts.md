# Example deploy scripts

These are generic scaffolding, not PEPU-specific beyond the network config covered in SKILL.md —
included here so there's a working starting point to adapt rather than writing one from scratch.

## Foundry: `script/Deploy.s.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MyContract} from "../src/MyContract.sol";

contract DeployScript is Script {
    function run() external returns (MyContract) {
        uint256 deployerKey = vm.envUint("PEPU_DEPLOYER_KEY");
        vm.startBroadcast(deployerKey);

        MyContract deployed = new MyContract(/* constructor args */);

        vm.stopBroadcast();
        console.log("Deployed to:", address(deployed));
        return deployed;
    }
}
```

Run it against mainnet by name (matching the `[rpc_endpoints]` table in `foundry.toml`):

```bash
forge script script/Deploy.s.sol --rpc-url pepu_mainnet --broadcast
```

## Hardhat 3 (viem): `scripts/deploy.ts`

```ts
import { network } from "hardhat";

async function main() {
  const { viem } = await network.connect();
  const myContract = await viem.deployContract("MyContract", [/* constructor args */]);
  console.log("Deployed to:", myContract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Run with the network flag matching the `networks` entry from `hardhat.config.ts` in SKILL.md:

```bash
npx hardhat run scripts/deploy.ts --network pepuMainnet
```

## After either deploy: confirm verification, don't assume it

```bash
curl -s "https://pepuscan.com/api/v2/smart-contracts/<address>" | grep -o '"is_verified":[a-z]*'
```

An empty or 404 response from that endpoint on mainnet means either the address isn't a contract,
or verification hasn't landed yet — not that pepuscan is down. Re-check the exact address you
deployed to before assuming a verification failure.
