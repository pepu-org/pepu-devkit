# Recipe: Read a Contract

Call a read-only (`view` or `pure`) function on a deployed contract with the SDK's public client, in a script or a React app.

TapScore (`0x261eA5971B93237a56990206A46Bc80318e4d078`) is the sample contract.

## Prerequisites

`@pepu-chain/sdk` and `viem`. For the React variant, a wagmi config built on `pepuMainnet`.

## Steps

`getPublicClient(pepuMainnet)` returns an ordinary viem `PublicClient` on PEPU's RPC. Everything after it is plain viem. Take well-known addresses from the SDK registry (`getContract`, narrowed with `isDeployed`) instead of pasting them, so a pending contract cannot be read by accident.

```ts
// Read a contract with the SDK's public client. See docs/recipes/read-a-contract.md
import { getContract, getPublicClient, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import { parseAbi } from "viem";

const client = getPublicClient(pepuMainnet);

// TapScore is in the SDK registry; getContract returns a pending-or-deployed union.
const tapScore = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(tapScore)) throw new Error("TapScore is not deployed on this chain");
const tapScoreAddress = tapScore.address;

const abi = parseAbi(["function scores(address) view returns (uint256)"]);

export async function readScore(player: `0x${string}`): Promise<bigint> {
  return client.readContract({
    address: tapScoreAddress,
    abi,
    functionName: "scores",
    args: [player],
  });
}
```

Source: `docs/snippets/read-contract.ts`, type-checked against the SDK.

### In a React app (wagmi)

```tsx
import { useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { pepuMainnet } from "@pepu-chain/sdk";

const abi = parseAbi(["function scores(address) view returns (uint256)"]);

function Score({ address }: { address: `0x${string}` }) {
  const { data: score, isLoading } = useReadContract({
    chainId: pepuMainnet.id,
    address: "0x261eA5971B93237a56990206A46Bc80318e4d078",
    abi,
    functionName: "scores",
    args: [address],
  });

  if (isLoading) return <p>Loading</p>;
  return <p>Score: {score?.toString()}</p>;
}
```

This needs a `WagmiProvider` configured with a PEPU chain. `PepuPrivyWagmiProvider` from [/privy/wagmi](../sdk/privy-wagmi.md) does it.

### Don't know the ABI

`createPepuscanClient(pepuMainnet).getVerifiedAbi(address)` returns a verified contract's ABI from pepuscan, or `null` if it is unverified. The MCP tool `pepu_verify_contract_status` does the same from an agent.

## What to expect

- The result is typed from the ABI. A `uint256` is a `bigint`.
- Reads cost no gas and need no wallet.
- The public RPC is rate limited. For volume pass an authenticated transport: `getPublicClient(pepuMainnet, { transport: http(url) })`.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `Property 'address' does not exist on type 'ContractEntry'` | Skipped `isDeployed` | Narrow first, then read `.address` |
| `returned no data ("0x")` | Wrong address, or the contract is not deployed on chain 97741 | Check the address with `pepu_check_contract_deployed` or the explorer |
| Many sequential reads are slow | One request per call | Batch them: [Batch Reads with Multicall3](batch-reads-with-multicall3.md) |

## Related

- [Batch Reads with Multicall3](batch-reads-with-multicall3.md)
- [Core](../sdk/core.md)
- [MCP Server and Skills (overview)](../agent-tooling/mcp-and-skills.md)
