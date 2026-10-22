// Pillar 3: a sponsored transaction from a script (direct transport).
// Needs a bundler and a paymaster: set PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL
// (the bundler defaults to https://bundler.pepeunchained.com; the ERC-7677 URL is https://paymaster.pepeunchained.com/v2/paymaster/<token>).
// Local dev defaults are http://localhost:4337 and http://localhost:8788 for your own services.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { buildPaymasterContext, checkSponsorship, explorerLinks, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "@pepu-chain/sdk/aa/kernel";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);

// SCRIPT ONLY: the owner key stays in your environment.
const owner = privateKeyToAccount(process.env["OWNER_PRIVATE_KEY"] as Hex);

export async function sponsoredTap(privyAccessToken?: string) {
  // 1. Is sponsorship reachable? Never throws for an unreachable service.
  const status = await checkSponsorship({ publicClient });
  if (!status.available) throw new Error(`${status.reason} ${status.fixes.join(" ")}`);

  // 2. The Kernel smart account that sends and holds assets. The owner EOA only signs.
  const account = await toPepuKernelAccount({ publicClient, owner });

  // 3. A client that sends through your bundler and has gas paid by your paymaster.
  const client = createPepuSponsoredClient({
    account,
    // The v2 free tier wants the user's Privy access token (from PEPU's own Privy app).
    ...(privyAccessToken ? { paymasterContext: buildPaymasterContext({ privyAccessToken }) } : {}),
  });

  // 4. One UserOperation: encode, send, wait for the receipt, report who paid.
  const result = await sendSponsored({
    client,
    calls: [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  });

  return { ...result, links: explorerLinks({ tx: result.transactionHash, sender: account.address }) };
}
