/**
 * pepu_bundler_health
 *
 * WHAT: Probes an ERC-4337 bundler URL with the SDK's `probeBundler`: chain
 * id, supported EntryPoints, which UserOperation methods exist, and latency,
 * ending in a plain verdict. Sends nothing on-chain.
 *
 * WHEN TO USE: Before wiring sponsorship, or when a UserOperation fails with
 * "unreachable" or an unexpected chain. With no `url` it uses PEPU_BUNDLER_URL
 * (via `resolvePepuEndpoints`). The hosted PEPU bundler
 * (https://bundler.pepeunchained.com) is the default.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PEPU_ENV, resolvePepuEndpoints } from "@pepu-chain/sdk";
import { probeBundler } from "@pepu-chain/sdk/aa";
import { REMOTE_READ } from "../annotations.js";
import { jsonResult } from "../format.js";
import { HOSTED_ENDPOINTS_NOTE, describeSdkError, hostOf, sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  url: z
    .string()
    .url()
    .optional()
    .describe(`Bundler URL to probe (http or https). Defaults to ${PEPU_ENV.bundlerUrl} resolved by the SDK. The URL is never echoed back, only its host.`),
};

export function registerBundlerHealthTool(server: McpServer): void {
  server.registerTool(
    "pepu_bundler_health",
    {
      title: "PEPU bundler health",
      description:
        "Probe an ERC-4337 bundler for PEPU with probeBundler from @pepu-chain/sdk/aa: chain id (must be 97741), supported EntryPoints (must include v0.7), which UserOperation RPC methods exist (probed with deliberately invalid params, so nothing is sent on-chain), latency, and a verdict with a fix. The verdict is only 'healthy' when chain, EntryPoint v0.7 and the required methods (eth_sendUserOperation, eth_estimateUserOperationGas, eth_getUserOperationReceipt) are all present. Sends nothing on-chain. Defaults to the PEPU_BUNDLER_URL env var (resolvePepuEndpoints); the hosted PEPU bundler is not public yet, so an unconfigured server reports 'not configured' with next steps.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ url }) => {
      const target = url ?? (await sdkCall("Resolving the bundler URL", () => resolvePepuEndpoints().bundlerUrl));
      if (!target) {
        return jsonResult({
          configured: false,
          verdict: "not configured",
          envVar: PEPU_ENV.bundlerUrl,
          note: HOSTED_ENDPOINTS_NOTE,
        });
      }
      const probe = await sdkCall("probeBundler", () => probeBundler(target));
      return jsonResult({
        configured: true,
        host: hostOf(target),
        verdict: probe.ok ? "healthy" : "unhealthy",
        chainId: probe.chainId ?? null,
        entryPoints: probe.entryPoints ?? [],
        supportedMethods: probe.supportedMethods ?? {},
        missingRequiredMethods: probe.missingRequiredMethods ?? [],
        latencyMs: probe.latencyMs,
        ...(probe.error ? { problem: describeSdkError(probe.error) } : {}),
        sdkFunction: "probeBundler (@pepu-chain/sdk/aa)",
      });
    }
  );
}
