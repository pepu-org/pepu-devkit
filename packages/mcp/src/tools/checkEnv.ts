/**
 * pepu_check_env
 *
 * WHAT: Checks a project's env vars against a template's requirements with
 * the SDK's `checkPepuEnv`. Reports, per key, ok / missing / placeholder /
 * malformed, whether the key is a secret, its value's LENGTH, and a fix.
 * It NEVER returns a value, and the values it reads are never placed in any
 * message.
 *
 * Sources: the project's `.env.local` and `.env` (found under `projectDir`),
 * and/or pasted `envText`. Only those two file names are ever read.
 */

import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRIVY_APP_ID_PATTERN, TEMPLATE_REQUIREMENTS, checkPepuEnv, type Pillar } from "@pepu-chain/sdk/doctor";
import { STATIC_READ } from "../annotations.js";
import { parseEnv, readEnvFile } from "../env-file.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { assertExistingDirectory } from "../safe-path.js";

const PILLARS = ["login", "wallet", "session", "sponsorship", "gate", "mint"] as const;

const inputSchema = {
  projectDir: z.string().optional().describe("ABSOLUTE path of the project. Its .env.local and .env are read (.env.local wins). Give projectDir, envText, or both (envText wins)."),
  envText: z.string().max(100_000).optional().describe("Pasted dotenv text to check instead of, or on top of, the project's files. Values are never echoed."),
  template: z.string().optional().describe("Template name (pepu_list_templates). Selects the required and optional keys. Omit for the base Privy keys."),
  pillars: z.array(z.enum(PILLARS)).optional().describe("Pillars to check beyond the template's own, e.g. ['sponsorship'] to also require PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL."),
};

export function registerCheckEnvTool(server: McpServer): void {
  server.registerTool(
    "pepu_check_env",
    {
      title: "Check a PEPU project's env",
      description:
        "Check a project's environment variables with checkPepuEnv and TEMPLATE_REQUIREMENTS from @pepu-chain/sdk/doctor. Reads the project's .env.local and .env (or pasted envText) and reports per key ok, missing, placeholder or malformed, whether it is a secret, its value length, and exactly how to fix it. NEVER returns or logs a value, only presence and length. Use after pepu_scaffold_app, and whenever login, sessions or sponsorship fail with a config error.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ projectDir, envText, template, pillars }) => {
      if (projectDir === undefined && envText === undefined) {
        actionableError("Nothing to check.", "No projectDir or envText was given.", "Pass the absolute projectDir (preferred) or paste envText.");
      }
      if (template !== undefined && !(template in TEMPLATE_REQUIREMENTS)) {
        actionableError(`Unknown template "${template}".`, `Known templates: ${Object.keys(TEMPLATE_REQUIREMENTS).join(", ")}.`, "Call pepu_list_templates, or omit template for the base Privy keys.");
      }

      const env: Record<string, string> = {};
      const sources: string[] = [];
      if (projectDir !== undefined) {
        const dir = assertExistingDirectory(projectDir, "projectDir");
        for (const name of [".env", ".env.local"]) {
          const file = path.join(dir, name);
          const parsed = readEnvFile(file);
          if (Object.keys(parsed).length > 0) {
            Object.assign(env, parsed);
            sources.push(name);
          }
        }
        if (sources.length === 0) sources.push("(no .env.local or .env found, or both are empty)");
      }
      if (envText !== undefined) {
        Object.assign(env, parseEnv(envText));
        sources.push("envText");
      }

      const report = checkPepuEnv({
        env,
        ...(template !== undefined ? { template } : {}),
        ...(pillars !== undefined ? { pillars: pillars as Pillar[] } : {}),
      });
      const problems = report.items.filter((i) => i.status !== "ok" && (i.required || i.status !== "missing"));
      return jsonResult({
        ok: report.ok,
        sources,
        template: template ?? null,
        // Each item: key, status, secret, length (characters), required, fix. No values.
        items: report.items,
        problems: problems.map((i) => ({ key: i.key, status: i.status, required: i.required, fix: i.fix })),
        privyAppIdFormat: `NEXT_PUBLIC_PRIVY_APP_ID must match ${PRIVY_APP_ID_PATTERN.source}`,
        valuesReturned: false,
        sdkFunction: "checkPepuEnv (@pepu-chain/sdk/doctor)",
      });
    }
  );
}
