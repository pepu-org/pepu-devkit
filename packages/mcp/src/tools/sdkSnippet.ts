/**
 * pepu_sdk_snippet
 *
 * WHAT: Returns a curated, canonical code snippet that uses @pepu-chain/sdk for
 * one task: one per pillar (login and wallet, Privy sessions, Kernel sessions,
 * sponsorship) and per combination (the sponsored session), plus chain reads
 * and the v2 deposit. Each comes with the file it belongs in, the peer
 * packages, the env vars and the honest caveats.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STATIC_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { SNIPPETS, findSnippet, parseSnippetImports } from "../snippets.js";

const IDS = SNIPPETS.map((s) => s.id) as [string, ...string[]];

const inputSchema = {
  task: z.enum(IDS).optional().describe(`Which snippet. Omit to list them all. One of: ${IDS.join(", ")}.`),
};

export function registerSdkSnippetTool(server: McpServer): void {
  server.registerTool(
    "pepu_sdk_snippet",
    {
      title: "PEPU SDK snippet",
      description:
        "Get canonical code that uses @pepu-chain/sdk for one task, so you wire the SDK instead of hand-rolling infrastructure: Privy provider and ensure-wallet route (@pepu-chain/sdk/privy), Privy session routes and hooks (/session), Kernel on-chain sessions (/session/kernel), sponsored send (/aa), the sponsored session (/combo), Multicall3 reads, Permit2 and the v2 deposit. Each snippet names its file, peer packages, env vars and caveats. Omit task to list every snippet. Every import is checked against the SDK's export list in this package's tests.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ task }) => {
      if (task === undefined) {
        return jsonResult({
          snippets: SNIPPETS.map((s) => ({ id: s.id, title: s.title, pillars: s.pillars, file: s.file })),
          next: "Call again with task set to one id for the code. pepu_sdk_exports lists everything an import path exposes.",
        });
      }
      const snippet = findSnippet(task);
      if (!snippet) {
        actionableError(`No snippet "${task}".`, `Available: ${IDS.join(", ")}.`, "Call without task to list them.");
      }
      return jsonResult({
        id: snippet.id,
        title: snippet.title,
        pillars: snippet.pillars,
        file: snippet.file,
        imports: parseSnippetImports(snippet.code),
        peers: snippet.peers,
        env: snippet.env,
        notes: snippet.notes,
        code: snippet.code,
        see: "pepu_check_env for the env vars, pepu_check_privy_config for the dashboard, pepu_sdk_exports for the API.",
      });
    }
  );
}
