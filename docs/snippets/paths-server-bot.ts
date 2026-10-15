// Path 1 (ZeroDev-native), server or bot: the owner is a plain server key, the paymaster credential is the project SERVER key.
// SERVER ONLY: both secrets stay in the environment and are never printed or sent to a browser.
// See docs/concepts/smart-account-paths.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "@pepu-chain/sdk/aa/kernel";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export async function botTap() {
  const publicClient = getPublicClient(pepuMainnet);
  // The Kernel account is owned by this key. Its address is a pure function of the owner (and index).
  const owner = privateKeyToAccount(process.env["BOT_OWNER_PRIVATE_KEY"] as Hex);
  const account = await toPepuKernelAccount({ publicClient, owner });
  // paymasterToken is your project's server key (ppk_); the SDK builds https://paymaster.pepeunchained.com/v2/paymaster/<token>.
  const client = createPepuSponsoredClient({ account, paymasterToken: process.env["PEPU_PAYMASTER_SERVER_KEY"] as string });
  return sendSponsored({ client, calls: [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }] });
}
