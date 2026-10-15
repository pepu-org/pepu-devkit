/**
 * pepu_sponsorship_status
 *
 * WHAT: The SDK's live `checkSponsorship`: resolves the bundler and paymaster
 * URLs (explicit, then env, then the hosted defaults, which are null until
 * PEPU hosts them), probes both, and optionally reads the paymaster's
 * EntryPoint deposit. Reports `available` with reasons and concrete fixes.
 *
 * WHEN TO USE: The one call that answers "can my app send a gasless
 * transaction right now?". Do not infer it from the paymaster contract being
 * deployed: a funded contract is not hosted sponsorship.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkSponsorship, formatPepu } from "@pepu-chain/sdk";
import { REMOTE_READ } from "../annotations.js";
import { jsonResult } from "../format.js";
import { getPublicClient } from "../rpc.js";
import { HOSTED_ENDPOINTS_NOTE, V2_CANARY_NOTE, describeSdkError, hostOf, sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  bundlerUrl: z.string().url().optional().describe("Bundler URL. Defaults to PEPU_BUNDLER_URL."),
  paymasterUrl: z.string().url().optional().describe("ERC-7677 paymaster URL. Defaults to PEPU_PAYMASTER_URL. Never echoed back."),
  include_deposit: z
    .boolean()
    .default(true)
    .describe("Also read the v2 canary paymaster's EntryPoint v0.7 deposit over RPC (an empty deposit makes sponsorship unavailable)."),
};

export function registerSponsorshipStatusTool(server: McpServer): void {
  server.registerTool(
    "pepu_sponsorship_status",
    {
      title: "PEPU sponsorship status",
      description:
        "Answer 'can my app send a gas-sponsored transaction right now?' with checkSponsorship from @pepu-chain/sdk: resolves bundler and paymaster URLs (resolvePepuEndpoints), probes both, optionally reads the paymaster's EntryPoint deposit, and returns available plus a reason and concrete fixes. Defaults to the hosted bundler and paymaster service (bundler.pepeunchained.com, paymaster.pepeunchained.com); with no token URL the paymaster service is probed at its base. The v2 paymaster is a deployed canary (external audit pending).",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ bundlerUrl, paymasterUrl, include_deposit }) => {
      const report = await sdkCall("checkSponsorship", () =>
        checkSponsorship({
          ...(bundlerUrl !== undefined ? { bundlerUrl } : {}),
          ...(paymasterUrl !== undefined ? { paymasterUrl } : {}),
          ...(include_deposit ? { publicClient: getPublicClient("mainnet") } : {}),
        })
      );
      const bp = report.bundler.probe;
      const pp = report.paymaster.probe;
      return jsonResult({
        available: report.available,
        transport: report.transport,
        reason: report.reason,
        fixes: report.fixes,
        bundler: {
          configured: report.bundler.configured,
          ...(bp ? { ok: bp.ok, chainId: bp.chainId ?? null, latencyMs: bp.latencyMs, ...(bp.error ? { problem: describeSdkError(bp.error) } : {}) } : {}),
          ...(bundlerUrl ? { host: hostOf(bundlerUrl) } : {}),
        },
        paymaster: {
          configured: report.paymaster.configured,
          ...(pp
            ? { ok: pp.ok, health: pp.health ?? null, erc7677: pp.erc7677 ?? null, erc7677StubOk: pp.erc7677StubOk ?? null, freeTier: pp.freeTier ?? null, latencyMs: pp.latencyMs, ...(pp.error ? { problem: describeSdkError(pp.error) } : {}) }
            : {}),
          ...(report.paymaster.depositWei !== undefined
            ? { depositWei: report.paymaster.depositWei.toString(), depositPepu: formatPepu(report.paymaster.depositWei) }
            : {}),
          ...(paymasterUrl ? { host: hostOf(paymasterUrl) } : {}),
        },
        notes: [HOSTED_ENDPOINTS_NOTE, V2_CANARY_NOTE],
        sdkFunction: "checkSponsorship (@pepu-chain/sdk)",
      });
    }
  );
}
