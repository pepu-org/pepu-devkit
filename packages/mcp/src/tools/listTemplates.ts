/**
 * pepu_list_templates
 *
 * WHAT: Lists the create-pepu-app starter templates: name, description (from
 * create-pepu-app's templates.json, bundled at build time), the doctor pillars and
 * CLI display features each demonstrates, required and optional env vars and the Privy dashboard
 * settings it needs (from the SDK's `TEMPLATE_REQUIREMENTS`), when to pick it,
 * and the exact commands.
 *
 * WHEN TO USE: Before pepu_scaffold_app, to choose a template.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
import { STATIC_READ } from "../annotations.js";
import { jsonResult } from "../format.js";
import { TEMPLATE_REGISTRY } from "../snapshots.js";

/** Guidance on choosing, kept here because it is MCP-facing prose, not data the CLI needs. */
export const WHEN_TO_PICK: Record<string, string> = {
  "consumer-app": "The default. Email, Google or wallet sign-in, an embedded wallet and a real PEPU send. Pick it when you just need accounts and a wallet, or are unsure.",
  "token-gated-app": "Unlock content by holding an ERC-20 or an NFT. Pick it for holder-only pages; balance checks are batched with the PEPU Multicall3.",
  "nft-mint": "An ERC-721 mint page plus the Foundry and Hardhat contract. Pick it to launch or demo an NFT collection.",
  "game-app": "Tap-to-score demo of Privy session signers: grant once, then act with no wallet popup. Pick it for any action-heavy app where the user pays gas but must not be interrupted.",
  "sponsored-demo": "Gasless transactions for a zero-balance smart account (Kernel) through a bundler and paymaster. Pick it to learn or demo sponsorship. Uses the hosted bundler by default; the paymaster needs a project token (see its README).",
  "sponsored-session-app": "Google or email sign-in, one scoped on-chain session, then actions with no popup and no user gas (Kernel session key plus paymaster). The combination of sessions and sponsorship. Uses the hosted bundler by default; the paymaster needs a project token or the free tier with a Privy token (see its README).",
};

/** Registry keys the tool computes itself from the SDK (never overwritten by the registry copy). */
const RESERVED = new Set(["name", "description", "pillars", "requiredEnv", "optionalEnv", "privyDashboard"]);

const inputSchema = {};

export function registerListTemplatesTool(server: McpServer): void {
  server.registerTool(
    "pepu_list_templates",
    {
      title: "List PEPU app templates",
      description:
        "List the create-pepu-app starter templates with their pillars (login, wallet, session, sponsorship, gate, mint), required and optional env vars and Privy dashboard settings (TEMPLATE_REQUIREMENTS from @pepu-chain/sdk/doctor), when to pick each, and the exact scaffold and run commands. Metadata comes from create-pepu-app's templates.json, bundled at build time. Call before pepu_scaffold_app.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async () => {
      const templates = TEMPLATE_REGISTRY.map((t) => {
        const req = TEMPLATE_REQUIREMENTS[t.name];
        return {
          name: t.name,
          description: t.description,
          whenToPick: WHEN_TO_PICK[t.name] ?? null,
          // SDK doctor vocabulary (login, wallet, session, sponsorship, gate, mint). The registry's
          // `features` (CLI display tags: login, session, sponsor) is passed through below.
          pillars: req?.pillars ?? null,
          requiredEnv: req?.requiredEnv ?? null,
          optionalEnv: req?.optionalEnv ?? null,
          requiredAnyOf: req?.requiredAnyOf ?? null,
          privyDashboard: req?.privyDashboard ?? null,
          needsBundlerAndPaymaster: req?.pillars.includes("sponsorship") ?? false,
          commands: {
            scaffold: `npx create-pepu-app@latest my-app --template ${t.name} --yes`,
            install: "pnpm install   # or npm install, yarn, bun",
            run: "pnpm dev",
            check: "Use pepu_check_env with projectDir and template to see what is still missing.",
          },
          ...Object.fromEntries(Object.entries(t).filter(([k]) => !RESERVED.has(k))),
        };
      });
      return jsonResult({
        templates,
        defaultTemplate: "consumer-app",
        next: "pepu_scaffold_app creates one (absolute directory that does not exist yet); pepu_check_env then reports which env vars are still missing.",
        source: "create-pepu-app templates.json (bundled) + TEMPLATE_REQUIREMENTS (@pepu-chain/sdk/doctor)",
      });
    }
  );
}
