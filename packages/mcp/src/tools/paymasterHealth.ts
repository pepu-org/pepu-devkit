/**
 * pepu_paymaster_health
 *
 * WHAT: Probes a PEPU paymaster service with the SDK's `probePaymaster`:
 * `GET /health`, `GET /v2/free-tier` and the v2 ERC-7677 route
 * (`POST /v2/paymaster/<token>`; a structured JSON-RPC error counts as responding).
 * The URL can embed a credential, so only its host is returned.
 *
 * WHEN TO USE: To confirm a paymaster (the hosted one or your own) is alive
 * and speaks ERC-7677 before debugging a sponsored UserOperation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PEPU_ENV, resolvePepuEndpoints } from "@pepu-chain/sdk";
import { probePaymaster } from "@pepu-chain/sdk/aa";
import { REMOTE_READ } from "../annotations.js";
import { jsonResult } from "../format.js";
import { HOSTED_ENDPOINTS_NOTE, V2_PAYMASTER_NOTE, describeSdkError, hostOf, sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  url: z
    .string()
    .url()
    .optional()
    .describe(`Paymaster URL (the service base https://paymaster.pepeunchained.com, or an ERC-7677 endpoint https://host/v2/paymaster/<token>). Defaults to ${PEPU_ENV.paymasterUrl}. Never echoed back, only its host.`),
};

export function registerPaymasterHealthTool(server: McpServer): void {
  server.registerTool(
    "pepu_paymaster_health",
    {
      title: "PEPU paymaster health",
      description:
        "Probe a PEPU paymaster service with probePaymaster from @pepu-chain/sdk/aa, read-only: GET /health, GET /v2/free-tier and the v2 ERC-7677 route POST /v2/paymaster/<token> (a placeholder token and empty params when you pass only the service base). erc7677 is 'stub-ok', or 'needs-credential' when the route answers a structured JSON-RPC error (invalid params, unknown credential, denial), which is the expected healthy answer without a client token, or 'not-responding' (network error, non-JSON answer or 5xx), which makes the verdict unhealthy. Defaults to PEPU_PAYMASTER_URL (resolvePepuEndpoints), then the hosted service https://paymaster.pepeunchained.com. Returns only the host, never the URL, because it may embed a token.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ url }) => {
      const target = url ?? (await sdkCall("Resolving the paymaster URL", () => { const e = resolvePepuEndpoints(); return e.paymasterUrl ?? e.paymasterBaseUrl; }));
      if (!target) {
        return jsonResult({
          configured: false,
          verdict: "not configured",
          envVar: PEPU_ENV.paymasterUrl,
          note: HOSTED_ENDPOINTS_NOTE,
          v2: V2_PAYMASTER_NOTE,
        });
      }
      const probe = await sdkCall("probePaymaster", () => probePaymaster(target));
      return jsonResult({
        configured: true,
        host: hostOf(target),
        // "healthy" only when every capability that could be checked passed; "unhealthy" otherwise.
        verdict: probe.ok && probe.health === true && probe.erc7677 !== "not-responding" ? "healthy" : "unhealthy",
        health: probe.health ?? null,
        erc7677: probe.erc7677 ?? null,
        // null = not applicable: the endpoint speaks ERC-7677 but a stub needs a client token the probe does not have.
        erc7677StubOk: probe.erc7677StubOk ?? null,
        freeTierOk: probe.freeTierOk ?? null,
        freeTier: probe.freeTier ?? null,
        ...(probe.erc7677Route ? { erc7677Route: probe.erc7677Route } : {}),
        latencyMs: probe.latencyMs,
        ...(probe.error ? { problem: describeSdkError(probe.error) } : {}),
        v2: V2_PAYMASTER_NOTE,
        sdkFunction: "probePaymaster (@pepu-chain/sdk/aa)",
      });
    }
  );
}
