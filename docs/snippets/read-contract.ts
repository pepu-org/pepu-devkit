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
