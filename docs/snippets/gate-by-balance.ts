// Gate access by token balance on the server. See docs/recipes/gate-content-by-token-balance.md
import { erc20Abi } from "viem";
import { formatUnitsCompact, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);

export async function holdsEnough(
  token: `0x${string}`,
  holder: `0x${string}`,
  minimum: bigint,
): Promise<{ allowed: boolean; shown: string }> {
  const [balance, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { allowed: balance >= minimum, shown: formatUnitsCompact(balance, decimals) };
}
