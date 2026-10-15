/**
 * pepu_sdk_exports
 *
 * WHAT: Lists what @pepu-chain/sdk exports, by import path, with a one-line
 * summary for each, from an export list generated from the SDK build and
 * bundled into this package. Lets an agent pick the right function instead of
 * guessing a name.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STATIC_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { SDK_EXPORTS } from "../snapshots.js";

const inputSchema = {
  subpath: z.string().optional().describe("An import path such as @pepu-chain/sdk/session or just 'session'. Omit to list every subpath with its export count."),
  search: z.string().optional().describe("Only exports whose name or summary contains this text (case-insensitive)."),
  kind: z.enum(["function", "value", "type", "class", "enum"]).optional().describe("Only this kind of export."),
};

function normalize(subpath: string): string {
  const s = subpath.trim().replace(/^@pepu-chain\/sdk\/?/, "").replace(/^\/+/, "");
  return s === "" ? "@pepu-chain/sdk" : `@pepu-chain/sdk/${s}`;
}

export function registerSdkExportsTool(server: McpServer): void {
  server.registerTool(
    "pepu_sdk_exports",
    {
      title: "PEPU SDK exports",
      description:
        "List the exports of @pepu-chain/sdk per import path (core, /privy, /privy/react, /privy/server, /session, /session/kernel, /aa, /paymaster, /combo, /doctor and more) with one-line summaries, from an export list generated from the SDK build and bundled here. Use it to find the right function before writing code instead of guessing a name. Omit subpath to list the paths; filter with search or kind.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ subpath, search, kind }) => {
      if (subpath === undefined) {
        return jsonResult({
          sdkVersion: SDK_EXPORTS.sdkVersion,
          subpaths: Object.entries(SDK_EXPORTS.subpaths).map(([path, entries]) => ({ path, exports: entries.length })),
          next: "Pass subpath to list its exports; search to find a function by name or purpose across one path.",
        });
      }
      const key = normalize(subpath);
      const entries = SDK_EXPORTS.subpaths[key];
      if (!entries) {
        actionableError(`No SDK import path "${subpath}".`, `Known paths: ${Object.keys(SDK_EXPORTS.subpaths).join(", ")}.`, "Call without subpath to list them.");
      }
      const needle = search?.toLowerCase();
      const filtered = entries.filter((e) => (kind === undefined || e.kind === kind) && (needle === undefined || e.name.toLowerCase().includes(needle) || e.summary.toLowerCase().includes(needle)));
      return jsonResult({
        path: key,
        sdkVersion: SDK_EXPORTS.sdkVersion,
        count: filtered.length,
        exports: filtered,
        import: `import { ${filtered.filter((e) => e.kind !== "type").slice(0, 3).map((e) => e.name).join(", ")} } from "${key}";`,
      });
    }
  );
}
