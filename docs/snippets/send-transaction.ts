// Estimate, send and link a native PEPU transfer from a script.
// See docs/recipes/send-a-transaction.md
import {
  estimateTransactionCost,
  formatPepu,
  getPublicClient,
  maxSendableAmount,
  pepuMainnet,
  txUrl,
} from "@pepu-chain/sdk";
import { createWalletClient, http, parseEther } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const publicClient = getPublicClient(pepuMainnet);

// SCRIPT ONLY. Never ship a private key in a browser bundle.
const account = privateKeyToAccount(process.env["DEPLOYER_PRIVATE_KEY"] as Hex);
const walletClient = createWalletClient({ account, chain: pepuMainnet, transport: http() });

export async function sendPepu(to: `0x${string}`, amountPepu: string): Promise<string> {
  const value = parseEther(amountPepu);

  const estimate = await estimateTransactionCost(publicClient, { account: account.address, to, value });
  console.log(`Estimated cost: ${estimate.costFormatted}`);

  const balanceWei = await publicClient.getBalance({ address: account.address });
  const max = await maxSendableAmount({ client: publicClient, from: account.address, to, balanceWei });
  if (max.status !== "ok") throw new Error(max.reason);
  if (value > max.amountWei) throw new Error("Amount leaves too little PEPU for gas");

  const hash = await walletClient.sendTransaction({ to, value });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Sent ${formatPepu(value)}`);
  return txUrl(pepuMainnet, hash);
}
