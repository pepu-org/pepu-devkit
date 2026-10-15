// Add PEPU to an injected wallet. See docs/recipes/add-pepu-to-a-wallet.md
import { pepuMainnet, switchOrAddPepuChain, toAddEthereumChainParameter } from "@pepu-chain/sdk";
import type { EIP1193Provider } from "viem";

export function manualParameter() {
  // The exact object wallet_addEthereumChain expects (chainId is "0x17dcd").
  return toAddEthereumChainParameter(pepuMainnet);
}

export async function addAndSwitch(): Promise<void> {
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No injected wallet found");
  await switchOrAddPepuChain(provider, pepuMainnet);
}
