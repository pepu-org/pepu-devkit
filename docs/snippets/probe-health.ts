// Probe the hosted bundler and paymaster service (read-only). See docs/sdk/aa.md
import { resolvePepuEndpoints } from "@pepu-chain/sdk";
import { probeBundler, probePaymaster } from "@pepu-chain/sdk/aa";

export async function health(): Promise<void> {
  const { bundlerUrl, paymasterBaseUrl } = resolvePepuEndpoints();

  // Both probes accept string | null | undefined and fall back to the hosted service.
  const bundler = await probeBundler(bundlerUrl);
  const paymaster = await probePaymaster(paymasterBaseUrl);

  console.log("bundler", bundler.ok, bundler.chainId, bundler.missingRequiredMethods);
  // erc7677 is "needs-credential" for a bare service base: the v2 route answered a structured JSON-RPC error.
  console.log("paymaster", paymaster.ok, paymaster.health, paymaster.freeTierOk, paymaster.erc7677);
  if (paymaster.error) console.log(paymaster.error.code, paymaster.error.hint);
}
