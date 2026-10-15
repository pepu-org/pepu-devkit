// Live sponsorship status and the endpoint resolver. See docs/sdk/core.md and docs/sdk/aa.md
import { PEPU_ENV, checkSponsorship, getPublicClient, pepuMainnet, resolvePepuEndpoints } from "@pepu-chain/sdk";

export async function report(): Promise<void> {
  const { bundlerUrl, paymasterBaseUrl, paymasterUrl, source } = resolvePepuEndpoints();
  // The hosted bundler and paymaster service are the defaults. paymasterUrl (the complete ERC-7677 URL)
  // stays null until you set PEPU_PAYMASTER_URL, because that URL embeds a project token
  // (names only below: values can embed credentials).
  console.log(PEPU_ENV.bundlerUrl, bundlerUrl !== null, paymasterBaseUrl !== null, PEPU_ENV.paymasterUrl, paymasterUrl !== null, source);

  const s = await checkSponsorship({ publicClient: getPublicClient(pepuMainnet) });
  console.log(s.available, s.reason);
  for (const fix of s.fixes) console.log(`- ${fix}`);
}
