/**
 * pepu_check_privy_config
 *
 * WHAT: Checks the Privy dashboard settings that can be read without a
 * secret, with the SDK's `checkPrivyDashboardConfig` (it calls the same
 * public app-config endpoint the browser SDK uses). Reports per requirement
 * pass, fail or unknown, with a fix. The requirement table
 * (`PEPU_PRIVY_REQUIREMENTS`) also lists the env and code requirements that
 * cannot be checked remotely, so the answer covers the whole Privy setup.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PEPU_PRIVY_REQUIREMENTS, checkPrivyDashboardConfig } from "@pepu-chain/sdk/privy";
import { REMOTE_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { sdkCall } from "../sdk-helpers.js";

// The SDK table says "sponsor"; "sponsorship" (the doctor vocabulary used by pepu_check_env) is accepted as an alias.
const PILLARS = ["login", "session", "sponsor", "sponsorship"] as const;

const inputSchema = {
  appId: z.string().min(1).describe("The Privy app id (NEXT_PUBLIC_PRIVY_APP_ID, a public value)."),
  origin: z
    .string()
    .url()
    .optional()
    .describe("The origin the app runs on, including the port, e.g. http://localhost:3000. A different dev port (Next.js falls back to 3001) is the usual cause of login failures."),
  pillars: z.array(z.enum(PILLARS)).optional().describe("Only report requirements that matter for these pillars. Default: all."),
};

export function registerCheckPrivyConfigTool(server: McpServer): void {
  server.registerTool(
    "pepu_check_privy_config",
    {
      title: "Check a Privy app's dashboard config for PEPU",
      description:
        "Check the Privy dashboard settings a PEPU app needs with checkPrivyDashboardConfig from @pepu-chain/sdk/privy (public app-config endpoint, no secret): allowed origin with the exact port, create-on-login, Google login, Smart Wallets with bundler and paymaster URLs, session signers. Each requirement comes back pass, fail or unknown with a fix; unknown means Privy did not report it, not that it failed. Also returns the full PEPU_PRIVY_REQUIREMENTS table, including env and code requirements that cannot be checked remotely. Needs network access to auth.privy.io.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ appId, origin, pillars }) => {
      const wantedPillars = pillars?.map((p) => (p === "sponsorship" ? "sponsor" : p));
      const wanted = (row: { pillars: readonly string[] }): boolean => !wantedPillars || wantedPillars.some((p) => row.pillars.includes(p));
      const rows = PEPU_PRIVY_REQUIREMENTS.filter(wanted);
      if (rows.length === 0) {
        actionableError("No requirements match those pillars.", `Valid pillars: ${PILLARS.join(", ")}.`, "Omit pillars to see everything.");
      }

      const report = await sdkCall("checkPrivyDashboardConfig", () => checkPrivyDashboardConfig({ appId, ...(origin !== undefined ? { origin } : {}) }));
      const byId = new Map(report.items.map((i) => [i.id, i]));
      const dashboard = rows
        .filter((r) => r.where === "dashboard")
        .map((r) => {
          const item = byId.get(r.id);
          return {
            id: r.id,
            label: r.label,
            required: r.required,
            result: item ? (item.ok === true ? "pass" : item.ok === false ? "fail" : "unknown") : "unknown",
            detail: item?.detail ?? "Not reported.",
            ...(item && item.ok !== true ? { fix: item.fix ?? r.fix } : {}),
            docsUrl: r.docsUrl,
          };
        });
      const notRemotelyCheckable = rows
        .filter((r) => r.where !== "dashboard")
        .map((r) => ({ id: r.id, where: r.where, label: r.label, required: r.required, fix: r.fix, docsUrl: r.docsUrl }));
      const failed = dashboard.filter((d) => d.result === "fail");
      return jsonResult({
        ok: !failed.some((d) => d.required),
        summary: {
          pass: dashboard.filter((d) => d.result === "pass").length,
          fail: failed.length,
          unknown: dashboard.filter((d) => d.result === "unknown").length,
        },
        dashboard,
        notRemotelyCheckable,
        tip: origin ? undefined : "Pass origin (with the port) to check the allowed-origins requirement.",
        sdkFunction: "checkPrivyDashboardConfig (@pepu-chain/sdk/privy)",
      });
    }
  );
}
