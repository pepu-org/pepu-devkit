// Batched reads in React with wagmi. See docs/recipes/multicall-in-react.md
import { useReadContracts } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { pepuMainnet, pepuTokenList } from "@pepu-chain/sdk";
import { usePepuBalance } from "@pepu-chain/sdk/react";
import { getPublicClient } from "@pepu-chain/sdk";

const publicClient = getPublicClient(pepuMainnet);

export function Balances({ holder }: { holder: `0x${string}` }) {
  // pepuMainnet carries contracts.multicall3 at PEPU's own address, so wagmi batches these into one call
  // with no extra configuration.
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: pepuTokenList.tokens.flatMap(
      (t) =>
        [
          { chainId: pepuMainnet.id, address: t.address as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
          {
            chainId: pepuMainnet.id,
            address: t.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [holder],
          },
        ] as const,
    ),
  });

  // The native balance is not a contract call; usePepuBalance polls it.
  const native = usePepuBalance(publicClient, { address: holder, pollingInterval: 15_000 });

  if (isLoading) return <p>Loading</p>;
  return (
    <ul>
      <li>PEPU {native.data !== undefined ? formatUnits(native.data, 18) : "..."}</li>
      {pepuTokenList.tokens.map((t, i) => {
        const symbol = data?.[i * 2];
        const balance = data?.[i * 2 + 1];
        return (
          <li key={t.address}>
            {symbol?.status === "success" ? String(symbol.result) : t.symbol}{" "}
            {balance?.status === "success" ? formatUnits(balance.result as bigint, t.decimals) : "..."}
          </li>
        );
      })}
    </ul>
  );
}
