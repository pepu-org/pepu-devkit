// Batch reads through PEPU's own Multicall3. See docs/recipes/batch-reads-with-multicall3.md
import { erc20Abi, getAddress } from "viem";
import { getPublicClient, pepuMainnet, pepuMulticall, pepuTokenList } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);

export async function readTokens(holder: `0x${string}`) {
  const tokens = pepuTokenList.tokens.map((t) => getAddress(t.address));

  // pepuMulticall pins the Multicall3 address; the canonical one has no code on PEPU.
  const results = await pepuMulticall(
    client,
    tokens.flatMap(
      (address) =>
        [
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
        ] as const,
    ),
    { allowFailure: true },
  );

  return results.map((r) => (r.status === "success" ? r.result : null));
}
