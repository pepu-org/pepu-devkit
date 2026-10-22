/**
 * MCP prompts: ready-made task starters. Each returns one user message that
 * tells the agent which tools and SDK functions to use, in order, so the work
 * is done with the SDK rather than hand-rolled.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

const REMINDERS =
  "Reminders: sponsorship uses the hosted bundler (bundler.pepeunchained.com) and paymaster (paymaster.pepeunchained.com) with a project token; the v1 paymaster is retired; deposits to the v2 paymaster are one-way; Privy session mode is enforced off-chain and the user pays gas, Kernel session mode is enforced on-chain. Never call a transaction gasless unless a paymaster paid it. Never print secrets.";

export function registerAllPrompts(server: McpServer): void {
  server.registerPrompt(
    "new-pepu-app",
    {
      title: "Start a new PEPU app",
      description: "Pick a template, scaffold the app with the SDK wired in, and get it to a running state.",
      argsSchema: {
        idea: z.string().optional().describe("What the app should do."),
        directory: z.string().optional().describe("Absolute path for the new project folder."),
      },
    },
    ({ idea, directory }) =>
      userMessage(
        [
          `Build a new Pepe Unchained app${idea ? `: ${idea}` : ""}.`,
          "1. Read pepu://chain-facts, then call pepu_list_templates and choose the template that fits (explain the choice in one line).",
          `2. Call pepu_scaffold_app with that template and ${directory ? `directory ${directory}` : "an absolute directory that does not exist yet"}.`,
          "3. Call pepu_check_env on the new project and fix what is missing; ask the user for the Privy app id and app secret only if needed.",
          "4. Call pepu_check_privy_config with the app id and the dev origin including the port.",
          "5. Use pepu_sdk_snippet and pepu_sdk_exports for any extra wiring. Use @pepu-chain/sdk functions; do not hand-roll chain config, addresses or Privy plumbing.",
          REMINDERS,
        ].join("\n")
      )
  );

  server.registerPrompt(
    "add-google-login",
    {
      title: "Add Google login and an embedded wallet",
      description: "Wire Privy login with an embedded wallet using the SDK.",
      argsSchema: { projectDir: z.string().optional().describe("Absolute project path.") },
    },
    ({ projectDir }) =>
      userMessage(
        [
          `Add Google login and an embedded wallet to the PEPU app${projectDir ? ` at ${projectDir}` : ""}.`,
          "1. pepu_sdk_snippet task privy-provider and ensure-wallet-route; apply them.",
          "2. pepu_check_env (template consumer-app) then pepu_check_privy_config; the dashboard needs Google login on, the exact allowed origin with port, and wallet creation handled by the server.",
          "3. Pin Coinbase to eoaOnly (the provider already does) and pin the embedded wallet if wagmi is used (snippet wagmi-privy).",
          REMINDERS,
        ].join("\n")
      )
  );

  server.registerPrompt(
    "add-session",
    {
      title: "Add session keys (no popup per action)",
      description: "Add a scoped session in Privy mode (off-chain, user pays gas) or Kernel mode (on-chain).",
      argsSchema: {
        mode: z.enum(["privy", "kernel"]).optional().describe("privy or kernel. Ask the user which trust model they accept if unsure."),
        contract: z.string().optional().describe("The contract address the session may call."),
        functions: z.string().optional().describe("Comma-separated function signatures the session may call."),
      },
    },
    ({ mode, contract, functions }) =>
      userMessage(
        [
          `Add a session to the PEPU app (mode: ${mode ?? "ask the user"}; contract: ${contract ?? "ask"}; functions: ${functions ?? "ask"}).`,
          "1. Explain the two trust models in two sentences and confirm the mode: Privy is off-chain and the user pays gas; Kernel is on-chain and composes with sponsorship.",
          "2. Call pepu_session_policy for the chosen mode to get the policy, consent text and snippet.",
          "3. privy mode: pepu_sdk_snippet session-routes, session-action-route, grant-session, then pepu_generate_authorization_key (confirm_write true) and register the public key in the Privy dashboard. kernel mode: kernel-session-policy.",
          "4. Show the consent screen text and the trust notice to the user; scope must be one contract, named functions, a short expiry.",
          REMINDERS,
        ].join("\n")
      )
  );

  server.registerPrompt(
    "add-sponsorship",
    {
      title: "Add gas sponsorship",
      description: "Wire gasless transactions through a bundler and paymaster with the SDK.",
      argsSchema: { projectDir: z.string().optional().describe("Absolute project path.") },
    },
    ({ projectDir }) =>
      userMessage(
        [
          `Add gas sponsorship to the PEPU app${projectDir ? ` at ${projectDir}` : ""}.`,
          "1. Call pepu_sponsorship_status, pepu_bundler_health and pepu_paymaster_health. The bundler defaults to the hosted one; the paymaster needs an ERC-7677 URL with a token (PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<token>): a project client token (allowed origins only), a project server key (backend only), or a free-tier app token plus the user's Privy access token in the ERC-7677 context.",
          "2. pepu_sdk_snippet task sponsored-send (and sponsored-send-server for scripts).",
          "3. If a call fails, pepu_explain_error with the message or reason code.",
          "4. The v2 paymaster is deposit-only. Deposits are one-way; tell the user to deposit only what their project needs, after claiming it.",
          REMINDERS,
        ].join("\n")
      )
  );

  server.registerPrompt(
    "add-sponsored-session",
    {
      title: "Add a sponsored session (no popup, no gas)",
      description: "Combine a Kernel on-chain session key with the paymaster.",
      argsSchema: {
        contract: z.string().optional().describe("The contract address the session may call."),
        functions: z.string().optional().describe("Comma-separated function signatures."),
      },
    },
    ({ contract, functions }) =>
      userMessage(
        [
          `Add a sponsored session to the PEPU app (contract: ${contract ?? "ask"}; functions: ${functions ?? "ask"}).`,
          "1. pepu_session_policy with mode kernel for the scope and consent text.",
          "2. pepu_sdk_snippet tasks sponsored-session and sponsored-session-client; the scope on server and client must be identical.",
          "3. pepu_sponsorship_status to confirm bundler and paymaster; budget spend caps above the per-operation gas reservation (about 20.5 PEPU first operation, 6.9 later).",
          "4. createMemoryStore is dev only: say a persistent store with the session key encrypted at rest is required for production.",
          REMINDERS,
        ].join("\n")
      )
  );

  server.registerPrompt(
    "debug-tx",
    {
      title: "Debug a failed PEPU transaction",
      description: "Explain what happened to a transaction or UserOperation and how to fix it.",
      argsSchema: {
        hash: z.string().optional().describe("Transaction or UserOperation hash."),
        error: z.string().optional().describe("The error message, if there is one."),
      },
    },
    ({ hash, error }) =>
      userMessage(
        [
          `Debug a failed PEPU transaction${hash ? ` (hash ${hash})` : ""}${error ? " with the error below" : ""}.`,
          hash ? "1. Call pepu_explain_tx with the hash: was it an EOA transaction or a UserOperation, who paid gas, did it revert." : "1. Ask for the hash if there is one.",
          error ? "2. Call pepu_explain_error with the error text exactly as given (do not paraphrase)." : "2. Call pepu_explain_error on any error message or revert data you have.",
          "3. If the failure involves sponsorship, call pepu_sponsorship_status; if it is a revert with custom errors, pepu_decode_error with the contract ABI.",
          "4. Check pepu_known_gotchas for matching footguns (Multicall3 address, Privy chain rejection, port mismatch). State the cause and the fix.",
          error ? `\nError text:\n${error}` : "",
        ].join("\n")
      )
  );
}
